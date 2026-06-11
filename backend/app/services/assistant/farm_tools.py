"""
3D-farm domain tools (read-only — phase 1).

These register onto the shared `tool_registry`. They reuse the same data sources
the rest of the app uses (printers DB, Spoolman, queue, maintenance) so the
assistant never reports anything the dashboard wouldn't.

Action tools (pause/dispatch/clear-bed) will be added later with is_action=True;
the plumbing already supports them.
"""

import logging
from typing import Any

from sqlalchemy import select

from app.database import async_session
from app.models.maintenance import MaintenanceRecord
from app.models.print_job import PrintJob
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
        "Devuelve la cola de trabajos de impresión: lo que está pendiente y lo que "
        "se está imprimiendo, con material, color, copias y prioridad. Usar para "
        "preguntas sobre qué hay encolado o cuántos trabajos faltan."
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
            .where(PrintJob.status.in_(["pending", "printing"]))
            .order_by(PrintJob.status, PrintJob.priority.desc(), PrintJob.created_at)
        )
        jobs = result.scalars().all()

    out: list[dict[str, Any]] = []
    for j in jobs:
        out.append({
            "nombre": j.name,
            "estado": "imprimiendo" if j.status == "printing" else "pendiente",
            "material": j.required_material,
            "color": j.required_color,
            "copias": f"{j.copies_completed}/{j.copies}",
            "prioridad": j.priority,
            "impresora": printers.get(j.assigned_printer_id) if j.assigned_printer_id else None,
        })
    pendientes = sum(1 for j in jobs if j.status == "pending")
    return {"total_en_cola": len(out), "pendientes": pendientes, "trabajos": out}


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
