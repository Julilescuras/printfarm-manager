"""
TelegramNotifier — Sends notifications to a Telegram group via Bot API.
"""

import logging
from typing import Optional

import httpx
from sqlalchemy import select

from app.database import async_session
from app.models.settings import AppSettings

logger = logging.getLogger("printfarm.telegram")

TELEGRAM_API = "https://api.telegram.org"


class TelegramNotifier:
    """Sends messages to a configured Telegram group."""

    async def _get_config(self) -> tuple[Optional[str], Optional[str], bool]:
        """Fetch Telegram config from the database."""
        async with async_session() as session:
            result = await session.execute(select(AppSettings))
            settings = {s.key: s.value for s in result.scalars().all()}

        bot_token = settings.get("telegram_bot_token", "")
        chat_id = settings.get("telegram_chat_id", "")
        enabled = settings.get("telegram_enabled", "false").lower() == "true"

        return (bot_token or None, chat_id or None, enabled)

    async def send_message(self, text: str, force: bool = False) -> bool:
        """
        Send a message to the configured Telegram group.
        Returns True if sent successfully.
        If force=True, sends even if notifications are disabled (for test messages).
        """
        bot_token, chat_id, enabled = await self._get_config()

        if not bot_token or not chat_id:
            logger.debug("Telegram not configured, skipping notification")
            return False

        if not enabled and not force:
            logger.debug("Telegram notifications disabled, skipping")
            return False

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(
                    f"{TELEGRAM_API}/bot{bot_token}/sendMessage",
                    json={
                        "chat_id": chat_id,
                        "text": text,
                        "parse_mode": "HTML",
                    },
                )
                if response.status_code == 200:
                    logger.info("Telegram message sent successfully")
                    return True
                else:
                    logger.error(
                        f"Telegram API error: {response.status_code} {response.text}"
                    )
                    return False
        except Exception as e:
            logger.error(f"Telegram send error: {e}")
            return False

    # --- Pre-built notification messages ---

    async def notify_print_complete(self, printer_name: str, job_name: str):
        """Notify that a print job has completed."""
        await self.send_message(
            f"✅ <b>Impresión completada</b>\n"
            f"📄 {job_name}\n"
            f"🖨️ {printer_name}\n"
            f"🧹 La cama necesita ser vaciada."
        )

    async def notify_printer_error(self, printer_name: str):
        """Notify that a printer has an error."""
        await self.send_message(
            f"❌ <b>Error en impresora</b>\n"
            f"🖨️ {printer_name}\n"
            f"Revisá la impresora lo antes posible."
        )

    async def notify_maintenance_alert(
        self, printer_name: str, maintenance_type: str, hours: float
    ):
        """Notify that a maintenance threshold was reached."""
        type_labels = {
            "nozzle_change": "Cambio de boquilla",
            "belt_tension": "Tensión de correas",
            "lubrication": "Lubricación",
            "bed_leveling": "Nivelación de cama",
            "bed_cleaning": "Limpieza de cama",
            "ptfe_tube": "Tubo PTFE",
            "extruder_gears": "Engranajes del extrusor",
            "hotend_cleaning": "Limpieza del hotend",
            "z_screw_lube": "Lubricación husillo Z",
            "firmware_check": "Revisión de firmware",
        }
        label = type_labels.get(maintenance_type, maintenance_type)
        await self.send_message(
            f"⚠️ <b>Alerta de mantenimiento</b>\n"
            f"🖨️ {printer_name}\n"
            f"🔧 {label} — {hours:.0f}h acumuladas"
        )


# Singleton
telegram_notifier = TelegramNotifier()
