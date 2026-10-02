"""
GcodeLibrary ORM model — approved G-code library (PT-1b).

One row = one sliced G-code for a (product, size, printer model, nozzle)
combination. Entries start as ``draft``; enqueuing a draft creates a single
test job (``is_test``) and moves it to ``testing``; the human result recorded
when the bed is cleared (``clear-bed`` with ``outcome``) moves it to
``approved`` or ``rejected``. When Control Ventas detects that the product's
STL changed it flags approved entries as ``review``.

The G-code file lives in ``<gcodes_path>/library/<product_key_slug>/`` and is
never touched by the purge.
"""

from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

LIBRARY_STATUSES = ("draft", "testing", "approved", "rejected", "review")


class GcodeLibrary(Base):
    __tablename__ = "gcode_library"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # relativePath of the product in Control Ventas (stable business key)
    product_key: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    product_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    product_name: Mapped[str] = mapped_column(Text, nullable=False)
    size: Mapped[str] = mapped_column(String(50), nullable=False)
    kind: Mapped[str | None] = mapped_column(String(50), nullable=True)
    printer_model: Mapped[str] = mapped_column(String(100), nullable=False)
    nozzle: Mapped[float] = mapped_column(Float, nullable=False)
    material: Mapped[str] = mapped_column(String(50), nullable=False, default="PLA")
    filament_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    units_per_plate: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    gcode_path: Mapped[str] = mapped_column(Text, nullable=False)
    original_name: Mapped[str] = mapped_column(Text, nullable=False)
    estimated_time_secs: Mapped[int | None] = mapped_column(Integer, nullable=True)
    estimated_weight_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    stl_fingerprint: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    test_job_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
