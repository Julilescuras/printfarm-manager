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
    """List print queue, optionally filtered by status.

    `status` accepts a single value ("pending") or a comma-separated list
    ("pending,paused") so the UI can show held jobs alongside the queue.
    """
    query = select(PrintJob)
    if status:
        statuses = [s.strip() for s in status.split(",") if s.strip()]
        if len(statuses) == 1:
            query = query.where(PrintJob.status == statuses[0])
        elif statuses:
            query = query.where(PrintJob.status.in_(statuses))
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


@router.post("", response_model=List[PrintJobResponse], status_code=201)
async def add_job(
    name: str = Form(...),
    compatible_models: str = Form(...),  # JSON string: '["Ender 3 V2 Neo"]'
    required_nozzle: float = Form(0.4),
    required_material: str = Form("PLA"),
    required_color: Optional[str] = Form(None),
    required_filament_id: Optional[int] = Form(None),
    copies: int = Form(1),
    priority: int = Form(0),
    paused: bool = Form(False),
    gcode: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Add a new print job to the queue with G-code file upload.

    When `paused` is true the job is created held ('paused'): it is never
    auto-dispatched until a human resumes it, even if a compatible printer is
    free. On resume it re-enters the normal dispatcher (compatibility checks).
    """
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

    # "Copies" creates N independent jobs (each copies=1) pointing to the SAME
    # G-code file on disk. This way every copy is its own queue item that can be
    # reordered, cancelled or duplicated on its own — and we never duplicate the
    # uploaded file.
    n = max(1, copies)
    created_jobs: List[PrintJob] = []
    for i in range(n):
        job = PrintJob(
            name=name if n == 1 else f"{name} ({i + 1}/{n})",
            gcode_filename=gcode_path,
            gcode_original_name=gcode.filename,
            compatible_models=compatible_models,
            required_nozzle=required_nozzle,
            required_material=required_material,
            required_color=required_color,
            required_filament_id=required_filament_id,
            copies=1,
            priority=priority,
            status="paused" if paused else "pending",
            estimated_time_secs=parsed.get("estimated_time_secs"),
            estimated_weight_g=parsed.get("estimated_weight_g"),
        )
        db.add(job)
        created_jobs.append(job)

    await db.commit()
    for job in created_jobs:
        await db.refresh(job)

    # Notify frontends
    await ws_hub.broadcast_queue_update()

    # Try to dispatch to any idle printer
    await dispatcher.try_dispatch_all()

    return created_jobs


@router.post("/gcodes/purge")
async def purge_gcodes(db: AsyncSession = Depends(get_db)):
    """DANGER: Delete stored G-code files from the server to free disk space.

    Files referenced by an ACTIVE job (pending or printing) are kept, so the
    queue is never broken. Everything else (history, completed, cancelled) is
    removed. Triggered from the 'Zona peligrosa' in Configuración.
    """
    # Paths we must keep: G-codes still needed by the live queue.
    result = await db.execute(
        select(PrintJob.gcode_filename).where(
            PrintJob.status.in_(["pending", "printing"])
        )
    )
    keep = {os.path.abspath(p) for (p,) in result.all() if p}

    deleted = 0
    freed_bytes = 0

    def _purge() -> tuple[int, int]:
        d = 0
        f = 0
        for root, _dirs, files in os.walk(settings.gcodes_path):
            for fn in files:
                full = os.path.abspath(os.path.join(root, fn))
                if full in keep:
                    continue
                try:
                    f += os.path.getsize(full)
                    os.remove(full)
                    d += 1
                except OSError:
                    pass
        return d, f

    if os.path.isdir(settings.gcodes_path):
        deleted, freed_bytes = await asyncio.to_thread(_purge)

    return {
        "status": "ok",
        "deleted": deleted,
        "kept": len(keep),
        "freed_mb": round(freed_bytes / (1024 * 1024), 1),
        "message": f"Se eliminaron {deleted} archivos G-code ({round(freed_bytes / (1024 * 1024), 1)} MB liberados)",
    }


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
        if job and job.status in ("pending", "paused"):
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
    if job.status not in ("pending", "paused"):
        raise HTTPException(status_code=400, detail="Can only edit pending or paused jobs")

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
    """Remove a job from the queue.

    A pending job never printed and never produced a history entry, so deleting
    it must NOT pollute the 'Cancelados' tab (which is reserved for prints that
    were actually cancelled or failed). We hard-delete the queue item instead.
    The print history is independent and is preserved.

    Cancelling a print that is already RUNNING is a different action, done from
    the printer detail screen (POST /api/printers/{id}/cancel-print).
    """
    result = await db.execute(select(PrintJob).where(PrintJob.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.status == "printing":
        raise HTTPException(
            status_code=400,
            detail="Para cancelar una impresión en curso, usá la pantalla de la impresora.",
        )

    # Hard-delete the queue item. The shared G-code file on disk is intentionally
    # left untouched (other copies may reference it; use 'vaciar G-codes' in
    # Configuración to clean storage).
    await db.delete(job)
    await db.commit()
    await ws_hub.broadcast_queue_update()


@router.post("/{job_id}/clone", response_model=List[PrintJobResponse], status_code=201)
async def clone_job(job_id: int, copies: int = 1, db: AsyncSession = Depends(get_db)):
    """Duplicate any job (in any state) back into the queue as new pending jobs.
    Re-uses the existing G-code file — does not re-upload."""
    result = await db.execute(select(PrintJob).where(PrintJob.id == job_id))
    src = result.scalar_one_or_none()
    if not src:
        raise HTTPException(status_code=404, detail="Job not found")

    if not os.path.exists(src.gcode_filename):
        raise HTTPException(
            status_code=404,
            detail=f"El G-code ya no existe en disco: {src.gcode_original_name}",
        )

    n = max(1, copies)
    created: List[PrintJob] = []
    for _ in range(n):
        new_job = PrintJob(
            name=src.name,
            gcode_filename=src.gcode_filename,
            gcode_original_name=src.gcode_original_name,
            compatible_models=src.compatible_models,
            required_nozzle=src.required_nozzle,
            required_material=src.required_material,
            required_color=src.required_color,
            required_filament_id=src.required_filament_id,
            copies=1,
            priority=src.priority,
            estimated_time_secs=src.estimated_time_secs,
            estimated_weight_g=src.estimated_weight_g,
        )
        db.add(new_job)
        created.append(new_job)

    await db.commit()
    for job in created:
        await db.refresh(job)

    await ws_hub.broadcast_queue_update()
    await dispatcher.try_dispatch_all()
    return created


@router.post("/{job_id}/pause", response_model=PrintJobResponse)
async def pause_job(job_id: int, db: AsyncSession = Depends(get_db)):
    """Hold a pending job so the dispatcher skips it, even if a compatible
    printer is free. Only pending jobs can be paused — a job already printing
    is stopped from the printer screen, not here."""
    result = await db.execute(select(PrintJob).where(PrintJob.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status != "pending":
        raise HTTPException(
            status_code=400,
            detail="Solo se pueden pausar trabajos pendientes.",
        )

    job.status = "paused"
    await db.commit()
    await db.refresh(job)
    await ws_hub.broadcast_queue_update()
    return job


@router.post("/{job_id}/resume", response_model=PrintJobResponse)
async def resume_job(job_id: int, db: AsyncSession = Depends(get_db)):
    """Release a paused job back into the queue. It re-enters the normal
    dispatcher flow (model/nozzle/filament/weight checks) and is dispatched
    to the first compatible idle printer."""
    result = await db.execute(select(PrintJob).where(PrintJob.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status != "paused":
        raise HTTPException(
            status_code=400,
            detail="El trabajo no está en pausa.",
        )

    job.status = "pending"
    await db.commit()
    await db.refresh(job)
    await ws_hub.broadcast_queue_update()

    # Re-enter the normal dispatcher: it will match it to a compatible printer.
    await dispatcher.try_dispatch_all()
    return job


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
            required_filament_id=original_job.required_filament_id,
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
