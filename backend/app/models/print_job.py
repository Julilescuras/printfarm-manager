"""
PrintJob and PrintHistory ORM models — the centralized print queue and history.
"""

from datetime import datetime, timezone
from sqlalchemy import String, Float, Integer, DateTime, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class PrintJob(Base):
    __tablename__ = "print_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    gcode_filename: Mapped[str] = mapped_column(Text, nullable=False)
    gcode_original_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")

    # Compatibility requirements
    compatible_models: Mapped[str] = mapped_column(
        Text, nullable=False,
        comment='JSON array of compatible printer models, e.g. ["Ender 3 V2 Neo", "Trimaker"]'
    )
    required_nozzle: Mapped[float] = mapped_column(Float, nullable=False, default=0.4)
    required_material: Mapped[str] = mapped_column(String(50), nullable=False, default="PLA")
    required_color: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # Spoolman filament type id. When set, dispatch requires the loaded spool to
    # be of EXACTLY this filament (material + color come for free). This is the
    # robust match; required_material/required_color are kept for display and as
    # a legacy fallback for jobs created before filament-based matching.
    required_filament_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # G-code parsed estimates
    estimated_time_secs: Mapped[int | None] = mapped_column(Integer, nullable=True)
    estimated_weight_g: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Copies management
    copies: Mapped[int] = mapped_column(Integer, default=1)
    copies_completed: Mapped[int] = mapped_column(Integer, default=0)

    # Queue ordering
    priority: Mapped[int] = mapped_column(Integer, default=0, comment="Higher = more priority")

    # Status tracking
    status: Mapped[str] = mapped_column(
        String(50), default="pending",
        comment="pending | paused | printing | completed | cancelled"
    )
    assigned_printer_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("printers.id"), nullable=True
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "gcode_filename": self.gcode_filename,
            "gcode_original_name": self.gcode_original_name,
            "compatible_models": self.compatible_models,
            "required_nozzle": self.required_nozzle,
            "required_material": self.required_material,
            "required_color": self.required_color,
            "required_filament_id": self.required_filament_id,
            "estimated_time_secs": self.estimated_time_secs,
            "estimated_weight_g": self.estimated_weight_g,
            "copies": self.copies,
            "copies_completed": self.copies_completed,
            "priority": self.priority,
            "status": self.status,
            "assigned_printer_id": self.assigned_printer_id,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class PrintHistory(Base):
    __tablename__ = "print_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    print_job_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("print_jobs.id"), nullable=True
    )
    printer_id: Mapped[int] = mapped_column(Integer, ForeignKey("printers.id"), nullable=False)
    printer_name: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    job_name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    gcode_filename: Mapped[str] = mapped_column(Text, nullable=False)
    material: Mapped[str] = mapped_column(String(50), nullable=False, default="")
    # Nozzle + filament snapshot at print time (for display in the history table).
    required_nozzle: Mapped[float | None] = mapped_column(Float, nullable=True)
    required_color: Mapped[str | None] = mapped_column(String(50), nullable=True)
    required_filament_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    estimated_weight_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    duration_secs: Mapped[int | None] = mapped_column(Integer, nullable=True)
    result: Mapped[str] = mapped_column(
        String(50), default="success",
        comment="success | failed | cancelled"
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "print_job_id": self.print_job_id,
            "printer_id": self.printer_id,
            "printer_name": self.printer_name,
            "job_name": self.job_name,
            "gcode_filename": self.gcode_filename,
            "material": self.material,
            "required_nozzle": self.required_nozzle,
            "required_color": self.required_color,
            "required_filament_id": self.required_filament_id,
            "estimated_weight_g": self.estimated_weight_g,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "duration_secs": self.duration_secs,
            "result": self.result,
        }
