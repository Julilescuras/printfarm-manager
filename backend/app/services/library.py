"""
G-code library service (PT-1b) — shared by the LAN UI router (/api/library)
and the Control Ventas integration router (/api/integration/*).

Lifecycle of an entry:
  draft ──enqueue──▶ testing (one is_test job, copies=1)
  testing ──clear-bed outcome=ok──▶ approved     (approved_at set)
  testing ──clear-bed outcome=bad─▶ rejected     (notes = note)
  approved ──mark-review (STL changed)──▶ review
  any ──PUT status──▶ any (manual override from the UI)
Every status change emits ``library.status_changed``.
"""

import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException, UploadFile
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.gcode_library import GcodeLibrary
from app.models.print_job import PrintHistory, PrintJob
from app.models.printer import Printer
from app.security import gcodes_root, is_within
from app.services.gcode_parser import parse_gcode
from app.services.gcode_storage import (
    library_dest_path,
    save_gcode_upload,
    validated_gcode_name,
)
from app.services.integration_events import emit, job_payload

logger = logging.getLogger("printfarm.library")

TERMINAL_JOB_STATUSES = ("completed", "cancelled", "failed")


# ─── Serialization ──────────────────────────────────────────────────────────

def _gcode_url(path: str) -> Optional[str]:
    root = gcodes_root()
    real = os.path.realpath(path or "")
    if not path or not is_within(root, real):
        return None
    rel = os.path.relpath(real, root).replace(os.sep, "/")
    return f"/gcodes/{rel}"


def entry_to_dict(e: GcodeLibrary) -> dict:
    return {
        "id": e.id,
        "product_key": e.product_key,
        "product_id": e.product_id,
        "product_name": e.product_name,
        "size": e.size,
        "kind": e.kind,
        "printer_model": e.printer_model,
        "nozzle": e.nozzle,
        "material": e.material,
        "filament_id": e.filament_id,
        "units_per_plate": e.units_per_plate,
        "gcode_path": e.gcode_path,
        "original_name": e.original_name,
        "gcode_url": _gcode_url(e.gcode_path),
        "file_exists": bool(e.gcode_path and os.path.exists(e.gcode_path)),
        "estimated_time_secs": e.estimated_time_secs,
        "estimated_weight_g": e.estimated_weight_g,
        "stl_fingerprint": e.stl_fingerprint,
        "status": e.status,
        "notes": e.notes,
        "test_job_id": e.test_job_id,
        "approved_at": e.approved_at,
        "created_at": e.created_at,
        "updated_at": e.updated_at,
    }


def _status_payload(e: GcodeLibrary, old_status: Optional[str], reason: str) -> dict:
    return {
        "library_id": e.id,
        "product_key": e.product_key,
        "product_id": e.product_id,
        "product_name": e.product_name,
        "size": e.size,
        "printer_model": e.printer_model,
        "nozzle": e.nozzle,
        "old_status": old_status,
        "status": e.status,
        "notes": e.notes,
        "reason": reason,
    }


# ─── Queries ────────────────────────────────────────────────────────────────

async def get_entry_or_404(db: AsyncSession, entry_id: int) -> GcodeLibrary:
    entry = (
        await db.execute(select(GcodeLibrary).where(GcodeLibrary.id == entry_id))
    ).scalar_one_or_none()
    if not entry:
        raise HTTPException(status_code=404, detail="Entrada de biblioteca no encontrada")
    return entry


async def list_entries(
    db: AsyncSession,
    product_key: Optional[str] = None,
    status: Optional[str] = None,
    printer_model: Optional[str] = None,
    size: Optional[str] = None,
) -> list[GcodeLibrary]:
    q = select(GcodeLibrary)
    if product_key:
        q = q.where(GcodeLibrary.product_key == product_key)
    if status:
        statuses = [s.strip() for s in status.split(",") if s.strip()]
        if statuses:
            q = q.where(GcodeLibrary.status.in_(statuses))
    if printer_model:
        q = q.where(func.lower(GcodeLibrary.printer_model) == printer_model.strip().lower())
    if size:
        q = q.where(GcodeLibrary.size == size)
    q = q.order_by(GcodeLibrary.product_key, GcodeLibrary.size, GcodeLibrary.id)
    return list((await db.execute(q)).scalars().all())


