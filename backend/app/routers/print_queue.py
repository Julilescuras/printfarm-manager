"""
Print Queue Router — Manage the centralized print queue.
Jobs are added with G-code upload and dispatched automatically.
"""

import asyncio
import json
import os
import shutil
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.print_job import PrintJob, PrintHistory
from app.schemas.print_job import PrintJobResponse, PrintJobUpdate, PrintHistoryResponse
from app.config import settings
from app.ws.hub import ws_hub
from app.services.gcode_parser import parse_gcode
from app.services.dispatcher import dispatcher

router = APIRouter(prefix="/api/queue", tags=["queue"])


def _organize_gcode_path(material: str, original_name: str) -> str:
    """
    Create an organized path for the G-code file:
    gcodes/{YYYY-MM}/{material}/{original_name}
    """
    now = datetime.now()
    date_folder = now.strftime("%Y-%m")
    material_folder = material.upper() if material else "OTHER"

    relative_dir = os.path.join(date_folder, material_folder)
    full_dir = os.path.join(settings.gcodes_path, relative_dir)
    os.makedirs(full_dir, exist_ok=True)

    # Avoid filename collisions
    base_name = original_name
    full_path = os.path.join(full_dir, base_name)
    counter = 1
    while os.path.exists(full_path):
        name, ext = os.path.splitext(base_name)
        full_path = os.path.join(full_dir, f"{name}_{counter}{ext}")
        counter += 1

    return full_path


