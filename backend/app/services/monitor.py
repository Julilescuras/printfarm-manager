"""
Monitor — Background task that periodically checks maintenance thresholds
and updates accumulated print hours from Moonraker's total_print_time.
"""

import asyncio
import logging

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

    def __init__(self):
        self._running = False
        self._task = None

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
        """Check all maintenance records against their thresholds.

        This loop is the single source of truth for alert transitions: it
        detects when accumulated hours cross the threshold, fires the Telegram
        notification once, and pushes a maintenance update to the frontend.
        """
        any_change = False
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

        # Notify connected frontends outside the DB session
        if any_change:
            from app.ws.hub import ws_hub
            await ws_hub.broadcast_maintenance_update()

    async def update_print_hours(self, printer_id: int, print_duration_secs: float):
        """
        Update accumulated maintenance hours when a print completes.
        Called by the dispatcher/moonraker when a print finishes.
        """
        hours = print_duration_secs / 3600.0

        async with async_session() as session:
            result = await session.execute(
                select(MaintenanceRecord).where(
                    MaintenanceRecord.printer_id == printer_id
                )
            )
            records = result.scalars().all()

            for record in records:
                record.accumulated_hours += hours
                # NOTE: we intentionally do NOT flip is_alert_active here.
                # The monitor loop owns alert transitions so it can fire the
                # Telegram notification exactly once when the threshold is crossed.

            await session.commit()
            logger.info(
                f"Updated maintenance hours for printer {printer_id}: +{hours:.2f}h"
            )


# Singleton
monitor = Monitor()