async def order_progress(db: AsyncSession, order_id: str) -> tuple[int, int]:
    """(plates completed, plates total) for a CV order, ignoring cancelled jobs."""
    row = (
        await db.execute(
            select(
                func.coalesce(func.sum(PrintJob.copies_completed), 0),
                func.coalesce(func.sum(PrintJob.copies), 0),
            ).where(
                PrintJob.order_id == order_id,
                PrintJob.status != "cancelled",
            )
        )
    ).one()
    return int(row[0] or 0), int(row[1] or 0)


async def _active_jobs_using(db: AsyncSession, path: str) -> int:
    return int(
        (
            await db.execute(
                select(func.count(PrintJob.id)).where(
                    PrintJob.gcode_filename == path,
                    PrintJob.status.not_in(TERMINAL_JOB_STATUSES),
                )
            )
        ).scalar_one()
        or 0
    )


# ─── Mutations ──────────────────────────────────────────────────────────────

def set_status(
    db: AsyncSession,
    entry: GcodeLibrary,
    new_status: str,
    *,
    reason: str,
    notes: Optional[str] = None,
) -> bool:
    """Change status (+ optional notes) and emit library.status_changed.
    Returns False (and emits nothing) when the status doesn't change and no
    notes are given."""
    old = entry.status
    if notes is not None:
        entry.notes = notes
    if new_status == old and notes is None:
        return False
    entry.status = new_status
    if new_status == "approved" and old != "approved":
        entry.approved_at = datetime.now(timezone.utc)
    emit(db, "library.status_changed", _status_payload(entry, old, reason))
    return True


async def create_entry(
    db: AsyncSession,
    upload: UploadFile,
    *,
    product_key: str,
    product_name: str,
    size: str,
    printer_model: str,
    nozzle: float,
    material: str = "PLA",
    product_id: Optional[str] = None,
    kind: Optional[str] = None,
    filament_id: Optional[int] = None,
    units_per_plate: int = 1,
    stl_fingerprint: Optional[str] = None,
    notes: Optional[str] = None,
    reason: str = "created",
) -> GcodeLibrary:
    product_key = (product_key or "").strip()
    product_name = (product_name or "").strip()
    size = (size or "").strip()
    printer_model = (printer_model or "").strip()
    if not product_key or not product_name or not size or not printer_model:
        raise HTTPException(
            status_code=400,
            detail="product_key, product_name, size y printer_model son obligatorios",
        )
    if nozzle is None or nozzle <= 0:
        raise HTTPException(status_code=400, detail="nozzle inválido")

    original_name = validated_gcode_name(upload)
    dest = library_dest_path(product_key, original_name)
    await save_gcode_upload(upload, dest)

    material = (material or "PLA").strip().upper() or "PLA"
    parsed = await asyncio.to_thread(parse_gcode, dest, material)

    entry = GcodeLibrary(
        product_key=product_key,
        product_id=(product_id or None),
        product_name=product_name,
        size=size,
        kind=(kind or None),
        printer_model=printer_model,
        nozzle=float(nozzle),
        material=material,
        filament_id=filament_id,
        units_per_plate=max(1, int(units_per_plate or 1)),
        gcode_path=dest,
        original_name=original_name,
        estimated_time_secs=parsed.get("estimated_time_secs"),
        estimated_weight_g=parsed.get("estimated_weight_g"),
        stl_fingerprint=(stl_fingerprint or None),
        status="draft",
        notes=(notes or None),
    )
    db.add(entry)
    try:
        await db.flush()
        emit(db, "library.status_changed", _status_payload(entry, None, reason))
        await db.commit()
    except Exception:
        await db.rollback()
        try:
            os.remove(dest)
        except OSError:
            pass
        raise
    await db.refresh(entry)
    return entry


