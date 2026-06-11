"""
Telegram listener — the transport layer.

Listens to the group via long-polling getUpdates (no public URL / webhook, so the
server is never exposed to the internet). Handles text AND voice notes (audio is
transcribed with the configured provider's Whisper). Builds an Actor (who is
asking + whether they may run actions) and passes it, plus a short conversation
history, to the agent. Permissions are enforced here in code, never by the model.
"""

import asyncio
import logging
from typing import Optional

import httpx
from sqlalchemy import select

from app.database import async_session
from app.models.settings import AppSettings
from app.services.assistant.agent import assistant
from app.services.assistant.conversation import Actor, conversation_store
from app.services.llm.base import LLMProviderError
from app.services.llm.factory import get_provider

logger = logging.getLogger("printfarm.assistant")

TELEGRAM_API = "https://api.telegram.org"

# Messages addressing the bot start with one of these commands…
TRIGGER_COMMANDS = ("/pregunta", "/ask", "/pf", "/bot")
# …or mention the bot, or reply to one of its messages.

LONG_POLL_SECS = 25
IDLE_RETRY_SECS = 10


def _parse_ids(raw: str) -> set[int]:
    """Parse a CSV of Telegram user IDs into a set of ints."""
    out: set[int] = set()
    for piece in (raw or "").replace(";", ",").split(","):
        piece = piece.strip()
        if piece.lstrip("-").isdigit():
            out.add(int(piece))
    return out


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
    async def _get_config(self) -> dict:
        async with async_session() as session:
            rows = (await session.execute(select(AppSettings))).scalars().all()
        cfg = {s.key: s.value for s in rows}
        return {
            "bot_token": cfg.get("telegram_bot_token", "") or None,
            "chat_id": cfg.get("telegram_chat_id", "") or None,
            "enabled": cfg.get("assistant_enabled", "false").lower() == "true",
            "reply_all": cfg.get("assistant_reply_all", "false").lower() == "true",
            "actions_enabled": cfg.get("assistant_actions_enabled", "false").lower() == "true",
            "require_pin": cfg.get("assistant_require_pin", "true").lower() == "true",
            "action_pin": cfg.get("assistant_action_pin", "") or "",
            "authorized_ids": _parse_ids(cfg.get("assistant_authorized_user_ids", "")),
        }

    # ── main loop ───────────────────────────────────────────────────────────
    async def _run(self) -> None:
        while self._running:
            try:
                cfg = await self._get_config()
                if not cfg["enabled"] or not cfg["bot_token"]:
                    await asyncio.sleep(IDLE_RETRY_SECS)
                    continue

                token = cfg["bot_token"]
                if self._bot_username is None:
                    await self._fetch_bot_username(token)
                if not self._drained:
                    await self._drain_backlog(token)

                updates = await self._get_updates(token)
                for update in updates:
                    self._offset = update["update_id"] + 1
                    # Handle each message in its own task so a slow LLM call
                    # (~30s) doesn't block the long-poll loop and queue up the
                    # rest of the group's messages behind it.
                    asyncio.create_task(self._handle_update_safe(update, cfg))
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

    # ── audio ────────────────────────────────────────────────────────────────
    def _is_reply_to_bot(self, message: dict) -> bool:
        reply = message.get("reply_to_message") or {}
        return bool(self._bot_username) and reply.get("from", {}).get("username") == self._bot_username

    async def _transcribe_voice(self, token: str, message: dict) -> Optional[str]:
        """Download a voice/audio message and transcribe it via the provider."""
        obj = message.get("voice") or message.get("audio")
        if not obj:
            return None
        data = await self._api(token, "getFile", {"file_id": obj.get("file_id")})
        if not data or not data.get("ok"):
            return None
        file_path = data["result"].get("file_path", "")
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                r = await client.get(f"{TELEGRAM_API}/file/bot{token}/{file_path}")
            if r.status_code != 200:
                return None
            audio = r.content
        except httpx.HTTPError as exc:
            logger.warning("Voice download failed: %s", exc)
            return None

        ext = file_path.rsplit(".", 1)[-1].lower() if "." in file_path else "ogg"
        if ext == "oga":
            ext = "ogg"
        try:
            provider = await get_provider()
            return await provider.transcribe(audio, f"audio.{ext}", f"audio/{ext}")
        except LLMProviderError as exc:
            logger.warning("Transcription failed: %s", exc)
            return None

    # ── message handling ────────────────────────────────────────────────────
    def _extract_question(self, text: str, message: dict, reply_all: bool) -> Optional[str]:
        """Return the question if this text addresses the bot, else None."""
        stripped = text.strip()

        if self._is_reply_to_bot(message):
            return stripped or None

        lowered = stripped.lower()
        for cmd in TRIGGER_COMMANDS:
            # The command must be the whole word: '/pf hola' o '/pf@bot hola',
            # pero NO '/pfx hola' (eso es otro comando, no nuestro).
            if lowered.startswith(cmd) and (len(stripped) == len(cmd) or stripped[len(cmd)] in (" ", "@", "\n")):
                rest = stripped[len(cmd):]
                if rest[:1] == "@" and self._bot_username:
                    rest = rest.split(None, 1)[1] if " " in rest else ""
                return rest.strip() or None

        if self._bot_username:
            mention = f"@{self._bot_username}"
            if mention.lower() in lowered:
                return stripped.replace(mention, "").strip() or None

        if reply_all:
            if stripped.startswith("/"):
                return None
            return stripped or None

        return None

    async def _handle_update_safe(self, update: dict, cfg: dict) -> None:
        """Wrapper for background tasks: a failing message never kills the loop."""
        try:
            await self._handle_update(update, cfg)
        except Exception:  # noqa: BLE001
            logger.exception("Error handling Telegram update %s", update.get("update_id"))

    async def _handle_update(self, update: dict, cfg: dict) -> None:
        token = cfg["bot_token"]
        chat_id = cfg["chat_id"]
        message = update.get("message")
        if not message:
            return
        # Never react to messages from bots (including our OWN notifications).
        if message.get("from", {}).get("is_bot"):
            return

        chat = message.get("chat", {})
        chat_key = chat.get("id")
        # If a group is configured, only answer there.
        if chat_id and str(chat_key) != str(chat_id):
            return

        from_user = message.get("from", {})
        user_id = from_user.get("id")
        name = from_user.get("first_name") or from_user.get("username") or "Operador"
        text = message.get("text")

        # /id — let users discover their Telegram ID to configure permissions.
        if text and text.strip().lower().split("@")[0] == "/id":
            await self._send(
                token, chat_key,
                f"🪪 Tu ID de Telegram es: {user_id}\nNombre: {name}",
                reply_to=message.get("message_id"),
            )
            return

        effective_reply_all = cfg["reply_all"] and bool(chat_id)

        # Resolve the question, from text or from a voice note.
        if text:
            question_raw = self._extract_question(text, message, effective_reply_all)
            if question_raw is None:
                return
            if not question_raw:
                await self._send(
                    token, chat_key,
                    "Preguntame algo, por ejemplo: «¿qué impresoras están andando?» 🖨️",
                    reply_to=message.get("message_id"),
                )
                return
        elif message.get("voice") or message.get("audio"):
            if not (effective_reply_all or self._is_reply_to_bot(message)):
                return
            await self._api(token, "sendChatAction", {"chat_id": chat_key, "action": "typing"})
            question_raw = await self._transcribe_voice(token, message)
            if not question_raw:
                await self._send(
                    token, chat_key,
                    "🎙️ No pude entender el audio. Probá de nuevo o escribilo.",
                    reply_to=message.get("message_id"),
                )
                return
        else:
            return

        # ── permission / PIN resolution (in code, never trusting the model) ──
        question = question_raw
        action_pin = cfg["action_pin"]
        if action_pin and action_pin in question:
            conversation_store.unlock_actions(chat_key, user_id)
            # Strip the PIN so it never reaches the model, logs, or history.
            question = question.replace(action_pin, "").strip()

        is_authorized = user_id in cfg["authorized_ids"]
        if not cfg["actions_enabled"]:
            actions_unlocked = False
        elif not cfg["require_pin"]:
            actions_unlocked = is_authorized
        else:
            actions_unlocked = is_authorized and conversation_store.actions_unlocked(chat_key, user_id)
        actor = Actor(
            user_id=user_id, name=name,
            is_authorized=is_authorized, actions_unlocked=actions_unlocked,
        )

        if not question:
            return

        await self._api(token, "sendChatAction", {"chat_id": chat_key, "action": "typing"})

        history = conversation_store.history(chat_key)
        answer = await assistant.ask(question, actor=actor, history=history)

        # Record the turn so follow-ups and confirmations have context.
        conversation_store.add(chat_key, "user", f"{name}: {question}")
        conversation_store.add(chat_key, "assistant", answer)

        await self._send(token, chat_key, answer, reply_to=message.get("message_id"))


# Singleton
telegram_listener = TelegramListener()
