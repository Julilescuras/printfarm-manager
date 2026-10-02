"""
Integration Router — machine-to-machine API for Control Ventas.

Every endpoint here requires ``Authorization: Bearer <integration_token>``
(see app/security.py). The token lives in app_settings and is shown /
regenerated from Configuración → "Integración con Control Ventas".

Contract (summarised in CLAUDE.md → "Integración con Control Ventas"):
  GET  /ping
  GET  /printers
  GET  /library            ?product_key&status&printer_model&size
  GET  /library/{id}
  POST /library            multipart (same fields as /api/library)
  PUT  /library/{id}       JSON LibraryEntryUpdate
  POST /library/mark-review {product_key, stl_fingerprint, size?}
  POST /jobs               {library_id, copies, priority, order_id, line_id, order_ref, paused}
  GET  /jobs               ?order_id (required) &line_id
  GET  /events             ?after=<id>&limit=<n>
  POST /assistant/parse-order {text, products:[{key,name,kind,sizes}]}
"""

import json
import logging
import re
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.integration_event import IntegrationEvent
from app.models.print_job import PrintJob
from app.models.printer import Printer
from app.schemas.library import (
    IntegrationJobCreate,
    LibraryEntryResponse,
    LibraryEntryUpdate,
    MarkReviewRequest,
    MarkReviewResponse,
    ParseOrderLine,
    ParseOrderRequest,
    ParseOrderResponse,
)
from app.schemas.print_job import PrintJobResponse
from app.security import require_integration_token
from app.services import library as lib
from app.services.integration_events import prune_old_events
from app.version import APP_VERSION

logger = logging.getLogger("printfarm.integration")

router = APIRouter(
    prefix="/api/integration",
    tags=["integration"],
    dependencies=[Depends(require_integration_token)],
)


@router.get("/ping")
async def ping():
    """Cheap authenticated health check so CV can validate URL + token."""
    return {
        "status": "ok",
        "service": "PrintFarm Manager",
        "version": APP_VERSION,
        "time": datetime.now(timezone.utc).isoformat(),
    }


# ─── Printers ───────────────────────────────────────────────────────────────

@router.get("/printers")
async def integration_printers(db: AsyncSession = Depends(get_db)):
    """Printers + a per-model summary of installed nozzles (for CV's
    "Subir G-code" form and nozzle suggestion)."""
    printers = (await db.execute(select(Printer).order_by(Printer.id))).scalars().all()
    models: dict[str, dict] = {}
    out = []
    for p in printers:
        online = p.status != "offline"
        out.append({
            "id": p.id,
            "name": p.name,
            "model": p.model,
            "nozzle_size": p.nozzle_size,
            "status": p.status,
            "online": online,
            "bed_cleared": bool(p.bed_cleared),
            "current_spool_id": p.current_spool_id,
        })
        m = models.setdefault(p.model, {"model": p.model, "nozzles": set(), "printers": 0, "online": 0})
        m["nozzles"].add(round(float(p.nozzle_size or 0), 2))
        m["printers"] += 1
        m["online"] += 1 if online else 0
    return {
        "printers": out,
        "models": [{**m, "nozzles": sorted(m["nozzles"])} for m in models.values()],
    }


# ─── Library ────────────────────────────────────────────────────────────────

