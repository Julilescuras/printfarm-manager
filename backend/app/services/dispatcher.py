"""
Dispatcher — Automatic G-code dispatch logic.

When a printer becomes 'available' (after bed clearance), this service
finds the next compatible pending job in the queue, uploads the G-code
to Moonraker, and starts the print.

Matching logic:
1. Job's compatible_models must include the printer's model
2. Job's required_nozzle must match the printer's nozzle_size
3. Job's required_material must match the loaded spool's material
4. Job's required_color (if set) must match the loaded spool's color
5. Job's estimated_weight_g must not exceed the spool's remaining_weight
"""

import json
import logging
import os
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session
from app.models.printer import Printer
from app.models.print_job import PrintJob, PrintHistory
from app.services.moonraker import moonraker_manager
from app.services.spoolman import spoolman_client

logger = logging.getLogger("printfarm.dispatcher")


class Dispatcher:
    """Handles automatic job dispatch to available printers."""

    async def try_dispatch(self, printer_id: int) -> bool:
        """
        Try to dispatch the next compatible job to the given printer.
        Returns True if a job was dispatched, False otherwise.
        """
        async with async_session() as session:
            # Get the printer
            result = await session.execute(
                select(Printer).where(Printer.id == printer_id)
            )
            printer = result.scalar_one_or_none()

            if not printer:
                logger.error(f"Printer {printer_id} not found")
                return False

            if printer.status not in ("available", "standby"):
                logger.info(f"Printer {printer_id} is not available (status={printer.status})")
                return False

            # Get the loaded spool info from Spoolman
            spool_material = None
            spool_color = None
            spool_remaining = None
            if printer.current_spool_id:
                spool_info = await spoolman_client.get_spool_info(printer.current_spool_id)
                if spool_info:
                    spool_material = spool_info.get("material", "").upper()
                    spool_color = spool_info.get("color_hex", "")
                    spool_remaining = spool_info.get("remaining_weight")

            # Find matching pending jobs, ordered by priority DESC, then created_at ASC
            result = await session.execute(
                select(PrintJob)
                .where(
                    and_(
                        PrintJob.status == "pending",
                        PrintJob.copies_completed < PrintJob.copies,
                    )
                )
                .order_by(PrintJob.priority.desc(), PrintJob.created_at.asc())
            )
            pending_jobs = result.scalars().all()

            for job in pending_jobs:
                if self._is_compatible(job, printer, spool_material, spool_color, spool_remaining):
                    success = await self._dispatch_job(session, job, printer)
                    if success:
                        return True

            logger.info(f"No compatible jobs found for printer {printer_id} ({printer.name})")
            return False

    def _is_compatible(
        self,
        job: PrintJob,
        printer: Printer,
        spool_material: Optional[str],
        spool_color: Optional[str],
        spool_remaining: Optional[float],
    ) -> bool:
        """Check if a job is compatible with a printer's current configuration."""

        # 1. Check model compatibility
        try:
            compatible_models = json.loads(job.compatible_models)
        except (json.JSONDecodeError, TypeError):
            compatible_models = []

        if compatible_models and printer.model not in compatible_models:
            return False

        # 2. Check nozzle size
        if abs(job.required_nozzle - printer.nozzle_size) > 0.01:
            return False

        # 3. Check material (if spool is loaded)
        if spool_material and job.required_material:
            if job.required_material.upper() != spool_material:
                return False

        # 4. Check color (if specified and spool info available)
        if job.required_color and spool_color:
            if job.required_color.lower() != spool_color.lower():
                return False

        # 5. Check filament remaining weight
        if (
            job.estimated_weight_g
            and spool_remaining is not None
            and spool_remaining > 0
        ):
            if job.estimated_weight_g > spool_remaining:
                logger.info(
                    f"Job '{job.name}' needs {job.estimated_weight_g:.0f}g but spool "
                    f"only has {spool_remaining:.0f}g remaining — skipping"
                )
                return False

        return True

    async def _dispatch_job(
        self, session: AsyncSession, job: PrintJob, printer: Printer
    ) -> bool:
        """Upload G-code and start print on the printer."""
        client = moonraker_manager.get_client(printer.id)
        if not client or not client.is_connected:
            logger.warning(f"Moonraker client not available for printer {printer.id}")
            return False

        gcode_path = job.gcode_filename
        gcode_name = os.path.basename(gcode_path)

        # Upload G-code to Moonraker
        if not os.path.exists(gcode_path):
            logger.error(f"G-code file not found: {gcode_path}")
            return False

        uploaded = await client.upload_gcode(gcode_path, gcode_name)
        if not uploaded:
            return False

        # Start the print
        started = await client.start_print(gcode_name)
        if not started:
            return False

        # Try to get thumbnail
        thumbnail = await client.get_thumbnail_url(gcode_name)

        # Update job status
        job.status = "printing"
        job.assigned_printer_id = printer.id

        # Update printer status
        printer.status = "printing"
        printer.current_filename = gcode_name
        printer.current_job_progress = 0.0
        if thumbnail:
            printer.thumbnail_url = thumbnail

        await session.commit()

        logger.info(
            f"✅ Dispatched '{job.name}' to {printer.name} ({printer.model})"
        )
        return True

    async def on_print_complete(self, printer_id: int):
        """
        Called when a print completes. Updates the job record,
        creates a history entry, and checks if more copies are needed.
        """
        async with async_session() as session:
            # Find the active job on this printer
            result = await session.execute(
                select(PrintJob).where(
                    and_(
                        PrintJob.assigned_printer_id == printer_id,
                        PrintJob.status == "printing",
                    )
                )
            )
            job = result.scalar_one_or_none()

            # Get printer info for the history record
            result = await session.execute(
                select(Printer).where(Printer.id == printer_id)
            )
            printer = result.scalar_one_or_none()

            if job:
                job.copies_completed += 1

                # Create history entry
                history = PrintHistory(
                    print_job_id=job.id,
                    printer_id=printer_id,
                    printer_name=printer.name if printer else "",
                    job_name=job.name,
                    gcode_filename=job.gcode_original_name,
                    material=job.required_material,
                    estimated_weight_g=job.estimated_weight_g,
                    completed_at=datetime.now(timezone.utc),
                    duration_secs=printer.total_print_time_secs if printer else None,
                    result="success",
                )
                session.add(history)

                if job.copies_completed >= job.copies:
                    job.status = "completed"
                    logger.info(f"Job '{job.name}' completed all {job.copies} copies")
                else:
                    # More copies needed — job stays pending for next dispatch
                    job.status = "pending"
                    job.assigned_printer_id = None
                    logger.info(
                        f"Job '{job.name}' completed copy {job.copies_completed}/{job.copies}"
                    )
                await session.commit()

    async def try_dispatch_all(self):
        """Try to dispatch jobs to ALL available/standby printers.
        Called when new jobs are added to the queue."""
        async with async_session() as session:
            result = await session.execute(
                select(Printer).where(
                    Printer.status.in_(["available", "standby"])
                )
            )
            idle_printers = result.scalars().all()

        for printer in idle_printers:
            await self.try_dispatch(printer.id)


# Singleton
dispatcher = Dispatcher()
