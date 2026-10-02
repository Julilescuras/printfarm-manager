"""
G-code Library Router — LAN UI (no token, like the rest of the UI).

The same operations are mirrored with token auth under /api/integration/*
for Control Ventas (routers/integration.py). Business logic lives in
services/library.py.
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.library import (
    LibraryDeleteResponse,
    LibraryEnqueueRequest,
    LibraryEntryResponse,
    LibraryEntryUpdate,
)
from app.schemas.print_job import PrintJobResponse
from app.services import library as lib

router = APIRouter(prefix="/api/library", tags=["library"])


@router.get("", response_model=List[LibraryEntryResponse])
async def list_library(
    product_key: Optional[str] = None,
    status: Optional[str] = None,
    printer_model: Optional[str] = None,
    size: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """List entries. ``status`` accepts a comma-separated list."""
    entries = await lib.list_entries(db, product_key, status, printer_model, size)
    return [lib.entry_to_dict(e) for e in entries]


@router.get("/{entry_id}", response_model=LibraryEntryResponse)
async def get_library_entry(entry_id: int, db: AsyncSession = Depends(get_db)):
    return lib.entry_to_dict(await lib.get_entry_or_404(db, entry_id))


@router.post("", response_model=LibraryEntryResponse, status_code=201)
async def upload_library_entry(
    gcode: UploadFile = File(...),
    product_key: str = Form(...),
    product_name: str = Form(...),
    size: str = Form(...),
    printer_model: str = Form(...),
    nozzle: float = Form(...),
    material: str = Form("PLA"),
    product_id: Optional[str] = Form(None),
    kind: Optional[str] = Form(None),
    filament_id: Optional[int] = Form(None),
    units_per_plate: int = Form(1),
    stl_fingerprint: Optional[str] = Form(None),
    notes: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
):
    """Upload a G-code to the library (multipart). New entries start as draft."""
    entry = await lib.create_entry(
        db, gcode,
        product_key=product_key, product_name=product_name, size=size,
        printer_model=printer_model, nozzle=nozzle, material=material,
        product_id=product_id, kind=kind, filament_id=filament_id,
        units_per_plate=units_per_plate, stl_fingerprint=stl_fingerprint,
        notes=notes,
    )
    return lib.entry_to_dict(entry)


@router.put("/{entry_id}", response_model=LibraryEntryResponse)
async def update_library_entry(
    entry_id: int,
    data: LibraryEntryUpdate,
    db: AsyncSession = Depends(get_db),
):
    entry = await lib.get_entry_or_404(db, entry_id)
    entry = await lib.update_entry(db, entry, data.model_dump(exclude_unset=True))
    return lib.entry_to_dict(entry)


@router.delete("/{entry_id}", response_model=LibraryDeleteResponse)
async def delete_library_entry(entry_id: int, db: AsyncSession = Depends(get_db)):
    entry = await lib.get_entry_or_404(db, entry_id)
    return await lib.delete_entry(db, entry)


@router.post("/{entry_id}/enqueue", response_model=List[PrintJobResponse], status_code=201)
async def enqueue_library_entry(
    entry_id: int,
    data: LibraryEnqueueRequest,
    db: AsyncSession = Depends(get_db),
):
    """draft/testing → single test job (is_test, copies=1) and status testing;
    approved → ``copies`` normal jobs; rejected/review → 409."""
    entry = await lib.get_entry_or_404(db, entry_id)
    return await lib.enqueue_entry(db, entry, source="manual", **data.model_dump())
