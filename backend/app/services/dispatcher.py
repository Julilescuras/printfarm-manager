"""
Dispatcher — Automatic G-code dispatch logic.

When a printer becomes 'available' (after bed clearance), this service
finds the next compatible pending job in the queue, uploads the G-code
to Moonraker, and starts the print.

Matching logic:
1. Job's compatible_models must include the printer's model (case-insensitive)
2. Job's required_nozzle must match the printer's nozzle_size
3. Job's required_material must match the loaded spool's material
4. Job's required_color (hex) must match the loaded spool's color_hex
5. Job's estimated_weight_g must not exceed the spool's remaining_weight

Auto-dispatch: A background loop runs every 30 seconds, scanning all
idle printers and trying to assign them pending jobs.
"""

import asyncio
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
from app.config import settings

logger = logging.getLogger("printfarm.dispatcher")

AUTO_DISPATCH_INTERVAL = 30  # seconds


class Dispatcher:
    """Handles automatic job dispatch to available printers."""

    def __init__(self):
        self._auto_dispatch_task: Optional[asyncio.Task] = None
        self._running = False
        # Serializes ALL dispatch decisions. Without it, the 30s auto-loop and
        # the endpoint triggers (add_job, clone, requeue, clear-bed, set status)
        # can overlap: between selecting a pending job and committing the start
        # there are long awaits (Spoolman HTTP + G-code upload), so two dispatches
        # to different printers could grab the SAME job and start it on both.
        self._dispatch_lock = asyncio.Lock()

    # ── Auto-dispatch loop ──────────────────────────────────────────

    async def start_auto_dispatch(self):
        """Start the background auto-dispatch loop."""
        self._running = True
        self._auto_dispatch_task = asyncio.create_task(self._auto_dispatch_loop())
        logger.info(f"Auto-dispatch loop started (interval={AUTO_DISPATCH_INTERVAL}s)")

    async def stop_auto_dispatch(self):
        """Stop the background auto-dispatch loop."""
        self._running = False
        if self._auto_dispatch_task:
            self._auto_dispatch_task.cancel()
            try:
                await self._auto_dispatch_task
            except asyncio.CancelledError:
                pass
        logger.info("Auto-dispatch loop stopped")

    async def _auto_dispatch_loop(self):
        """Periodically reconcile stale jobs and dispatch to idle printers."""
        while self._running:
            try:
                # Self-heal first: close jobs stuck in 'printing' that no longer
                # match what the printer is actually doing (e.g. the print
                # finished/cancelled while the backend was down).
                await self.reconcile_stale_jobs()
                await self.try_dispatch_all()
            except Exception as e:
                logger.error(f"Auto-dispatch error: {e}", exc_info=True)
            await asyncio.sleep(AUTO_DISPATCH_INTERVAL)

    # ── Core dispatch logic ─────────────────────────────────────────

    async def try_dispatch(self, printer_id: int) -> bool:
        """
        Try to dispatch the next compatible job to the given printer.
        Returns True if a job was dispatched, False otherwise.

        Held under a global lock so the whole "pick a pending job → start it"
        sequence is atomic across concurrent callers (auto-loop + endpoints).
        """
        async with self._dispatch_lock, async_session() as session:
            # Get the printer
            result = await session.execute(
                select(Printer).where(Printer.id == printer_id)
            )
            printer = result.scalar_one_or_none()

            if not printer:
                logger.error(f"Printer {printer_id} not found")
                return False

            if printer.status not in ("available", "standby"):
                logger.debug(f"Printer {printer_id} is not available (status={printer.status})")
                return False

            # Get the loaded spool info from Spoolman
            spool_material = None
            spool_color = None
            spool_remaining = None
            spool_filament_id = None
            if printer.current_spool_id:
                spool_info = await spoolman_client.get_spool_info(printer.current_spool_id)
                if spool_info:
                    spool_material = spool_info.get("material", "").upper()
                    spool_color = spool_info.get("color_hex", "")
                    spool_remaining = spool_info.get("remaining_weight")
                    spool_filament_id = (spool_info.get("filament") or {}).get("id")

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

            if not pending_jobs:
                logger.debug(f"No pending jobs in queue for printer {printer_id} ({printer.name})")
                return False

            for job in pending_jobs:
                compatible, reason = self._is_compatible(
                    job, printer, spool_material, spool_color,
                    spool_remaining, spool_filament_id,
                )
                if compatible:
                    success = await self._dispatch_job(session, job, printer)
                    if success:
                        return True
                else:
                    logger.debug(
                        f"Job '{job.name}' (id={job.id}) not compatible with "
                        f"printer '{printer.name}' (id={printer.id}): {reason}"
                    )

            logger.info(f"No compatible jobs found for printer {printer_id} ({printer.name})")
            return False

    def _is_compatible(
        self,
        job: PrintJob,
        printer: Printer,
        spool_material: Optional[str],
        spool_color: Optional[str],
        spool_remaining: Optional[float],
        spool_filament_id: Optional[int] = None,
    ) -> tuple[bool, str]:
        """
        Check if a job is compatible with a printer's current configuration.
        Returns (is_compatible, reason_if_not).
        """

        # 1. Check model compatibility (CASE-INSENSITIVE)
        try:
            compatible_models = json.loads(job.compatible_models)
        except (json.JSONDecodeError, TypeError):
            compatible_models = []

        if compatible_models:
            # Normalize both sides to lowercase for comparison
            models_lower = [m.strip().lower() for m in compatible_models]
            if printer.model.strip().lower() not in models_lower:
                return False, (
                    f"Model mismatch: printer='{printer.model}' "
                    f"not in job models={compatible_models}"
                )

        # 2. Check nozzle size
        if abs(job.required_nozzle - printer.nozzle_size) > 0.01:
            return False, (
                f"Nozzle mismatch: job requires {job.required_nozzle}mm, "
                f"printer has {printer.nozzle_size}mm"
            )

        # 3. Filament match.
        #    Preferred path: the job pins a specific Spoolman filament. The loaded
        #    spool MUST be of exactly that filament — material and color then match
        #    by definition. This is deterministic and avoids the fragile hex
        #    comparison that silently passed when either side lacked a color.
        if job.required_filament_id is not None:
            if spool_filament_id is None:
                return False, "No spool loaded (or spool has no Spoolman filament)"
            if int(spool_filament_id) != int(job.required_filament_id):
                return False, (
                    f"Filament mismatch: job requires filament "
                    f"#{job.required_filament_id}, spool has #{spool_filament_id}"
                )
        else:
            # Legacy fallback for jobs created before filament-based matching:
            # compare material + color directly.
            if not spool_material:
                return False, "No spool loaded on printer"

            if job.required_material:
                if job.required_material.upper() != spool_material:
                    return False, (
                        f"Material mismatch: job requires '{job.required_material}', "
                        f"spool has '{spool_material}'"
                    )

            # Color check (hex, case-insensitive). If the job demands a color we
            # must NOT pass when the spool color is unknown — that was the bug
            # that let a cyan job print on a yellow spool.
            if job.required_color:
                if not spool_color:
                    return False, (
                        f"Color required ('{job.required_color}') but the loaded "
                        f"spool has no color in Spoolman"
                    )
                job_color = job.required_color.strip().lstrip("#").lower()
                spool_color_clean = spool_color.strip().lstrip("#").lower()
                if job_color != spool_color_clean:
                    return False, (
                        f"Color mismatch: job requires '{job.required_color}', "
                        f"spool has '{spool_color}'"
                    )

        # 4. Check filament remaining weight
        if (
            job.estimated_weight_g
            and spool_remaining is not None
            and spool_remaining > 0
        ):
            if job.estimated_weight_g > spool_remaining:
                return False, (
                    f"Weight: job needs {job.estimated_weight_g:.0f}g but spool "
                    f"only has {spool_remaining:.0f}g remaining"
                )

        return True, ""

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
        upload_folder = settings.moonraker_upload_folder
        moonraker_path = f"{upload_folder}/{gcode_name}" if upload_folder else gcode_name

        # Upload G-code to Moonraker
        if not os.path.exists(gcode_path):
            logger.error(f"G-code file not found: {gcode_path}")
            return False

        uploaded = await client.upload_gcode(gcode_path, gcode_name, folder=upload_folder)
        if not uploaded:
            return False

        # Start the print
        started = await client.start_print(moonraker_path)
        if not started:
            return False

        # Update job status
        job.status = "printing"
        job.assigned_printer_id = printer.id
        job.started_at = datetime.now(timezone.utc)

        # Update printer status. The G-code preview is now served by the manager
        # from the stored file (see /api/printers/{id}/thumbnail), so there's no
        # need to fetch a thumbnail URL from Moonraker here.
        printer.status = "printing"
        printer.disconnected_while_printing = False
        printer.current_filename = gcode_name
        printer.current_job_progress = 0.0

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
                    started_at=job.started_at,
                    completed_at=datetime.now(timezone.utc),
                    duration_secs=printer.total_print_time_secs if printer else None,
                    result="success",
                )
                session.add(history)

                # NOTE: lifetime/maintenance hours are credited live by the
                # monitor loop from total_print_time_secs. We must NOT add them
                # here too, or the print would be counted twice.

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

                # Refresh the queue UI (this runs both when the print finishes
                # and when the bed is cleared; the second call is a harmless no-op)
                from app.ws.hub import ws_hub
                await ws_hub.broadcast_queue_update()

    async def on_print_aborted(self, printer_id: int, result: str = "cancelled"):
        """
        Called when a print is cancelled or fails. Marks the active job as
        cancelled, writes a history entry (result='cancelled'|'failed'), and
        frees the job so it leaves the 'En Impresión' tab.

        Idempotent: if no 'printing' job is found (e.g. the queue endpoint
        already closed it), this is a no-op.
        """
        async with async_session() as session:
            result_q = await session.execute(
                select(PrintJob).where(
                    and_(
                        PrintJob.assigned_printer_id == printer_id,
                        PrintJob.status == "printing",
                    )
                )
            )
            job = result_q.scalar_one_or_none()
            if not job:
                return

            result_q = await session.execute(
                select(Printer).where(Printer.id == printer_id)
            )
            printer = result_q.scalar_one_or_none()

            history = PrintHistory(
                print_job_id=job.id,
                printer_id=printer_id,
                printer_name=printer.name if printer else "",
                job_name=job.name,
                gcode_filename=job.gcode_original_name,
                material=job.required_material,
                estimated_weight_g=job.estimated_weight_g,
                started_at=job.started_at,
                completed_at=datetime.now(timezone.utc),
                duration_secs=printer.total_print_time_secs if printer else None,
                result=result,
            )
            session.add(history)

            job.status = "cancelled"
            job.assigned_printer_id = None
            await session.commit()
            logger.info(f"Job '{job.name}' marked {result} on printer {printer_id}")

        # Notify frontends the queue changed
        from app.ws.hub import ws_hub
        await ws_hub.broadcast_queue_update()

    async def reconcile_stale_jobs(self):
        """Close jobs stuck in 'printing' that no longer reflect reality.

        A job is considered live only if its assigned printer is currently
        'printing' the SAME file. Otherwise (printer idle/cleared/printing
        something else) the print already ended but we never got the event —
        so we close the job and write a history entry. Printers that are
        'offline' are left untouched (the print may still be running).
        """
        async with async_session() as session:
            result = await session.execute(
                select(PrintJob).where(PrintJob.status == "printing")
            )
            jobs = result.scalars().all()
            if not jobs:
                return

            result = await session.execute(select(Printer))
            printers = {p.id: p for p in result.scalars().all()}

            changed = False
            for job in jobs:
                printer = printers.get(job.assigned_printer_id) if job.assigned_printer_id else None

                # No printer assigned → orphan; just cancel (no history)
                if printer is None:
                    job.status = "cancelled"
                    job.assigned_printer_id = None
                    changed = True
                    logger.info(f"Reconcile: job '{job.name}' had no printer → cancelled")
                    continue

                # Unknown state → leave it; the print might still be running
                if printer.status == "offline":
                    continue

                # Only act on a FRESH reading. If the Moonraker client isn't
                # connected yet (e.g. right after a backend restart), its DB
                # status may be stale/transient — skip to avoid closing a job
                # whose printer is actually still printing.
                client = moonraker_manager.get_client(printer.id)
                if not client or not client.is_connected:
                    continue

                job_file = os.path.basename(job.gcode_filename or "")
                printer_file = os.path.basename(printer.current_filename or "")
                is_live = (
                    printer.status == "printing"
                    and printer_file
                    and printer_file == job_file
                )
                if is_live:
                    continue

                # Stale → close it
                result_kind = "failed" if printer.status == "error" else "success"
                history = PrintHistory(
                    print_job_id=job.id,
                    printer_id=printer.id,
                    printer_name=printer.name,
                    job_name=job.name,
                    gcode_filename=job.gcode_original_name,
                    material=job.required_material,
                    estimated_weight_g=job.estimated_weight_g,
                    started_at=job.started_at,
                    completed_at=datetime.now(timezone.utc),
                    duration_secs=None,
                    result=result_kind,
                )
                session.add(history)
                if result_kind == "success":
                    job.copies_completed = job.copies
                    job.status = "completed"
                else:
                    job.status = "cancelled"
                job.assigned_printer_id = None
                changed = True
                logger.info(
                    f"Reconcile: closed stale job '{job.name}' as {job.status} "
                    f"(printer {printer.name} status={printer.status})"
                )

            if changed:
                await session.commit()
                from app.ws.hub import ws_hub
                await ws_hub.broadcast_queue_update()

    async def try_dispatch_all(self):
        """Try to dispatch jobs to ALL available/standby printers.
        Called periodically by the auto-dispatch loop and when new jobs are added."""
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
