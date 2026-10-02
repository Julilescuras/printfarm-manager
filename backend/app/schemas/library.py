"""Pydantic schemas for the G-code library and the Control Ventas integration API."""

from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field

LibraryStatus = Literal["draft", "testing", "approved", "rejected", "review"]


class LibraryEntryResponse(BaseModel):
    id: int
    product_key: str
    product_id: Optional[str] = None
    product_name: str
    size: str
    kind: Optional[str] = None
    printer_model: str
    nozzle: float
    material: str
    filament_id: Optional[int] = None
    units_per_plate: int
    gcode_path: str
    original_name: str
    # Public URL of the file under the /gcodes static mount (download/preview).
    gcode_url: Optional[str] = None
    file_exists: bool = True
    estimated_time_secs: Optional[int] = None
    estimated_weight_g: Optional[float] = None
    stl_fingerprint: Optional[str] = None
    status: LibraryStatus
    notes: Optional[str] = None
    test_job_id: Optional[int] = None
    approved_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class LibraryEntryUpdate(BaseModel):
    """PUT /api/library/{id}: every field optional; only sent ones change."""
    product_key: Optional[str] = Field(None, min_length=1)
    product_id: Optional[str] = None
    product_name: Optional[str] = Field(None, min_length=1)
    size: Optional[str] = Field(None, min_length=1, max_length=50)
    kind: Optional[str] = None
    printer_model: Optional[str] = Field(None, min_length=1)
    nozzle: Optional[float] = Field(None, gt=0, le=3)
    material: Optional[str] = Field(None, min_length=1, max_length=50)
    filament_id: Optional[int] = None
    units_per_plate: Optional[int] = Field(None, ge=1, le=1000)
    stl_fingerprint: Optional[str] = None
    status: Optional[LibraryStatus] = None
    notes: Optional[str] = Field(None, max_length=2000)


class LibraryEnqueueRequest(BaseModel):
    """POST /api/library/{id}/enqueue. ``copies`` = plates (each its own job)."""
    copies: int = Field(1, ge=1, le=200)
    priority: int = 0
    order_id: Optional[str] = None
    line_id: Optional[str] = None
    order_ref: Optional[str] = Field(None, max_length=200)
    # Create the jobs held ('paused'): never auto-dispatched until resumed.
    paused: bool = False


class IntegrationJobCreate(LibraryEnqueueRequest):
    """POST /api/integration/jobs."""
    library_id: int


class LibraryDeleteResponse(BaseModel):
    status: str = "ok"
    file_deleted: bool
    message: str


class MarkReviewRequest(BaseModel):
    product_key: str = Field(..., min_length=1)
    stl_fingerprint: Optional[str] = None
    # STL fingerprints are per size: pass it so only that size's entries move.
    size: Optional[str] = None


class MarkReviewResponse(BaseModel):
    updated: List[int]


class ClearBedRequest(BaseModel):
    """Optional body of POST /api/printers/{id}/clear-bed."""
    outcome: Optional[Literal["ok", "bad"]] = None
    note: Optional[str] = Field(None, max_length=2000)


# ── parse-order (LLM) ───────────────────────────────────────────────────────

class ParseOrderProduct(BaseModel):
    key: str
    name: str
    kind: Optional[str] = None
    sizes: List[str] = Field(default_factory=list)


class ParseOrderRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=8000)
    products: List[ParseOrderProduct] = Field(default_factory=list, max_length=3000)


class ParseOrderLine(BaseModel):
    productKey: Optional[str] = None
    size: Optional[str] = None
    qty: int = 1
    requestedSizeMm: Optional[float] = None
    kind: Optional[str] = None
    brief: str = ""
    confidence: float = 0.0


class ParseOrderResponse(BaseModel):
    lines: List[ParseOrderLine]
    provider: Optional[str] = None