async def update_entry(db: AsyncSession, entry: GcodeLibrary, data: dict) -> GcodeLibrary:
    new_status = data.pop("status", None)
    notes = data.pop("notes", None) if "notes" in data else None
    for key, value in data.items():
        if key == "material" and value:
            value = value.strip().upper()
        setattr(entry, key, value)
    if new_status is not None:
        set_status(db, entry, new_status, reason="manual", notes=notes)
    elif notes is not None:
        entry.notes = notes
    await db.commit()
    await db.refresh(entry)
    return entry


async def delete_entry(db: AsyncSession, entry: GcodeLibrary) -> dict:
    """Delete the record; delete the file only when no live job (or other
    library entry) still uses it."""
    path = entry.gcode_path
    in_use = await _active_jobs_using(db, path) if path else 0
    shared = int(
        (
            await db.execute(
                select(func.count(GcodeLibrary.id)).where(
                    GcodeLibrary.gcode_path == path, GcodeLibrary.id != entry.id
                )
            )
        ).scalar_one()
        or 0
    )
    await db.delete(entry)
    await db.commit()

    file_deleted = False
    if path and not in_use and not shared:
        real = os.path.realpath(path)
        if is_within(gcodes_root(), real) and os.path.isfile(real):
            try:
                os.remove(real)
                file_deleted = True
            except OSError as e:
                logger.warning("Could not delete library file %s: %s", real, e)
    if file_deleted:
        msg = "Entrada y archivo eliminados"
    elif in_use:
        msg = f"Entrada eliminada; el archivo se conserva porque {in_use} trabajo(s) activos lo usan"
    else:
        msg = "Entrada eliminada"
    return {"status": "ok", "file_deleted": file_deleted, "message": msg}


async def enqueue_entry(
    db: AsyncSession,
    entry: GcodeLibrary,
    *,
    copies: int = 1,
    priority: int = 0,
    order_id: Optional[str] = None,
    line_id: Optional[str] = None,
    order_ref: Optional[str] = None,
    paused: bool = False,
    source: str = "manual",
) -> list[PrintJob]:
    """Create print job(s) from a library entry (see module docstring)."""
    if entry.status in ("rejected", "review"):
        raise HTTPException(
            status_code=409,
            detail=(
                f"La entrada está '{entry.status}': no se puede encolar. "
                "Subí un G-code nuevo o cambiá el estado."
            ),
        )
    if not entry.gcode_path or not os.path.exists(entry.gcode_path):
        raise HTTPException(
            status_code=404, detail=f"El G-code ya no existe en disco: {entry.original_name}"
        )

    is_test = entry.status in ("draft", "testing")
    if is_test and entry.test_job_id:
        current = (
            await db.execute(select(PrintJob).where(PrintJob.id == entry.test_job_id))
        ).scalar_one_or_none()
        if current and current.status not in TERMINAL_JOB_STATUSES:
            raise HTTPException(
                status_code=409,
                detail=f"Ya hay una impresión de prueba en curso (trabajo #{current.id}).",
            )

    base_name = f"{entry.product_name} - {entry.size}"
    n = 1 if is_test else max(1, int(copies or 1))
    jobs: list[PrintJob] = []
    for i in range(n):
        if is_test:
            name = f"[Prueba] {base_name}"
        else:
            name = base_name if n == 1 else f"{base_name} ({i + 1}/{n})"
        job = PrintJob(
            name=name,
            gcode_filename=entry.gcode_path,
            gcode_original_name=entry.original_name,
            compatible_models=json.dumps([entry.printer_model]),
            required_nozzle=entry.nozzle,
            required_material=entry.material,
            required_filament_id=entry.filament_id,
            copies=1,
            priority=priority,
            status="paused" if paused else "pending",
            estimated_time_secs=entry.estimated_time_secs,
            estimated_weight_g=entry.estimated_weight_g,
            library_id=entry.id,
            order_id=order_id or None,
            line_id=line_id or None,
            order_ref=order_ref or None,
            is_test=is_test,
            source=source,
        )
        db.add(job)
        jobs.append(job)
    await db.flush()

    for job in jobs:
        emit(db, "job.created", job_payload(
            job, units=entry.units_per_plate, product_key=entry.product_key,
            size=entry.size,
        ))
    if is_test:
        entry.test_job_id = jobs[0].id
        set_status(db, entry, "testing", reason="test_enqueued")

    await db.commit()
    for job in jobs:
        await db.refresh(job)

    from app.services.dispatcher import dispatcher
    from app.ws.hub import ws_hub
    await ws_hub.broadcast_queue_update()
    if not paused:
        await dispatcher.try_dispatch_all()
    return jobs