@router.get("", response_model=List[PrintJobResponse])
async def list_queue(
    status: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """List print queue, optionally filtered by status."""
    query = select(PrintJob)
    if status:
        query = query.where(PrintJob.status == status)
    query = query.order_by(PrintJob.priority.desc(), PrintJob.created_at.asc())

    result = await db.execute(query)
    return result.scalars().all()


@router.get("/history", response_model=List[PrintHistoryResponse])
async def get_history(
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
):
    """Get print history with enriched data."""
    result = await db.execute(
        select(PrintHistory)
        .order_by(PrintHistory.completed_at.desc())
        .limit(limit)
    )
    return result.scalars().all()


@router.post("", response_model=PrintJobResponse, status_code=201)
async def add_job(
    name: str = Form(...),
    compatible_models: str = Form(...),  # JSON string: '["Ender 3 V2 Neo"]'
    required_nozzle: float = Form(0.4),
    required_material: str = Form("PLA"),
    required_color: Optional[str] = Form(None),
    copies: int = Form(1),
    priority: int = Form(0),
    gcode: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Add a new print job to the queue with G-code file upload."""
    # Validate compatible_models is valid JSON
    try:
        models_list = json.loads(compatible_models)
        if not isinstance(models_list, list):
            raise ValueError("Must be a JSON array")
    except (json.JSONDecodeError, ValueError):
        raise HTTPException(
            status_code=400,
            detail="compatible_models must be a valid JSON array string"
        )

    # Save the G-code file in an organized structure
    gcode_path = _organize_gcode_path(required_material, gcode.filename)

    try:
        content = await gcode.read()
        def _save():
            with open(gcode_path, "wb") as f:
                f.write(content)
        await asyncio.to_thread(_save)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error saving file: {str(e)}")

    # Parse G-code for estimates (in a separate thread to prevent blocking)
    parsed = await asyncio.to_thread(parse_gcode, gcode_path, required_material)

    # Create the job record
    job = PrintJob(
        name=name,
        gcode_filename=gcode_path,
        gcode_original_name=gcode.filename,
        compatible_models=compatible_models,
        required_nozzle=required_nozzle,
        required_material=required_material,
        required_color=required_color,
        copies=copies,
        priority=priority,
        estimated_time_secs=parsed.get("estimated_time_secs"),
        estimated_weight_g=parsed.get("estimated_weight_g"),
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    # Notify frontends
    await ws_hub.broadcast_queue_update()

    # Try to dispatch to any idle printer
    await dispatcher.try_dispatch_all()

    return job


@router.put("/reorder")
async def reorder_queue(
    items: List[dict],
    db: AsyncSession = Depends(get_db),
):
    """
    Reorder the print queue by updating priorities.
    Expects: [{"id": 1, "priority": 10}, {"id": 2, "priority": 9}, ...]
    """
    for item in items:
        job_id = item.get("id")
        new_priority = item.get("priority")
        if job_id is None or new_priority is None:
            continue

        result = await db.execute(select(PrintJob).where(PrintJob.id == job_id))
        job = result.scalar_one_or_none()
        if job and job.status == "pending":
            job.priority = new_priority

    await db.commit()
    await ws_hub.broadcast_queue_update()
    return {"status": "ok"}


@router.put("/{job_id}", response_model=PrintJobResponse)
async def update_job(
    job_id: int,
    job_update: PrintJobUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update a job's details."""
    result = await db.execute(select(PrintJob).where(PrintJob.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status != "pending":
        raise HTTPException(status_code=400, detail="Can only edit pending jobs")

    update_data = job_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        if key == "compatible_models":
            # Models must be stored as JSON string
            setattr(job, key, json.dumps(value))
        else:
            setattr(job, key, value)

    await db.commit()
    await db.refresh(job)
    await ws_hub.broadcast_queue_update()

    return job


@router.delete("/{job_id}", status_code=204)
async def cancel_job(job_id: int, db: AsyncSession = Depends(get_db)):
    """Cancel a pending job."""
    result = await db.execute(select(PrintJob).where(PrintJob.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.status == "printing":
        raise HTTPException(status_code=400, detail="Cannot cancel a job that is currently printing")

    job.status = "cancelled"
    await db.commit()
    await ws_hub.broadcast_queue_update()


@router.post("/{job_id}/requeue", response_model=PrintJobResponse)
async def requeue_job(job_id: int, db: AsyncSession = Depends(get_db)):
    """Re-enqueue a completed or cancelled job."""
    result = await db.execute(select(PrintJob).where(PrintJob.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    job.status = "pending"
    job.copies_completed = 0
    job.assigned_printer_id = None
    await db.commit()
    await db.refresh(job)
    await ws_hub.broadcast_queue_update()

    # Try to dispatch to idle printers
    await dispatcher.try_dispatch_all()

    return job


@router.post("/history/{history_id}/clone", response_model=PrintJobResponse, status_code=201)
async def clone_from_history(
    history_id: int,
    copies: int = 1,
    db: AsyncSession = Depends(get_db),
):
    """
    Clone a job from print history back into the queue.
    Re-uses the existing G-code file without re-uploading.
    """
    # Get the history entry
    result = await db.execute(
        select(PrintHistory).where(PrintHistory.id == history_id)
    )
    history_entry = result.scalar_one_or_none()
    if not history_entry:
        raise HTTPException(status_code=404, detail="History entry not found")

    # Try to get the original job for full metadata
    original_job = None
    if history_entry.print_job_id:
        result = await db.execute(
            select(PrintJob).where(PrintJob.id == history_entry.print_job_id)
        )
        original_job = result.scalar_one_or_none()

    if original_job:
        # Clone from the original job record (has all metadata)
        gcode_path = original_job.gcode_filename
        if not os.path.exists(gcode_path):
            raise HTTPException(
                status_code=404,
                detail=f"G-code file no longer exists on disk: {original_job.gcode_original_name}"
            )

        new_job = PrintJob(
            name=original_job.name,
            gcode_filename=original_job.gcode_filename,
            gcode_original_name=original_job.gcode_original_name,
            compatible_models=original_job.compatible_models,
            required_nozzle=original_job.required_nozzle,
            required_material=original_job.required_material,
            required_color=original_job.required_color,
            copies=copies,
            priority=0,
            estimated_time_secs=original_job.estimated_time_secs,
            estimated_weight_g=original_job.estimated_weight_g,
        )
    else:
        raise HTTPException(
            status_code=404,
            detail="Original job record not found — cannot clone"
        )

    db.add(new_job)
    await db.commit()
    await db.refresh(new_job)

    # Notify frontends
    await ws_hub.broadcast_queue_update()

    # Try to dispatch to idle printers
    await dispatcher.try_dispatch_all()

    return new_job
