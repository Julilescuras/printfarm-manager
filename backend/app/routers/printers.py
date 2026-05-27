"""
Printers Router — CRUD operations, bed clearance, and spool assignment.
The clear-bed endpoint is the critical "Vaciar Cama" action.
"""

from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.printer import Printer
from app.models.maintenance import MaintenanceRecord
from app.schemas.printer import PrinterCreate, PrinterUpdate, PrinterResponse, PrinterAssignSpool, PrinterSetStatus
from app.services.moonraker import moonraker_manager
from app.services.dispatcher import dispatcher
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
        fluidd_url=data.fluidd_url,
        current_spool_id=data.current_spool_id,
    )
    db.add(printer)
    await db.flush()  # To get printer.id

    # Create default maintenance records
    default_records = [
        ("nozzle_change", 200.0),
        ("belt_tension", 500.0),
        ("z_screw_lube", 300.0),
        ("bed_cleaning", 50.0),
    ]
    if printer.extruder_type == "bowden":
        default_records.append(("ptfe_tube", 400.0))

    for m_type, threshold in default_records:
        record = MaintenanceRecord(
            printer_id=printer.id,
            maintenance_type=m_type,
            threshold_hours=threshold,
            last_reset_at=datetime.now(timezone.utc),
        )
        db.add(record)

    await db.commit()
    await db.refresh(printer)

    # Connect to the new printer's Moonraker
    await moonraker_manager.add_printer(printer.id, printer.moonraker_url)

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

    await db.commit()
    await db.refresh(printer)

    # Reconnect if URL changed
    if url_changed:
        await moonraker_manager.add_printer(printer.id, printer.moonraker_url)

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

    # Update printer to available
    printer.status = "available"
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

    old_status = printer.status
    printer.status = data.status

    # If setting to available, clear bed-related fields
    if data.status == "available":
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
