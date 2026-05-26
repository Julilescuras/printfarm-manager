"""
MaintenanceRecord ORM model — tracks maintenance counters and thresholds per printer.
MaintenanceLog ORM model — immutable history of every reset event.
"""

from datetime import datetime, timezone
from sqlalchemy import String, Float, Integer, DateTime, Boolean, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class MaintenanceRecord(Base):
    __tablename__ = "maintenance_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    printer_id: Mapped[int] = mapped_column(Integer, ForeignKey("printers.id", ondelete="CASCADE"), nullable=False)

    maintenance_type: Mapped[str] = mapped_column(
        String(50), nullable=False,
        comment=(
            "nozzle_change | belt_tension | lubrication | bed_leveling | bed_cleaning | "
            "ptfe_tube | extruder_gears | hotend_cleaning | z_screw_lube | firmware_check | general"
        )
    )
    threshold_hours: Mapped[float] = mapped_column(Float, nullable=False)
    accumulated_hours: Mapped[float] = mapped_column(Float, default=0.0)
    last_reset_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_reset_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_alert_active: Mapped[bool] = mapped_column(Boolean, default=False)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "printer_id": self.printer_id,
            "maintenance_type": self.maintenance_type,
            "threshold_hours": self.threshold_hours,
            "accumulated_hours": self.accumulated_hours,
            "last_reset_at": self.last_reset_at.isoformat() if self.last_reset_at else None,
            "last_reset_note": self.last_reset_note,
            "is_alert_active": self.is_alert_active,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class MaintenanceLog(Base):
    """Immutable log of every maintenance reset. Never deleted."""
    __tablename__ = "maintenance_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    record_id: Mapped[int] = mapped_column(Integer, ForeignKey("maintenance_records.id", ondelete="CASCADE"), nullable=False)
    printer_id: Mapped[int] = mapped_column(Integer, nullable=False)
    maintenance_type: Mapped[str] = mapped_column(String(50), nullable=False)
    hours_at_reset: Mapped[float] = mapped_column(Float, nullable=False, comment="Accumulated hours at the moment of reset")
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    reset_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "record_id": self.record_id,
            "printer_id": self.printer_id,
            "maintenance_type": self.maintenance_type,
            "hours_at_reset": self.hours_at_reset,
            "note": self.note,
            "reset_at": self.reset_at.isoformat() if self.reset_at else None,
        }
