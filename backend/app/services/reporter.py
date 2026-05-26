"""
Reporter — Weekly report generator that sends production summaries via Telegram.
Runs as a background asyncio task, fires every 7 days.
"""

import asyncio
import logging
from datetime import datetime, timezone, timedelta

from sqlalchemy import select, func, and_

from app.database import async_session
from app.models.print_job import PrintHistory
from app.services.telegram import telegram_notifier

logger = logging.getLogger("printfarm.reporter")

REPORT_INTERVAL_SECS = 7 * 24 * 3600  # 7 days


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
        """Main loop — waits 7 days then generates and sends report."""
        while self._running:
            # Wait 7 days
            await asyncio.sleep(REPORT_INTERVAL_SECS)
            try:
                await self.generate_and_send()
            except Exception as e:
                logger.error(f"Reporter error: {e}", exc_info=True)

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