@router.get("/library", response_model=List[LibraryEntryResponse])
async def integration_list_library(
    product_key: Optional[str] = None,
    status: Optional[str] = None,
    printer_model: Optional[str] = None,
    size: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    entries = await lib.list_entries(db, product_key, status, printer_model, size)
    return [lib.entry_to_dict(e) for e in entries]


@router.post("/library/mark-review", response_model=MarkReviewResponse)
async def integration_mark_review(data: MarkReviewRequest, db: AsyncSession = Depends(get_db)):
    """CV detected the STL changed: approved entries of that product (and size,
    if given) with a different fingerprint → review."""
    updated = await lib.mark_review(db, data.product_key, data.stl_fingerprint, data.size)
    return {"updated": updated}


@router.get("/library/{entry_id}", response_model=LibraryEntryResponse)
async def integration_get_library(entry_id: int, db: AsyncSession = Depends(get_db)):
    return lib.entry_to_dict(await lib.get_entry_or_404(db, entry_id))


@router.post("/library", response_model=LibraryEntryResponse, status_code=201)
async def integration_upload_library(
    gcode: UploadFile = File(...),
    product_key: str = Form(...),
    product_name: str = Form(...),
    size: str = Form(...),
    printer_model: str = Form(...),
    nozzle: float = Form(...),
    material: str = Form("PLA"),
    product_id: Optional[str] = Form(None),
    kind: Optional[str] = Form(None),
    filament_id: Optional[int] = Form(None),
    units_per_plate: int = Form(1),
    stl_fingerprint: Optional[str] = Form(None),
    notes: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
):
    entry = await lib.create_entry(
        db, gcode,
        product_key=product_key, product_name=product_name, size=size,
        printer_model=printer_model, nozzle=nozzle, material=material,
        product_id=product_id, kind=kind, filament_id=filament_id,
        units_per_plate=units_per_plate, stl_fingerprint=stl_fingerprint,
        notes=notes, reason="created_cv",
    )
    return lib.entry_to_dict(entry)


@router.put("/library/{entry_id}", response_model=LibraryEntryResponse)
async def integration_update_library(
    entry_id: int,
    data: LibraryEntryUpdate,
    db: AsyncSession = Depends(get_db),
):
    entry = await lib.get_entry_or_404(db, entry_id)
    entry = await lib.update_entry(db, entry, data.model_dump(exclude_unset=True))
    return lib.entry_to_dict(entry)


# ─── Jobs ───────────────────────────────────────────────────────────────────

@router.post("/jobs", response_model=List[PrintJobResponse], status_code=201)
async def integration_create_jobs(data: IntegrationJobCreate, db: AsyncSession = Depends(get_db)):
    """Create ``copies`` jobs (plates) from an approved library entry, tagged
    with the CV order/line. A draft/testing entry yields one test job."""
    entry = await lib.get_entry_or_404(db, data.library_id)
    payload = data.model_dump()
    payload.pop("library_id")
    return await lib.enqueue_entry(db, entry, source="cv", **payload)


@router.get("/jobs", response_model=List[PrintJobResponse])
async def integration_list_jobs(
    order_id: str = Query(..., min_length=1),
    line_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    q = select(PrintJob).where(PrintJob.order_id == order_id)
    if line_id:
        q = q.where(PrintJob.line_id == line_id)
    q = q.order_by(PrintJob.id)
    return (await db.execute(q)).scalars().all()


# ─── Events ─────────────────────────────────────────────────────────────────

@router.get("/events")
async def integration_events(
    after: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
):
    """Events with id > ``after`` in ascending order. Poll with the returned
    ``last_id`` as the next ``after``; ``has_more`` means call again now."""
    await prune_old_events(db)
    rows = (
        await db.execute(
            select(IntegrationEvent)
            .where(IntegrationEvent.id > after)
            .order_by(IntegrationEvent.id)
            .limit(limit + 1)
        )
    ).scalars().all()
    has_more = len(rows) > limit
    rows = rows[:limit]
    return {
        "events": [r.to_dict() for r in rows],
        "last_id": rows[-1].id if rows else after,
        "has_more": has_more,
    }


# ─── Assistant: parse a free-text order with the configured LLM ─────────────

_PARSE_SYSTEM = """\
Sos un asistente que convierte pedidos escritos por clientes (WhatsApp, español \
rioplatense) en líneas estructuradas para un taller de cortantes y sellos impresos en 3D.

Vas a recibir el TEXTO del pedido y un CATÁLOGO con una línea por producto:
key | nombre | tipo | talles disponibles

Devolvé ÚNICAMENTE un objeto JSON (sin markdown, sin texto extra) con esta forma:
{"lines":[{"productKey":string|null,"size":string|null,"qty":number,\
"requestedSizeMm":number|null,"kind":string|null,"brief":string,"confidence":number}]}

Reglas:
- Una línea por producto+talle pedido. "todos los talles" → una línea por cada talle \
disponible del producto.
- productKey: SOLO una key exacta del catálogo; si no hay un producto claro, null \
(es un diseño nuevo).
- size: uno de los talles disponibles de ese producto (S, M, L, XL, XXL…). \
"chico/mediano/grande" = S/M/L. Si piden una medida ("6 cm", "60 mm") poné \
requestedSizeMm en milímetros y size null salvo que coincida con un talle.
- kind: cortante | cortante_estampa | sello | abecedario | kit | otro, o null.
- qty: entero ≥ 1 (si no dice cantidad, 1).
- brief: el fragmento original del pedido que originó la línea.
- confidence: 0 a 1 según qué tan seguro estás del producto y talle.
"""

_KINDS = {"cortante", "cortante_estampa", "sello", "abecedario", "kit", "otro"}
_MAX_CATALOG_LINES = 400
_WORD = re.compile(r"[a-záéíóúñü0-9]+", re.IGNORECASE)


def _words(text: str) -> set[str]:
    return {w.lower() for w in _WORD.findall(text or "") if len(w) >= 3}


def _compact_catalog(text: str, products) -> list:
    """Keep the prompt bounded: if the catalog is large, keep the products
    sharing the most words with the order text."""
    if len(products) <= _MAX_CATALOG_LINES:
        return list(products)
    order_words = _words(text)
    scored = sorted(products, key=lambda p: -len(order_words & _words(f"{p.name} {p.key}")))
    return scored[:_MAX_CATALOG_LINES]


def _extract_json(content: str) -> dict:
    raw = (content or "").strip()
    raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.IGNORECASE)
    start, end = raw.find("{"), raw.rfind("}")
    if start == -1 or end <= start:
        raise ValueError("no JSON object")
    data = json.loads(raw[start:end + 1])
    if not isinstance(data, dict):
        raise ValueError("not an object")
    return data


def _clean_lines(data: dict, products) -> list[ParseOrderLine]:
    """Validate/normalize the model output against the catalog CV sent."""
    by_key = {p.key: p for p in products}
    lines: list[ParseOrderLine] = []
    raw_lines = data.get("lines")
    if not isinstance(raw_lines, list):
        return lines
    for item in raw_lines[:200]:
        if not isinstance(item, dict):
            continue
        key = item.get("productKey")
        product = by_key.get(key) if isinstance(key, str) else None

        size = item.get("size")
        size = size.strip() if isinstance(size, str) and size.strip() else None
        if size and product and product.sizes:
            size = next((s for s in product.sizes if s.lower() == size.lower()), None)
        elif size and len(size) > 12:
            size = None

        try:
            qty = int(round(float(item.get("qty") or 1)))
        except (TypeError, ValueError):
            qty = 1
        qty = min(max(qty, 1), 10000)

        mm = item.get("requestedSizeMm")
        try:
            mm = float(mm) if mm is not None else None
        except (TypeError, ValueError):
            mm = None
        if mm is not None and not (1 <= mm <= 2000):
            mm = None

        kind = item.get("kind")
        kind = kind if isinstance(kind, str) and kind in _KINDS else None
        if kind is None and product and product.kind in _KINDS:
            kind = product.kind

        brief = item.get("brief")
        brief = brief.strip()[:300] if isinstance(brief, str) else ""

        try:
            confidence = float(item.get("confidence") or 0)
        except (TypeError, ValueError):
            confidence = 0.0
        confidence = min(max(confidence, 0.0), 1.0)
        if key and product is None:
            # The model invented a key → treat as unmatched, lower confidence.
            confidence = min(confidence, 0.3)

        lines.append(ParseOrderLine(
            productKey=product.key if product else None,
            size=size,
            qty=qty,
            requestedSizeMm=mm,
            kind=kind,
            brief=brief,
            confidence=round(confidence, 2),
        ))
    return lines


@router.post("/assistant/parse-order", response_model=ParseOrderResponse)
async def integration_parse_order(data: ParseOrderRequest):
    """Parse a free-text order with the configured assistant LLM.
    503 if no LLM is configured, 502 if the model fails or returns garbage."""
    from app.services.llm.base import ChatMessage, LLMProviderError
    from app.services.llm.factory import get_provider

    try:
        provider = await get_provider()
    except LLMProviderError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"El asistente IA de PrintFarm no está configurado: {exc}",
        )

    catalog = _compact_catalog(data.text, data.products)
    catalog_text = "\n".join(
        f"{p.key} | {p.name} | {p.kind or '-'} | {', '.join(p.sizes) or '-'}"
        for p in catalog
    ) or "(catálogo vacío)"
    messages = [
        ChatMessage(role="system", content=_PARSE_SYSTEM),
        ChatMessage(
            role="user",
            content=f"CATÁLOGO:\n{catalog_text}\n\nTEXTO DEL PEDIDO:\n{data.text}",
        ),
    ]
    try:
        response = await provider.chat(messages, None)
    except LLMProviderError as exc:
        logger.warning("parse-order LLM call failed: %s", exc)
        raise HTTPException(status_code=502, detail=f"Falló la consulta al modelo: {exc}")

    try:
        parsed = _extract_json(response.content or "")
    except (ValueError, json.JSONDecodeError):
        logger.warning("parse-order: non-JSON reply: %r", (response.content or "")[:300])
        raise HTTPException(status_code=502, detail="El modelo no devolvió un JSON válido")

    return {
        "lines": _clean_lines(parsed, data.products),
        "provider": getattr(provider, "name", None),
    }
