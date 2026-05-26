"""Pydantic schemas for PrintJob endpoints."""

from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel


class PrintJobCreate(BaseModel):
    name: str
    compatible_models: List[str]  # Will be serialized to JSON string
    required_nozzle: float = 0.4
    required_material: str = "PLA"
    required_color: Optional[str] = None
    copies: int = 1
    priority: int = 0


class PrintJobUpdate(BaseModel):
    name: Optional[str] = None
    compatible_models: Optional[List[str]] = None
    required_nozzle: Optional[float] = None
    required_material: Optional[str] = None
    required_color: Optional[str] = None
    copies: Optional[int] = None
    priority: Optional[int] = None


class PrintJobResponse(BaseModel):
    id: int
    name: str
    gcode_filename: str
    gcode_original_name: str
    compatible_models: str  # JSON string
    required_nozzle: float
    required_material: str
    required_color: Optional[str]
    estimated_time_secs: Optional[int]
    estimated_weight_g: Optional[float]
    copies: int
    copies_completed: int
    priority: int
    status: str
    assigned_printer_id: Optional[int]
    created_at: Optional[datetime]
    updated_at: Optional[datetime]

    model_config = {"from_attributes": True}


class PrintHistoryResponse(BaseModel):
    id: int
    print_job_id: Optional[int]
    printer_id: int
    printer_name: str
    job_name: str
    gcode_filename: str
    material: str
    estimated_weight_g: Optional[float]
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    duration_secs: Optional[int]
    result: str

    model_config = {"from_attributes": True}
