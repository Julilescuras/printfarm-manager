"""
Reporter — Weekly report generator that sends production summaries via Telegram.

Scheduling is persistent and configurable (settings in DB):
  - weekly_report_enabled: "true" | "false" (default true)
  - weekly_report_day:  0=lunes … 6=domingo (default 4 = viernes)
  - weekly_report_hour: 0-23, hora local del servidor (default 9)
  - weekly_report_last_sent: ISO date of the last report (managed automatically)

The loop checks every few minutes whether the configured day/hour was reached
and whether a report was already sent that day. Because the last-sent date is
persisted in the DB, backend restarts (e.g. every update) no longer reset the
schedule — this replaces the old "sleep 7 days from boot" logic that in
practice never fired.
"""

import asyncio
import logging
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select, and_

from app.database import async_session
from app.models.print_job import PrintHistory
from app.models.settings import AppSettings
from app.services.telegram import telegram_notifier

logger = logging.getLogger("printfarm.reporter")

CHECK_INTERVAL_SECS = 5 * 60  # how often we evaluate the schedule

DEFAULT_DAY = 4   # viernes (0 = lunes)
DEFAULT_HOUR = 9
DEFAULT_TZ = "America/Argentina/Buenos_Aires"


class WeeklyReporter:
    """Generates and sends weekly production reports via Telegram."""

    def __init__(self):
        self._running = False
        self._task = None

    async def start(self):
        """Start the weekly reporter background task."""
        self._running = True
        self._task = asyncio.create_task(self._report_loop())
        logger.info("Weekly reporter started")

    async def stop(self):
        """Stop the reporter."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Weekly reporter stopped")

    async def _report_loop(self):
        """Main loop — periodically checks whether the report is due."""
        while self._running:
            try:
                if await self._is_due():
                    await self.generate_and_send()
                    await self._mark_sent()
            except Exception as e:
                logger.error(f"Reporter error: {e}", exc_info=True)
            await asyncio.sleep(CHECK_INTERVAL_SECS)

    # ── scheduling ──────────────────────────────────────────────────────────

    async def _get_config(self) -> dict:
        async with async_session() as session:
            rows = (await session.execute(select(AppSettings))).scalars().all()
        cfg = {s.key: s.value for s in rows}

        def _int(key: str, default: int, lo: int, hi: int) -> int:
            try:
                val = int(cfg.get(key, ""))
                return val if lo <= val <= hi else default
            except (ValueError, TypeError):
                return default

        return {
            "enabled": cfg.get("weekly_report_enabled", "true").lower() != "false",
            "day": _int("weekly_report_day", DEFAULT_DAY, 0, 6),
            "hour": _int("weekly_report_hour", DEFAULT_HOUR, 0, 23),
            "last_sent": cfg.get("weekly_report_last_sent", ""),
        }

    def _now_local(self) -> datetime:
        try:
            return datetime.now(ZoneInfo(DEFAULT_TZ))
        except Exception:
            # tz database unavailable in the container — fall back to UTC
            return datetime.now(timezone.utc)

    async def _is_due(self) -> bool:
        cfg = await self._get_config()
        if not cfg["enabled"]:
            return False

        now = self._now_local()
        if now.weekday() != cfg["day"] or now.hour < cfg["hour"]:
            return False

        # Already sent today?
        return cfg["last_sent"] != now.date().isoformat()

    async def _mark_sent(self):
        today = self._now_local().date().isoformat()
        async with async_session() as session:
            result = await session.execute(
                select(AppSettings).where(AppSettings.key == "weekly_report_last_sent")
            )
            setting = result.scalar_one_or_none()
            if setting:
                setting.value = today
            else:
                session.add(AppSettings(key="weekly_report_last_sent", value=today))
            await session.commit()

    # ── report generation ─────────────────────────────────────────────────────

    async def generate_and_send(self):
        """Generate the weekly report and send it via Telegram."""
        now = datetime.now(timezone.utc)
        week_ago = now - timedelta(days=7)

        async with async_session() as session:
            # Get all history entries from the last 7 days
            result = await session.execute(
                select(PrintHistory).where(
                    and_(
                        PrintHistory.completed_at >= week_ago,
                        PrintHistory.completed_at <= now,
                    )
                )
            )
            entries = result.scalars().all()

        if not entries:
            await telegram_notifier.send_message(
                "📊 <b>Reporte Semanal</b>\n\n"
                "No hubo actividad de impresión esta semana."
            )
            return

        # Calculate stats
        total = len(entries)
        successful = sum(1 for e in entries if e.result == "success")
        failed = sum(1 for e in entries if e.result == "failed")
        cancelled = sum(1 for e in entries if e.result == "cancelled")

        total_duration = sum(e.duration_secs or 0 for e in entries)
        total_hours = total_duration / 3600.0

        total_weight = sum(e.estimated_weight_g or 0 for e in entries)
        total_weight_kg = total_weight / 1000.0

        # Most productive printer
        printer_counts: dict[str, int] = {}
        for e in entries:
            name = e.printer_name or f"Impresora #{e.printer_id}"
            printer_counts[name] = printer_counts.get(name, 0) + 1

        top_printer = max(printer_counts, key=printer_counts.get) if printer_counts else "N/A"
        top_count = printer_counts.get(top_printer, 0)

        # Format the report
        report = (
            f"📊 <b>Reporte Semanal de Producción</b>\n"
            f"📅 {week_ago.strftime('%d/%m')} — {now.strftime('%d/%m/%Y')}\n\n"
            f"✅ Completadas: <b>{successful}</b>\n"
            f"❌ Fallidas: <b>{failed}</b>\n"
            f"🚫 Canceladas: <b>{cancelled}</b>\n"
            f"📊 Total: <b>{total}</b>\n\n"
            f"⏱️ Horas de impresión: <b>{total_hours:.1f}h</b>\n"
            f"🧵 Filamento usado: <b>{total_weight_kg:.2f} kg</b> ({total_weight:.0f}g)\n\n"
            f"🏆 Impresora más productiva: <b>{top_printer}</b> ({top_count} impresiones)"
        )

        await telegram_notifier.send_message(report)
        logger.info("Weekly report sent via Telegram")


# Singleton
weekly_reporter = WeeklyReporter()
