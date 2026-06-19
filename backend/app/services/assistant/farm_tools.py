"""
3D-farm domain tools (read-only — phase 1).

These register onto the shared `tool_registry`. They reuse the same data sources
the rest of the app uses (printers DB, Spoolman, queue, maintenance) so the
assistant never reports anything the dashboard wouldn't.

Action tools (pause/dispatch/clear-bed) will be added later with is_action=True;
the plumbing already supports them.
"""

import logging
import re
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select

from app.database import async_session
from app.models.maintenance import MaintenanceRecord
from app.models.print_job import PrintHistory, PrintJob
from app.models.printer import Printer
from app.services.assistant.registry import tool_registry
from app.services.spoolman import spoolman_client

logger = logging.getLogger("printfarm.assistant")

DOMAIN = "farm3d"

STATUS_LABELS = {
    "printing": "imprimiendo",
    "standby": "en espera (inactiva)",
    "requires_clearance": "terminó — falta vaciar la cama",
    "available": "libre, lista para imprimir",
    "paused": "pausada",
    "error": "con error",
    "offline": "desconectada",
}

RESULT_LABELS = {
    "success": "exitosa",
    "failed": "fallida",
    "cancelled": "cancelada",
}

MAINT_LABELS = {
    "nozzle_change": "Cambio de boquilla",
    "belt_tension": "Tensión de correas",
    "lubrication": "Lubricación",
    "bed_leveling": "Nivelación de cama",
    "bed_cleaning": "Limpieza de cama",
    "ptfe_tube": "Tubo PTFE",
    "extruder_gears": "Engranajes del extrusor",
    "hotend_cleaning": "Limpieza del hotend",
    "z_screw_lube": "Lubricación husillo Z",
    "firmware_check": "Revisión de firmware",
    "general": "Mantenimiento general",
}


def _fmt_duration(seconds: int | None) -> str | None:
    if not seconds or seconds <= 0:
        return None
    h, rem = divmod(int(seconds), 3600)
    m = rem // 60
    if h and m:
        return f"{h}h {m}min"
    if h:
        return f"{h}h"
    return f"{m}min"


# ── Printer name resolution (shared by farm/action/custom tools) ───────────────
# Words that carry no printer-identifying signal. They're ignored when matching
# by token so a phrase like "las 3 enders" doesn't false-match a printer just
# because its name contains a "3" — that bug made the bot resolve a plural
# request to one wrong (often printing) printer.
_STOPWORDS = {
    "la", "las", "el", "los", "lo", "un", "una", "unos", "unas",
    "de", "del", "y", "o", "a", "para", "en", "con", "que", "esta", "este",
    "cama", "camas", "impresora", "impresoras", "maquina", "maquinas",
    "máquina", "máquinas", "printer", "printers",
}
_ALL_WORDS = {"todas", "todos", "toda", "todo", "all", "cualquiera", "cualquier"}


def _norm(s: str | None) -> str:
    return (s or "").strip().lower().replace("-", " ").replace("_", " ")


def _name_tokens(name: str) -> list[str]:
    return [t for t in _norm(name).split() if t]


def _query_tokens(query: str) -> set[str]:
    """Meaningful tokens of a query: drop stopwords and pure-number tokens."""
    return {
        t for t in _norm(query).split()
        if t and t not in _STOPWORDS and not t.isdigit()
    }


def _token_hit(qtok: str, ntok: str) -> bool:
    """A query token matches a name token by equality, or by substring when both
    are long enough to be meaningful (handles plurals: 'enders' ⊃ 'ender')."""
    if qtok == ntok:
        return True
    return len(qtok) >= 3 and len(ntok) >= 3 and (qtok in ntok or ntok in qtok)


# Separators an enumeration may use: commas/semicolons/slashes and the
# conjunctions "y"/"e"/"and" as standalone words. Lets "la i1, la i2 y la i4"
# resolve to all three even when the user (or a voice note) lists them out.
_SEPARATORS = re.compile(r"\s*(?:,|;|/|\+|&|\band\b|\by\b|\be\b)\s*")


