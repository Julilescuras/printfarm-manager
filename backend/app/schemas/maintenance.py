"""Pydantic schemas for Maintenance endpoints."""

from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class MaintenanceRecordCreate(BaseModel):
    printer_id: int
    maintenance_type: str
    threshold_hours: float


class MaintenanceRecordUpdate(BaseModel):
    threshold_hours: Optional[float] = None


class MaintenanceResetRequest(BaseModel):
    note: Optional[str] = None


class MaintenanceRecordResponse(BaseModel):
    id: int
    printer_id: int
    maintenance_type: str
    threshold_hours: float
    accumulated_hours: float
    last_reset_at: Optional[datetime]
    last_reset_note: Optional[str]
    is_alert_active: bool
    created_at: Optional[datetime]

    model_config = {"from_attributes": True}


class MaintenanceLogResponse(BaseModel):
    id: int
    record_id: int
    printer_id: int
    maintenance_type: str
    hours_at_reset: float
    note: Optional[str]
    reset_at: datetime

    model_config = {"from_attributes": True}
