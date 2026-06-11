"""
Telegram listener — the transport layer.

Listens to the group via long-polling getUpdates (no public URL / webhook, so the
server is never exposed to the internet). When a message addresses the bot, it
passes the text to the agent and replies. Runs as a background task started in
the app lifespan; it reads its config from app_settings on every cycle so the
assistant can be enabled/disabled from the UI without a restart.
"""

import asyncio
import logging
from typing import Optional

import httpx
from sqlalchemy import select

from app.database import async_session
from app.models.settings import AppSettings
from app.services.assistant.agent import assistant

logger = logging.getLogger("printfarm.assistant")

TELEGRAM_API = "https://api.telegram.org"

# Messages addressing the bot start with one of these commands…
TRIGGER_COMMANDS = ("/pregunta", "/ask", "/pf", "/bot")
# …or mention the bot, or reply to one of its messages.

LONG_POLL_SECS = 25
IDLE_RETRY_SECS = 10


class TelegramListener:
    def __init__(self) -> None:
        self._task: Optional[asyncio.Task] = None
        self._running = False
        self._offset: Optional[int] = None
        self._drained = False
        self._bot_username: Optional[str] = None

    # ── lifecycle ───────────────────────────────────────────────────────────
    async def start(self) -> None:
        if self._task and not self._task.done():
            return
        self._running = True
        self._task = asyncio.create_task(self._run())
        logger.info("Telegram assistant listener started")

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        logger.info("Telegram assistant listener stopped")

    # ── config ──────────────────────────────────────────────────────────────
    async def _get_config(self) -> tuple[Optional[str], Optional[str], bool]:
        async with async_session() as session:
            rows = (await session.execute(select(AppSettings))).scalars().all()
        cfg = {s.key: s.value for s in rows}
        bot_token = cfg.get("telegram_bot_token", "") or None
        chat_id = cfg.get("telegram_chat_id", "") or None
        enabled = cfg.get("assistant_enabled", "false").lower() == "true"
        return bot_token, chat_id, enabled

    # ── main loop ───────────────────────────────────────────────────────────
    async def _run(self) -> None:
        while self._running:
            try:
                bot_token, chat_id, enabled = await self._get_config()
                if not enabled or not bot_token:
                    await asyncio.sleep(IDLE_RETRY_SECS)
                    continue

                if self._bot_username is None:
                    await self._fetch_bot_username(bot_token)
                if not self._drained:
                    await self._drain_backlog(bot_token)

                updates = await self._get_updates(bot_token)
                for update in updates:
                    self._offset = update["update_id"] + 1
                    await self._handle_update(update, bot_token, chat_id)
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 — never let the loop die
                logger.exception("Telegram listener error; retrying")
                await asyncio.sleep(5)

    # ── telegram api helpers ────────────────────────────────────────────────
    async def _api(self, token: str, method: str, params: dict, timeout: float = 15.0):
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(f"{TELEGRAM_API}/bot{token}/{method}", json=params)
            if resp.status_code != 200:
                logger.warning("Telegram %s returned %s: %s", method, resp.status_code, resp.text[:200])
                return None
            return resp.json()

    async def _fetch_bot_username(self, token: str) -> None:
        data = await self._api(token, "getMe", {})
        if data and data.get("ok"):
            self._bot_username = data["result"].get("username")
            logger.info("Assistant bot username: @%s", self._bot_username)

    async def _drain_backlog(self, token: str) -> None:
        """Skip messages that arrived while the bot was down."""
        data = await self._api(token, "getUpdates", {"timeout": 0}, timeout=20.0)
        if data and data.get("ok") and data["result"]:
            self._offset = data["result"][-1]["update_id"] + 1
        self._drained = True

    async def _get_updates(self, token: str) -> list[dict]:
        params: dict = {"timeout": LONG_POLL_SECS, "allowed_updates": ["message"]}
        if self._offset is not None:
            params["offset"] = self._offset
        data = await self._api(token, "getUpdates", params, timeout=LONG_POLL_SECS + 10)
        if data and data.get("ok"):
            return data["result"]
        return []

    async def _send(self, token: str, chat_id, text: str, reply_to: Optional[int] = None) -> None:
        params: dict = {"chat_id": chat_id, "text": text, "disable_web_page_preview": True}
        if reply_to:
            params["reply_to_message_id"] = reply_to
        await self._api(token, "sendMessage", params)

    # ── message handling ────────────────────────────────────────────────────
    def _extract_question(self, text: str, message: dict) -> Optional[str]:
        """Return the question if this message addresses the bot, else None.

        The bot only answers when explicitly addressed (command, @mention, or a
        reply to the bot) so it doesn't burn the LLM on every group message.
        """
        stripped = text.strip()

        # Reply to one of the bot's own messages → treat whole text as question.
        reply = message.get("reply_to_message") or {}
        if reply.get("from", {}).get("username") == self._bot_username and self._bot_username:
            return stripped or None

        lowered = stripped.lower()
        for cmd in TRIGGER_COMMANDS:
            # supports "/ask question" and "/ask@BotName question"
            if lowered.startswith(cmd):
                rest = stripped[len(cmd):]
                if rest[:1] == "@" and self._bot_username:
                    rest = rest.split(None, 1)[1] if " " in rest else ""
                return rest.strip() or None

        if self._bot_username:
            mention = f"@{self._bot_username}"
            if mention.lower() in lowered:
                return stripped.replace(mention, "").strip() or None

        return None

    async def _handle_update(self, update: dict, token: str, chat_id: Optional[str]) -> None:
        message = update.get("message")
        if not message:
            return
        text = message.get("text")
        if not text:
            return

        chat = message.get("chat", {})
        # If a group is configured, only answer there. Otherwise answer anywhere
        # (handy for testing in a private chat with the bot).
        if chat_id and str(chat.get("id")) != str(chat_id):
            return

        question = self._extract_question(text, message)
        if question is None:
            return
        if not question:
            await self._send(
                token, chat.get("id"),
                "Preguntame algo, por ejemplo: «¿qué impresoras están andando?» 🖨️",
                reply_to=message.get("message_id"),
            )
            return

        await self._api(token, "sendChatAction", {"chat_id": chat.get("id"), "action": "typing"})

        # Phase 1: read-only. allow_actions stays False until the actions phase.
        answer = await assistant.ask(question, allow_actions=False)
        await self._send(token, chat.get("id"), answer, reply_to=message.get("message_id"))


# Singleton
telegram_listener = TelegramListener()