def _split_query(query: str) -> list[str]:
    return [seg for seg in (s.strip() for s in _SEPARATORS.split(_norm(query))) if seg]


def _match_one(printers: list[Printer], segment: str) -> list[Printer]:
    """Tiered match of a single (already-normalized) segment against printers."""
    if not segment:
        return []
    if set(segment.split()) & _ALL_WORDS:
        return list(printers)

    exact = [p for p in printers if _norm(p.name) == segment]
    if exact:
        return exact

    substr = [p for p in printers if segment in _norm(p.name) or _norm(p.name) in segment]
    if substr:
        return substr

    qtokens = _query_tokens(segment)
    if qtokens:
        token = [
            p for p in printers
            if any(_token_hit(q, n) for q in qtokens for n in _name_tokens(p.name))
        ]
        if token:
            return token

    # Last resort: the user gave only a number ("vaciá la 3").
    nums = {t for t in segment.split() if t.isdigit()}
    if nums:
        return [p for p in printers if nums & set(_name_tokens(p.name))]

    return []


async def match_printers(session, query: str) -> list[Printer]:
    """Resolve EVERY printer a loose, user-typed phrase refers to.

    Tiered per segment so it never guesses blindly: 'todas' → all; exact name;
    whole-phrase substring; then meaningful-token overlap (ignoring
    numbers/stopwords, so 'enders' returns every Ender without 'las 3 enders'
    matching only on the '3'). Enumerations ("la i1, la i2 y la i4") are split
    and unioned. Returns [] when nothing matches.
    """
    printers = (
        await session.execute(select(Printer).order_by(Printer.id))
    ).scalars().all()
    segments = _split_query(query)
    if not segments:
        return []
    if len(segments) == 1:
        return _match_one(printers, segments[0])

    seen: set[int] = set()
    out: list[Printer] = []
    for seg in segments:
        for p in _match_one(printers, seg):
            if p.id not in seen:
                seen.add(p.id)
                out.append(p)
    return out


async def resolve_one_printer(session, query: str):
    """For surgical/destructive actions: return (printer, error_dict).

    Requires exactly one match — ambiguity and not-found are reported back so
    the model asks the user instead of acting on the wrong machine.
    """
    matches = await match_printers(session, query)
    if not matches:
        return None, {"error": f"No encontré ninguna impresora que coincida con '{query}'."}
    if len(matches) > 1:
        return None, {
            "ambiguo": True,
            "mensaje": f"Varias impresoras coinciden con '{query}'; decime cuál puntualmente.",
            "candidatos": [p.name for p in matches],
        }
    return matches[0], None


@tool_registry.register(
    name="listar_impresoras",
    description=(
        "Devuelve el estado actual de todas las impresoras de la granja: si están "
        "imprimiendo, libres, pausadas, con error o desconectadas, qué archivo "
        "imprimen, el progreso, el tiempo restante y las temperaturas. Usar para "
        "cualquier pregunta sobre qué impresoras están andando o disponibles."
    ),
    domain=DOMAIN,
)
async def listar_impresoras() -> list[dict[str, Any]]:
    async with async_session() as session:
        result = await session.execute(select(Printer).order_by(Printer.id))
        printers = result.scalars().all()

    out: list[dict[str, Any]] = []
    for p in printers:
        out.append({
            "nombre": p.name,
            "modelo": p.model,
            "estado": STATUS_LABELS.get(p.status, p.status),
            "estado_codigo": p.status,
            "imprimiendo": p.current_filename if p.status == "printing" else None,
            "progreso_pct": round(p.current_job_progress, 1) if p.status == "printing" else None,
            "tiempo_restante": _fmt_duration(p.eta_seconds) if p.status == "printing" else None,
            "temp_hotend": round(p.hotend_temp, 1),
            "temp_cama": round(p.bed_temp, 1),
            "bobina_asignada_id": p.current_spool_id,
        })
    return out


