"""
Monitor — Background task that periodically checks maintenance thresholds
and updates accumulated print hours from Moonraker's total_print_time.
"""

import asyncio
import logging
import time

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session
from app.models.printer import Printer
from app.models.maintenance import MaintenanceRecord
from app.config import settings
from app.services.telegram import telegram_notifier

logger = logging.getLogger("printfarm.monitor")


class Monitor:
    """Background monitoring for maintenance alerts."""

    # Persist live hour-credits at most this often. The crediting itself loses
    # nothing by waiting (the delta is computed against the DB high-water mark),
    # but committing + broadcasting every poll (10s) made every client refetch
    # maintenance constantly during prints.
    CREDIT_COMMIT_INTERVAL_SECS = 60

    def __init__(self):
        self._running = False
        self._task = None
        self._last_credit_time = 0.0

    async def start(self):
        """Start the monitoring loop."""
        self._running = True
        self._task = asyncio.create_task(self._monitor_loop())
        logger.info("Maintenance monitor started")

    async def stop(self):
        """Stop the monitoring loop."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Maintenance monitor stopped")

    async def _monitor_loop(self):
        """Main monitoring loop — runs every monitor_poll_interval seconds."""
        while self._running:
            try:
                await self._check_maintenance_alerts()
            except Exception as e:
                logger.error(f"Monitor error: {e}", exc_info=True)

            await asyncio.sleep(settings.monitor_poll_interval)

    async def _check_maintenance_alerts(self):
        """Credit live print hours and check maintenance thresholds.

        This loop is the single source of truth for BOTH:
          1. Crediting accumulated print time (incrementally, every poll) to each
             maintenance record AND to the printer's lifetime counter, so the
             numbers move in real time during a print instead of jumping only
             when it finishes.
          2. Alert transitions: detecting when accumulated hours cross the
             threshold, firing the Telegram notification exactly once, and
             pushing a maintenance update to the frontend.
        """
        any_change = False
        now = time.time()
        credit_due = (now - self._last_credit_time) >= self.CREDIT_COMMIT_INTERVAL_SECS
        async with async_session() as session:
            # Get all printers with their total print time
            result = await session.execute(select(Printer))
            printers = result.scalars().all()

            for printer in printers:
                if printer.status == "offline":
                    continue

                # Get maintenance records for this printer
                result = await session.execute(
                    select(MaintenanceRecord).where(
                        MaintenanceRecord.printer_id == printer.id
                    )
                )
                records = result.scalars().all()

                # ── Live print-hour crediting ──────────────────────────────
                # total_print_time_secs is Klipper's print_duration (tiempo real
                # de impresión, excluye pausas): crece durante un print y
                # resetea a ~0 cuando empieza uno nuevo. We
                # credit only the *new* seconds since the last poll (the delta),
                # using maint_credited_secs as the high-water mark.
                current = printer.total_print_time_secs or 0
                credited = printer.maint_credited_secs or 0
                if current < credited:
                    # Klipper counter reset → a new print began. Rebase.
                    credited = 0
                delta_secs = current - credited
                if delta_secs > 0 and credit_due:
                    delta_hours = delta_secs / 3600.0
                    for record in records:
                        record.accumulated_hours += delta_hours
                    printer.lifetime_print_seconds = (printer.lifetime_print_seconds or 0) + delta_secs
                    printer.maint_credited_secs = current
                    any_change = True

                for record in records:
                    # The accumulated_hours delta is tracked from the last reset
                    accumulated_hours = record.accumulated_hours

                    # Check threshold
                    was_active = record.is_alert_active
                    is_active = accumulated_hours >= record.threshold_hours

                    if is_active == was_active:
                        continue  # No transition — nothing to persist

                    record.is_alert_active = is_active
                    any_change = True

                    if is_active:
                        logger.warning(
                            f"⚠️ MAINTENANCE ALERT: {printer.name} — "
                            f"{record.maintenance_type} at {accumulated_hours:.1f}h "
                            f"(threshold: {record.threshold_hours:.1f}h)"
                        )
                        # Send Telegram notification
                        asyncio.create_task(
                            telegram_notifier.notify_maintenance_alert(
                                printer.name,
                                record.maintenance_type,
                                accumulated_hours,
                            )
                        )

            # Only write to the DB when an alert state actually changed
            if any_change:
                await session.commit()
                if credit_due:
                    self._last_credit_time = now

        # Notify connected frontends outside the DB session.
        # any_change covers both live hour crediting and alert transitions, so
        # the maintenance UI updates in real time during prints.
        if any_change:
            from app.ws.hub import ws_hub
            await ws_hub.broadcast_maintenance_update()


# Singleton
monitor = Monitor()
