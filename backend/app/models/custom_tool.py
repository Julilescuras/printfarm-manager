"""
CustomTool ORM model — user-defined G-code macros exposed to the bot.
"""

from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class CustomTool(Base):
    __tablename__ = "custom_tools"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    gcode: Mapped[str] = mapped_column(Text, nullable=False, default="")
    is_action: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    requires_printer: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "gcode": self.gcode,
            "is_action": self.is_action,
            "requires_printer": self.requires_printer,
            "enabled": self.enabled,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
