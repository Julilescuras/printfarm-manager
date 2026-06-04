"""
Maintenance Router — Manage maintenance records, alerts, counter resets, and history log.
"""

from datetime import datetime, timezone
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.maintenance import MaintenanceRecord, MaintenanceLog
from app.schemas.maintenance import (
    MaintenanceRecordCreate,
    MaintenanceRecordUpdate,
    MaintenanceResetRequest,
    MaintenanceRecordResponse,
    MaintenanceLogResponse,
)
from app.ws.hub import ws_hub

router = APIRouter(prefix="/api/maintenance", tags=["maintenance"])


@router.get("", response_model=List[MaintenanceRecordResponse])
async def list_maintenance(db: AsyncSession = Depends(get_db)):
    """Get all maintenance records."""
    result = await db.execute(
        select(MaintenanceRecord).order_by(MaintenanceRecord.printer_id)
    )
    return result.scalars().all()


@router.get("/alerts", response_model=List[MaintenanceRecordResponse])
async def get_active_alerts(db: AsyncSession = Depends(get_db)):
    """Get only active maintenance alerts."""
    result = await db.execute(
        select(MaintenanceRecord).where(MaintenanceRecord.is_alert_active == True)
    )
    return result.scalars().all()


@router.get("/printer/{printer_id}", response_model=List[MaintenanceRecordResponse])
async def get_printer_maintenance(
    printer_id: int, db: AsyncSession = Depends(get_db)
):
    """Get maintenance records for a specific printer."""
    result = await db.execute(
        select(MaintenanceRecord).where(MaintenanceRecord.printer_id == printer_id)
    )
    return result.scalars().all()


@router.post("", response_model=MaintenanceRecordResponse, status_code=201)
async def create_maintenance_record(
    data: MaintenanceRecordCreate, db: AsyncSession = Depends(get_db)
):
    """Create a new maintenance record for a printer."""
    record = MaintenanceRecord(
        printer_id=data.printer_id,
        maintenance_type=data.maintenance_type,
        threshold_hours=data.threshold_hours,
        custom_label=data.custom_label,
        custom_icon=data.custom_icon,
        custom_description=data.custom_description,
        last_reset_at=datetime.now(timezone.utc),
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)
    return record


@router.put("/{record_id}", response_model=MaintenanceRecordResponse)
async def update_maintenance(
    record_id: int,
    data: MaintenanceRecordUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update a maintenance record's threshold."""
    result = await db.execute(
        select(MaintenanceRecord).where(MaintenanceRecord.id == record_id)
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")

    if data.threshold_hours is not None:
        record.threshold_hours = data.threshold_hours
        record.is_alert_active = record.accumulated_hours >= record.threshold_hours
    if data.custom_label is not None:
        record.custom_label = data.custom_label or None
    if data.custom_icon is not None:
        record.custom_icon = data.custom_icon or None
    if data.custom_description is not None:
        record.custom_description = data.custom_description or None

    await db.commit()
    await db.refresh(record)
    await ws_hub.broadcast_maintenance_update()

    return record


@router.post("/{record_id}/reset")
async def reset_maintenance(
    record_id: int,
    data: MaintenanceResetRequest = MaintenanceResetRequest(),
    db: AsyncSession = Depends(get_db),
):
    """Reset a maintenance counter and log the event with an optional note."""
    result = await db.execute(
        select(MaintenanceRecord).where(MaintenanceRecord.id == record_id)
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")

    # Log the reset before zeroing the counter
    log_entry = MaintenanceLog(
        record_id=record.id,
        printer_id=record.printer_id,
        maintenance_type=record.maintenance_type,
        hours_at_reset=record.accumulated_hours,
        note=data.note,
    )
    db.add(log_entry)

    # Reset the record
    record.accumulated_hours = 0.0
    record.is_alert_active = False
    record.last_reset_at = datetime.now(timezone.utc)
    record.last_reset_note = data.note

    await db.commit()
    await db.refresh(record)
    await ws_hub.broadcast_maintenance_update()

    return {
        "status": "ok",
        "message": f"Contador de {record.maintenance_type} reiniciado para la impresora {record.printer_id}",
    }


@router.delete("/{record_id}", status_code=204)
async def delete_maintenance_record(
    record_id: int, db: AsyncSession = Depends(get_db)
):
    """Delete a maintenance record and its history logs."""
    result = await db.execute(
        select(MaintenanceRecord).where(MaintenanceRecord.id == record_id)
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")

    await db.delete(record)
    await db.commit()
    await ws_hub.broadcast_maintenance_update()


@router.get("/{record_id}/history", response_model=List[MaintenanceLogResponse])
async def get_maintenance_history(
    record_id: int, db: AsyncSession = Depends(get_db)
):
    """Get the full reset history for a specific maintenance record."""
    result = await db.execute(
        select(MaintenanceLog)
        .where(MaintenanceLog.record_id == record_id)
        .order_by(MaintenanceLog.reset_at.desc())
    )
    return result.scalars().all()


@router.get("/printer/{printer_id}/history", response_model=List[MaintenanceLogResponse])
async def get_printer_maintenance_history(
    printer_id: int, db: AsyncSession = Depends(get_db)
):
    """Get the full reset history for all maintenance items of a printer."""
    result = await db.execute(
        select(MaintenanceLog)
        .where(MaintenanceLog.printer_id == printer_id)
        .order_by(MaintenanceLog.reset_at.desc())
    )
    return result.scalars().all()