@tool_registry.register(
    name="listar_bobinas",
    description=(
        "Devuelve las bobinas de filamento registradas en Spoolman con material, "
        "color, marca y cuánto filamento les queda (en gramos y metros). Usar para "
        "preguntas sobre stock de filamento o cuánto le queda a una bobina."
    ),
    domain=DOMAIN,
)
async def listar_bobinas() -> dict[str, Any]:
    spools = await spoolman_client.get_spools()
    if not spools:
        return {"bobinas": [], "nota": "No hay bobinas en Spoolman o no está accesible."}

    out: list[dict[str, Any]] = []
    for s in spools:
        if s.get("archived"):
            continue
        filament = s.get("filament", {}) or {}
        vendor = filament.get("vendor", {}) or {}
        remaining_w = s.get("remaining_weight")
        remaining_l = s.get("remaining_length")
        out.append({
            "id": s.get("id"),
            "material": filament.get("material", "?"),
            "color": filament.get("name") or filament.get("color_hex") or "?",
            "marca": vendor.get("name", "?"),
            "gramos_restantes": round(remaining_w, 1) if remaining_w is not None else None,
            "metros_restantes": round(remaining_l / 1000, 1) if remaining_l is not None else None,
        })
    return {"bobinas": out}


@tool_registry.register(
    name="ver_cola",
    description=(
        "Devuelve la cola de trabajos de impresión: lo pendiente, lo que se está "
        "imprimiendo y lo que está EN PAUSA (no se despacha hasta reanudarlo), con "
        "material, color, copias y prioridad. Usar para preguntas sobre qué hay "
        "encolado, cuántos trabajos faltan o qué está pausado."
    ),
    domain=DOMAIN,
)
async def ver_cola() -> dict[str, Any]:
    async with async_session() as session:
        printers = {
            p.id: p.name
            for p in (await session.execute(select(Printer))).scalars().all()
        }
        result = await session.execute(
            select(PrintJob)
            .where(PrintJob.status.in_(["pending", "printing", "paused"]))
            .order_by(PrintJob.status, PrintJob.priority.desc(), PrintJob.created_at)
        )
        jobs = result.scalars().all()

    job_status_labels = {"printing": "imprimiendo", "paused": "en pausa", "pending": "pendiente"}
    out: list[dict[str, Any]] = []
    for j in jobs:
        out.append({
            "nombre": j.name,
            "estado": job_status_labels.get(j.status, j.status),
            "material": j.required_material,
            "color": j.required_color,
            "copias": f"{j.copies_completed}/{j.copies}",
            "prioridad": j.priority,
            "impresora": printers.get(j.assigned_printer_id) if j.assigned_printer_id else None,
        })
    pendientes = sum(1 for j in jobs if j.status == "pending")
    pausados = sum(1 for j in jobs if j.status == "paused")
    return {"total_en_cola": len(out), "pendientes": pendientes, "en_pausa": pausados, "trabajos": out}


@tool_registry.register(
    name="alertas_mantenimiento",
    description=(
        "Devuelve las alertas de mantenimiento de las impresoras: tareas que ya "
        "superaron su umbral de horas o que están por vencer (más del 75%). Usar "
        "para preguntas sobre qué impresora necesita mantenimiento o qué hay que revisar."
    ),
    domain=DOMAIN,
)
async def alertas_mantenimiento() -> dict[str, Any]:
    async with async_session() as session:
        printers = {
            p.id: p.name
            for p in (await session.execute(select(Printer))).scalars().all()
        }
        records = (
            await session.execute(select(MaintenanceRecord))
        ).scalars().all()

    alertas: list[dict[str, Any]] = []
    for r in records:
        pct = (r.accumulated_hours / r.threshold_hours * 100) if r.threshold_hours else 0
        if r.is_alert_active or pct >= 75:
            label = r.custom_label or MAINT_LABELS.get(r.maintenance_type, r.maintenance_type)
            alertas.append({
                "impresora": printers.get(r.printer_id, f"#{r.printer_id}"),
                "tarea": label,
                "horas_acumuladas": round(r.accumulated_hours, 1),
                "umbral_horas": round(r.threshold_hours, 1),
                "porcentaje": round(pct, 0),
                "vencida": r.is_alert_active or pct >= 100,
            })

    alertas.sort(key=lambda a: a["porcentaje"], reverse=True)
    if not alertas:
        return {"alertas": [], "resumen": "Todas las impresoras están al día con el mantenimiento."}
    vencidas = sum(1 for a in alertas if a["vencida"])
    return {"total_alertas": len(alertas), "vencidas": vencidas, "alertas": alertas}