async def mark_review(
    db: AsyncSession,
    product_key: str,
    stl_fingerprint: Optional[str],
    size: Optional[str] = None,
) -> list[int]:
    """Approved entries of ``product_key`` (optionally only ``size``) whose
    fingerprint differs from ``stl_fingerprint`` → ``review``. Entries without
    a stored fingerprint are left alone (nothing to compare)."""
    q = select(GcodeLibrary).where(
        GcodeLibrary.product_key == product_key,
        GcodeLibrary.status == "approved",
        GcodeLibrary.stl_fingerprint.is_not(None),
    )
    if size:
        q = q.where(GcodeLibrary.size == size)
    updated: list[int] = []
    for entry in (await db.execute(q)).scalars().all():
        if entry.stl_fingerprint != stl_fingerprint:
            set_status(db, entry, "review", reason="stl_changed")
            updated.append(entry.id)
    await db.commit()
    return updated


async def record_bed_cleared(
    db: AsyncSession,
    printer: Printer,
    outcome: Optional[str] = None,
    note: Optional[str] = None,
) -> dict:
    """Store the human verdict on the printer's last print and resolve test
    prints. Adds a ``bed.cleared`` event to ``db`` (caller commits).

    Only the most recent history row of this printer is considered, and only
    if it has no outcome yet (so an old print is never re-judged).
    """
    history = (
        await db.execute(
            select(PrintHistory)
            .where(PrintHistory.printer_id == printer.id)
            .order_by(PrintHistory.id.desc())
            .limit(1)
        )
    ).scalar_one_or_none()

    library_status = None
    applied = False
    if history and outcome and history.outcome is None:
        history.outcome = outcome
        history.outcome_note = note or None
        applied = True
        if history.is_test and history.library_id:
            entry = (
                await db.execute(
                    select(GcodeLibrary).where(GcodeLibrary.id == history.library_id)
                )
            ).scalar_one_or_none()
            if entry and entry.status == "testing":
                if outcome == "bad":
                    set_status(db, entry, "rejected", reason="test_bad",
                               notes=note or entry.notes)
                elif history.result == "success":
                    set_status(db, entry, "approved", reason="test_ok",
                               notes=note if note else None)
                library_status = entry.status

    target = history if (history and (applied or history.outcome is None)) else None
    emit(db, "bed.cleared", {
        "printer_id": printer.id,
        "printer_name": printer.name,
        "history_id": target.id if target else None,
        "job_id": target.print_job_id if target else None,
        "library_id": target.library_id if target else None,
        "order_id": target.order_id if target else None,
        "line_id": target.line_id if target else None,
        "order_ref": target.order_ref if target else None,
        "is_test": bool(target.is_test) if target else False,
        "result": target.result if target else None,
        "outcome": outcome if applied else None,
        "note": (note or None) if applied else None,
        "library_status": library_status,
    })
    return {
        "outcome": outcome if applied else None,
        "history_id": history.id if (history and applied) else None,
        "library_status": library_status,
    }

