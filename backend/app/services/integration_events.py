"""
Integration events — append-only queue Control Ventas pulls from
``GET /api/integration/events?after=<id>``.

``emit(db, type, payload)`` only *adds* the row to the caller's session, so the
event is committed atomically with the state change that produced it (no event
without the change, no change without the event). Callers commit as usual.

Event types (payloads documented in CLAUDE.md → "Integración con Control Ventas"):
  job.created · job.started · job.completed · job.failed · job.cancelled ·
  job.requeued · bed.cleared · library.status_changed
Retention: 30 days (``prune_old_events``, run at startup and at most hourly
from the events endpoint).
"""

import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.integration_event import IntegrationEvent

logger = logging.getLogger("printfarm.integration")

RETENTION_DAYS = 30
_PRUNE_EVERY_SECS = 3600
_last_prune: float = 0.0

EVENT_TYPES = (
    "job.created",
    "job.started",
    "job.completed",
    "job.failed",
    "job.cancelled",
    "job.requeued",
    "bed.cleared",
    "library.status_changed",
)


def emit(db: AsyncSession, type: str, payload: dict[str, Any]) -> IntegrationEvent:
    """Queue an integration event in ``db`` (committed by the caller)."""
    if type not in EVENT_TYPES:
        logger.warning("Unknown integration event type: %s", type)
    event = IntegrationEvent(
        type=type,
        payload=payload,
        at=datetime.now(timezone.utc),
    )
    db.add(event)
    return event


def job_payload(job, **extra: Any) -> dict[str, Any]:
    """Common payload for job.* events (works for any PrintJob)."""
    data = {
        "job_id": job.id,
        "name": job.name,
        "status": job.status,
        "library_id": job.library_id,
        "order_id": job.order_id,
        "line_id": job.line_id,
        "order_ref": job.order_ref,
        "is_test": bool(job.is_test),
        "source": job.source or "manual",
        "copies": job.copies,
        "copies_completed": job.copies_completed,
        "printer_id": job.assigned_printer_id,
    }
    data.update(extra)
    return data


async def prune_old_events(db: AsyncSession, force: bool = False) -> int:
    """Delete events older than RETENTION_DAYS. Throttled to once per hour
    unless ``force``. Returns rows deleted (0 when throttled)."""
    global _last_prune
    now = time.monotonic()
    if not force and _last_prune and now - _last_prune < _PRUNE_EVERY_SECS:
        return 0
    _last_prune = now
    cutoff = datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)
    result = await db.execute(
        delete(IntegrationEvent).where(IntegrationEvent.at < cutoff)
    )
    await db.commit()
    deleted = result.rowcount or 0
    if deleted:
        logger.info("Pruned %s integration events older than %s days", deleted, RETENTION_DAYS)
    return deleted