@tool_registry.register(
    name="ver_historial",
    description=(
        "Devuelve el historial de impresiones ya terminadas (exitosas, fallidas o "
        "canceladas) de los últimos N días, con un resumen agregado (cantidad total, "
        "cuántas salieron bien o mal, horas de impresión y gramos de filamento "
        "consumidos, y desglose por impresora y por material) más el detalle de cada "
        "impresión. Usar para preguntas sobre qué se imprimió, resúmenes de la semana "
        "o del día, cuánto se produjo, cuántas fallaron o cuánto filamento se gastó."
    ),
    parameters={
        "type": "object",
        "properties": {
            "dias": {
                "type": "integer",
                "description": (
                    "Cuántos días hacia atrás incluir. 1 = hoy/ayer, 7 = última "
                    "semana, 30 = último mes. Por defecto 7."
                ),
            },
        },
    },
    domain=DOMAIN,
)
async def ver_historial(dias: int = 7) -> dict[str, Any]:
    try:
        dias = int(dias)
    except (TypeError, ValueError):
        dias = 7
    dias = max(1, min(dias, 365))
    # PrintHistory timestamps are stored as naive UTC (DateTime sin tz).
    cutoff = datetime.utcnow() - timedelta(days=dias)

    async with async_session() as session:
        result = await session.execute(
            select(PrintHistory)
            .where(PrintHistory.completed_at >= cutoff)
            .order_by(PrintHistory.completed_at.desc())
        )
        records = result.scalars().all()

    if not records:
        return {
            "periodo_dias": dias,
            "total": 0,
            "resumen": f"No hay impresiones registradas en los últimos {dias} días.",
        }

    por_resultado: dict[str, int] = {}
    por_impresora: dict[str, int] = {}
    por_material: dict[str, int] = {}
    total_segundos = 0
    total_gramos = 0.0

    detalle: list[dict[str, Any]] = []
    for r in records:
        por_resultado[r.result] = por_resultado.get(r.result, 0) + 1
        if r.printer_name:
            por_impresora[r.printer_name] = por_impresora.get(r.printer_name, 0) + 1
        if r.material:
            por_material[r.material] = por_material.get(r.material, 0) + 1
        if r.duration_secs:
            total_segundos += int(r.duration_secs)
        if r.estimated_weight_g:
            total_gramos += float(r.estimated_weight_g)
        detalle.append({
            "trabajo": r.job_name or r.gcode_filename,
            "impresora": r.printer_name or f"#{r.printer_id}",
            "material": r.material or "?",
            "color": r.required_color,
            "resultado": RESULT_LABELS.get(r.result, r.result),
            "duracion": _fmt_duration(r.duration_secs),
            "gramos": round(r.estimated_weight_g, 1) if r.estimated_weight_g else None,
            "terminada": r.completed_at.isoformat() if r.completed_at else None,
        })

    return {
        "periodo_dias": dias,
        "total": len(records),
        "por_resultado": {
            RESULT_LABELS.get(k, k): v for k, v in por_resultado.items()
        },
        "por_impresora": por_impresora,
        "por_material": por_material,
        "horas_impresion_total": round(total_segundos / 3600, 1) if total_segundos else 0,
        "gramos_filamento_total": round(total_gramos, 1) if total_gramos else 0,
        "impresiones": detalle,
    }
