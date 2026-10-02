"""
IntegrationEvent ORM model — append-only event queue that Control Ventas
pulls with ``GET /api/integration/events?after=<id>`` (PT-1b / PT-2).

Rows are written in the SAME transaction as the state change they describe
(see services/integration_events.emit) and pruned after 30 days.
"""

from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class IntegrationEvent(Base):
    __tablename__ = "integration_events"
    # Never reuse ids after the 30-day prune (Control Ventas pulls by ``after=<id>``).
    __table_args__ = {"sqlite_autoincrement": True}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc), index=True
    )
    type: Mapped[str] = mapped_column(String(50), nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "at": self.at.isoformat() if self.at else None,
            "type": self.type,
            "payload": self.payload or {},
        }
