"""
Printers Router — CRUD operations, bed clearance, and spool assignment.
The clear-bed endpoint is the critical "Vaciar Cama" action.
"""

import asyncio
from typing import List
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.config import settings
from app.models.printer import Printer
from app.models.print_job import PrintJob
from app.models.maintenance import MaintenanceRecord
from app.schemas.printer import PrinterCreate, PrinterUpdate, PrinterResponse, PrinterAssignSpool, PrinterSetStatus
from app.services.moonraker import moonraker_manager
from app.services.dispatcher import dispatcher
from app.services.gcode_thumbnail import extract_gcode_thumbnail
from app.ws.hub import ws_hub
from datetime import datetime, timezone

router = APIRouter(prefix="/api/printers", tags=["printers"])


@router.get("", response_model=List[PrinterResponse])
async def list_printers(db: AsyncSession = Depends(get_db)):
    """Get all printers with their current state."""
    result = await db.execute(select(Printer).order_by(Printer.id))
    return result.scalars().all()


@router.get("/{printer_id}", response_model=PrinterResponse)
async def get_printer(printer_id: int, db: AsyncSession = Depends(get_db)):
    """Get a single printer by ID."""
    result = await db.execute(select(Printer).where(Printer.id == printer_id))
    printer = result.scalar_one_or_none()
    if not printer:
        raise HTTPException(status_code=404, detail="Printer not found")
    return printer


@router.post("", response_model=PrinterResponse, status_code=201)
async def create_printer(data: PrinterCreate, db: AsyncSession = Depends(get_db)):
    """Add a new printer to the farm."""
    printer = Printer(
        name=data.name,
        model=data.model,
        moonraker_url=data.moonraker_url,
        nozzle_size=data.nozzle_size,
        extruder_type=data.extruder_type,
        filament_tracking_mode=data.filament_tracking_mode,
        fluidd_url=data.fluidd_url,
        camera_url=data.camera_url,
        current_spool_id=data.current_spool_id,
    )
    db.add(printer)
    try:
        await db.flush()  # To get printer.id
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail=f"Ya existe una impresora con la URL de Moonraker '{data.moonraker_url}'.",
        )

    # Create default maintenance records — single source of truth in config,
    # so web-created printers match those seeded from PRINTERS_CONFIG.
    for item in settings.get_maintenance_defaults(printer.extruder_type):
        record = MaintenanceRecord(
            printer_id=printer.id,
            maintenance_type=item["type"],
            threshold_hours=item["hours"],
            last_reset_at=datetime.now(timezone.utc),
        )
        db.add(record)

    await db.commit()
    await db.refresh(printer)

    # Connect to the new printer's Moonraker
    await moonraker_manager.add_printer(printer.id, printer.moonraker_url)

    # Push the new printer to connected frontends (the WS provider upserts it).
    await ws_hub.broadcast_printer_update(printer.to_dict())

    return printer


