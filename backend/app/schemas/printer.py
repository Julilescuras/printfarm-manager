"""Pydantic schemas for Printer endpoints."""

from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class PrinterCreate(BaseModel):
    name: str
    model: str
    moonraker_url: str
    nozzle_size: float = 0.4
    extruder_type: str = "direct_drive"  # direct_drive | bowden
    fluidd_url: Optional[str] = None
    camera_url: Optional[str] = None
    current_spool_id: Optional[int] = None


class PrinterUpdate(BaseModel):
    name: Optional[str] = None
    model: Optional[str] = None
    moonraker_url: Optional[str] = None
    nozzle_size: Optional[float] = None
    extruder_type: Optional[str] = None
    fluidd_url: Optional[str] = None
    camera_url: Optional[str] = None
    current_spool_id: Optional[int] = None


class PrinterAssignSpool(BaseModel):
    spool_id: Optional[int] = None


class PrinterSetStatus(BaseModel):
    status: str  # available | paused | requires_clearance


class PrinterResponse(BaseModel):
    id: int
    name: str
    model: str
    moonraker_url: str
    nozzle_size: float
    extruder_type: str
    fluidd_url: Optional[str]
    camera_url: Optional[str]
    current_spool_id: Optional[int]
    status: str
    current_job_progress: float
    hotend_temp: float
    hotend_target: float
    bed_temp: float
    bed_target: float
    current_filename: Optional[str]
    thumbnail_url: Optional[str]
    total_print_time_secs: int
    eta_seconds: Optional[int]
    created_at: Optional[datetime]
    updated_at: Optional[datetime]

    model_config = {"from_attributes": True}
