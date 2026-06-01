"""
Printer ORM model — stores static config and runtime state for each printer.
"""

from datetime import datetime, timezone
from sqlalchemy import String, Float, Integer, DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Printer(Base):
    __tablename__ = "printers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    model: Mapped[str] = mapped_column(String(100), nullable=False)
    moonraker_url: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    nozzle_size: Mapped[float] = mapped_column(Float, default=0.4)
    current_spool_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Printer type info
    extruder_type: Mapped[str] = mapped_column(
        String(20), default="direct_drive",
        comment="direct_drive | bowden"
    )
    filament_tracking_mode: Mapped[str] = mapped_column(
        String(20), default="manager",
        comment="manager | moonraker"
    )
    fluidd_url: Mapped[str | None] = mapped_column(
        String(255), nullable=True,
        comment="Optional direct link to Fluidd/Mainsail/Sonic Pad interface for this printer"
    )

    # Runtime state (updated by Moonraker WebSocket)
    status: Mapped[str] = mapped_column(
        String(50), default="offline",
        comment="printing | standby | requires_clearance | available | paused | error | offline"
    )
    current_job_progress: Mapped[float] = mapped_column(Float, default=0.0)
    hotend_temp: Mapped[float] = mapped_column(Float, default=0.0)
    hotend_target: Mapped[float] = mapped_column(Float, default=0.0)
    bed_temp: Mapped[float] = mapped_column(Float, default=0.0)
    bed_target: Mapped[float] = mapped_column(Float, default=0.0)
    current_filename: Mapped[str | None] = mapped_column(Text, nullable=True)
    thumbnail_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    camera_url: Mapped[str | None] = mapped_column(String(255), nullable=True)
    total_print_time_secs: Mapped[int] = mapped_column(Integer, default=0)
    lifetime_print_seconds: Mapped[int] = mapped_column(Integer, default=0)
    eta_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)

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
        """Serialize to dictionary for WebSocket broadcast."""
        return {
            "id": self.id,
            "name": self.name,
            "model": self.model,
            "moonraker_url": self.moonraker_url,
            "nozzle_size": self.nozzle_size,
            "current_spool_id": self.current_spool_id,
            "extruder_type": self.extruder_type,
            "filament_tracking_mode": self.filament_tracking_mode,
            "fluidd_url": self.fluidd_url,
            "status": self.status,
            "current_job_progress": self.current_job_progress,
            "hotend_temp": self.hotend_temp,
            "hotend_target": self.hotend_target,
            "bed_temp": self.bed_temp,
            "bed_target": self.bed_target,
            "current_filename": self.current_filename,
            "thumbnail_url": self.thumbnail_url,
            "camera_url": self.camera_url,
            "total_print_time_secs": self.total_print_time_secs,
            "lifetime_print_seconds": self.lifetime_print_seconds,
            "eta_seconds": self.eta_seconds,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