@router.put("/{printer_id}", response_model=PrinterResponse)
async def update_printer(
    printer_id: int,
    data: PrinterUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update printer configuration."""
    result = await db.execute(select(Printer).where(Printer.id == printer_id))
    printer = result.scalar_one_or_none()
    if not printer:
        raise HTTPException(status_code=404, detail="Printer not found")

    url_changed = False
    for field, value in data.model_dump(exclude_unset=True).items():
        if field == "moonraker_url" and value != printer.moonraker_url:
            url_changed = True
        setattr(printer, field, value)

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Ya existe otra impresora con esa URL de Moonraker.",
        )
    await db.refresh(printer)

    # If the printer is now Bowden, make sure the PTFE-tube maintenance task
    # exists. It's only seeded at creation time, so switching to Bowden on edit
    # would otherwise silently skip it (contradicting what the form promises).
    if printer.extruder_type == "bowden":
        existing = await db.execute(
            select(MaintenanceRecord).where(
                MaintenanceRecord.printer_id == printer.id,
                MaintenanceRecord.maintenance_type == "ptfe_tube",
            )
        )
        if not existing.scalar_one_or_none():
            db.add(MaintenanceRecord(
                printer_id=printer.id,
                maintenance_type="ptfe_tube",
                threshold_hours=settings.default_ptfe_tube_threshold,
                last_reset_at=datetime.now(timezone.utc),
            ))
            await db.commit()
            await ws_hub.broadcast_maintenance_update()

    # Reconnect if URL changed
    if url_changed:
        await moonraker_manager.add_printer(printer.id, printer.moonraker_url)

    await ws_hub.broadcast_printer_update(printer.to_dict())

    return printer


@router.delete("/{printer_id}", status_code=204)
async def delete_printer(printer_id: int, db: AsyncSession = Depends(get_db)):
    """Remove a printer from the farm."""
    result = await db.execute(select(Printer).where(Printer.id == printer_id))
    printer = result.scalar_one_or_none()
    if not printer:
        raise HTTPException(status_code=404, detail="Printer not found")

    await moonraker_manager.remove_printer(printer_id)
    await db.delete(printer)
    await db.commit()

    # Remove the card from connected frontends without needing a reload.
    await ws_hub.broadcast_printer_removed(printer_id)


@router.get("/{printer_id}/thumbnail")
async def get_printer_thumbnail(printer_id: int, db: AsyncSession = Depends(get_db)):
    """Serve the embedded G-code preview of the printer's ACTIVE local job.

    We extract the thumbnail from the file we already stored (independent of the
    printer's own network), so the browser can always reach it. 404 if the
    printer isn't running a manager-dispatched job or the G-code has no preview.
    """
    result = await db.execute(
        select(PrintJob)
        .where(
            PrintJob.assigned_printer_id == printer_id,
            PrintJob.status == "printing",
        )
        .limit(1)
    )
    job = result.scalar_one_or_none()
    if not job or not job.gcode_filename:
        raise HTTPException(status_code=404, detail="No hay preview disponible")

    img = await asyncio.to_thread(extract_gcode_thumbnail, job.gcode_filename)
    if not img:
        raise HTTPException(status_code=404, detail="El G-code no tiene miniatura embebida")

    media_type = "image/jpeg" if img[:2] == b"\xff\xd8" else "image/png"
    return Response(
        content=img,
        media_type=media_type,
        headers={"Cache-Control": "public, max-age=3600"},
    )


@router.post("/{printer_id}/clear-bed")
async def clear_bed(printer_id: int, db: AsyncSession = Depends(get_db)):
    """
    🧹 VACIAR CAMA — The critical bed clearance action.
    Changes status from 'requires_clearance' to 'available',
    then triggers the dispatcher to send the next compatible job.
    """
    result = await db.execute(select(Printer).where(Printer.id == printer_id))
    printer = result.scalar_one_or_none()
    if not printer:
        raise HTTPException(status_code=404, detail="Printer not found")

    if printer.status != "requires_clearance":
        raise HTTPException(
            status_code=400,
            detail=f"Printer is not in 'requires_clearance' state (current: {printer.status})"
        )

    # Complete the current print job
    await dispatcher.on_print_complete(printer_id)

    # Update printer to available. This is the ONE human-confirmed moment the bed
    # is empty, so it's the only place (besides a manual set-to-available) that is
    # allowed to clear the safety flag and re-enable auto-dispatch.
    printer.status = "available"
    printer.bed_cleared = True
    printer.current_job_progress = 0.0
    printer.current_filename = None
    printer.thumbnail_url = None
    await db.commit()
    await db.refresh(printer)

    # Broadcast the update
    await ws_hub.broadcast_printer_update(printer.to_dict())
    await ws_hub.broadcast_queue_update()

    # Try to dispatch the next job
    dispatched = await dispatcher.try_dispatch(printer_id)

    return {
        "status": "ok",
        "printer_status": printer.status if not dispatched else "printing",
        "dispatched": dispatched,
        "message": "Cama vaciada" + (" — nuevo trabajo enviado" if dispatched else " — sin trabajos pendientes compatibles"),
    }


@router.post("/{printer_id}/cancel-print")
async def cancel_print(printer_id: int, db: AsyncSession = Depends(get_db)):
    """
    🛑 Cancelar la impresión en curso de una impresora.
    Frena el print en Klipper, registra el historial como 'cancelled',
    libera el trabajo y deja la impresora en 'requires_clearance'.
    """
    result = await db.execute(select(Printer).where(Printer.id == printer_id))
    printer = result.scalar_one_or_none()
    if not printer:
        raise HTTPException(status_code=404, detail="Printer not found")

    if printer.status != "printing":
        raise HTTPException(
            status_code=400,
            detail=f"La impresora no está imprimiendo (estado: {printer.status})",
        )

    # Stop the print on the machine
    client = moonraker_manager.get_client(printer_id)
    if client and client.is_connected:
        await client.cancel_print()

    # Close out the job + write a 'cancelled' history entry
    await dispatcher.on_print_aborted(printer_id, "cancelled")

    # Move the printer to requires_clearance (there's a half print on the bed)
    printer.status = "requires_clearance"
    printer.current_job_progress = 0.0
    await db.commit()
    await db.refresh(printer)

    await ws_hub.broadcast_printer_update(printer.to_dict())
    await ws_hub.broadcast_queue_update()

    return {"status": "ok", "message": "Impresión cancelada"}


@router.post("/{printer_id}/dispatch")
async def trigger_dispatch(printer_id: int, db: AsyncSession = Depends(get_db)):
    """
    🔍 Manually trigger job dispatch for an idle printer.
    Tries to find the next compatible pending job and send it.
    """
    result = await db.execute(select(Printer).where(Printer.id == printer_id))
    printer = result.scalar_one_or_none()
    if not printer:
        raise HTTPException(status_code=404, detail="Printer not found")

    if printer.status not in ("standby", "available"):
        raise HTTPException(
            status_code=400,
            detail=f"Printer is not idle (current: {printer.status})"
        )

    dispatched = await dispatcher.try_dispatch(printer_id)

    return {
        "status": "ok",
        "dispatched": dispatched,
        "message": "Trabajo enviado" if dispatched else "No hay trabajos compatibles en la cola",
    }


@router.put("/{printer_id}/status")
async def set_printer_status(
    printer_id: int,
    data: PrinterSetStatus,
    db: AsyncSession = Depends(get_db),
):
    """
    Manually set printer status.
    Allowed values: 'available', 'paused', 'requires_clearance'.
    Cannot set to 'printing', 'error', or 'offline' (system-managed).
    """
    ALLOWED_MANUAL_STATUSES = {"available", "paused", "requires_clearance"}
    if data.status not in ALLOWED_MANUAL_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot manually set status to '{data.status}'. "
                   f"Allowed: {', '.join(sorted(ALLOWED_MANUAL_STATUSES))}"
        )

    result = await db.execute(select(Printer).where(Printer.id == printer_id))
    printer = result.scalar_one_or_none()
    if not printer:
        raise HTTPException(status_code=404, detail="Printer not found")

    if printer.status == "printing":
        raise HTTPException(
            status_code=400,
            detail="Cannot change status while printing"
        )
        
    if printer.status in ("offline", "error"):
        raise HTTPException(
            status_code=400,
            detail="La impresora está desconectada o en error. Reiniciá el firmware de Klipper primero."
        )

    old_status = printer.status
    printer.status = data.status

    # If setting to available, clear bed-related fields. Setting 'available' by
    # hand is an explicit human statement that the bed is empty, so it's allowed
    # to clear the safety flag. Any other manual status (paused, requires_clearance)
    # leaves bed_cleared untouched.
    if data.status == "available":
        printer.bed_cleared = True
        printer.current_job_progress = 0.0
        printer.current_filename = None
        printer.thumbnail_url = None

    await db.commit()
    await db.refresh(printer)

    # Broadcast the update
    await ws_hub.broadcast_printer_update(printer.to_dict())

    # If set to available, try to dispatch a job
    if data.status == "available":
        dispatched = await dispatcher.try_dispatch(printer_id)
        if dispatched:
            return {
                "status": "ok",
                "old_status": old_status,
                "new_status": "printing",
                "message": f"Estado cambiado y trabajo asignado automáticamente",
            }

    return {
        "status": "ok",
        "old_status": old_status,
        "new_status": data.status,
        "message": f"Estado cambiado de '{old_status}' a '{data.status}'",
    }


@router.put("/{printer_id}/spool")
async def assign_spool(
    printer_id: int,
    data: PrinterAssignSpool,
    db: AsyncSession = Depends(get_db),
):
    """Assign a Spoolman spool to a printer."""
    result = await db.execute(select(Printer).where(Printer.id == printer_id))
    printer = result.scalar_one_or_none()
    if not printer:
        raise HTTPException(status_code=404, detail="Printer not found")

    printer.current_spool_id = data.spool_id
    await db.commit()
    await db.refresh(printer)

    # Inform Moonraker about the new active spool
    moonraker_client = moonraker_manager.get_client(printer_id)
    if moonraker_client:
        # Don't block the API response, run the HTTP request in the background
        import asyncio
        asyncio.create_task(moonraker_client.set_active_spool(data.spool_id))

    await ws_hub.broadcast_printer_update(printer.to_dict())

    return {"status": "ok", "spool_id": data.spool_id}
