"""
3D-farm ACTION tools (phase 2.1) — these mutate printer state.

Registered with is_action=True, so the agent only exposes them to authorized +
PIN-unlocked users. They reuse the exact same services the dashboard buttons use
(dispatcher + Moonraker client), and respect the bed_cleared safety invariant:
emptying the bed via the bot counts as a human ("the operator asked for it"),
identical to pressing "Vaciar Cama" in the UI.
"""

import json
import logging
from typing import Any, Optional

from sqlalchemy import select

from app.database import async_session
from app.models.printer import Printer
from app.models.print_job import PrintJob
from app.models.settings import AppSettings
from app.services.assistant.registry import tool_registry
from app.services.dispatcher import dispatcher
from app.services.moonraker import moonraker_manager
from app.services.assistant.farm_tools import DOMAIN, STATUS_LABELS
from app.ws.hub import ws_hub

logger = logging.getLogger("printfarm.assistant")

# Default preheat temps per material (hotend, bed) in °C — overridable via settings.
DEFAULT_MATERIAL_TEMPS: dict[str, tuple[int, int]] = {
    "PLA": (205, 60),
    "PETG": (240, 80),
    "ABS": (250, 100),
    "ASA": (250, 100),
    "TPU": (230, 45),
    "NYLON": (260, 90),
}


async def _get_material_temps() -> dict[str, tuple[int, int]]:
    """Read material temps from settings, falling back to defaults per material."""
    async with async_session() as session:
        row = (
            await session.execute(
                select(AppSettings).where(AppSettings.key == "assistant_material_temps")
            )
        ).scalar_one_or_none()
    if row and row.value:
        try:
            data = json.loads(row.value)
            result: dict[str, tuple[int, int]] = {}
            for mat, temps in data.items():
                if isinstance(temps, dict):
                    default_h, default_b = DEFAULT_MATERIAL_TEMPS.get(mat.upper(), (200, 60))
                    hotend = int(temps.get("hotend", default_h))
                    bed = int(temps.get("bed", default_b))
                    result[mat.upper()] = (hotend, bed)
            if result:
                return result
        except (json.JSONDecodeError, TypeError, ValueError, KeyError):
            pass
    return DEFAULT_MATERIAL_TEMPS

PRINTER_ARG = {
    "type": "object",
    "properties": {
        "impresora": {
            "type": "string",
            "description": "Nombre o identificador de la impresora, ej. 'Ender 3 i4' o 'i4'.",
        }
    },
    "required": ["impresora"],
}


async def _find_printer(session, query: str) -> Optional[Printer]:
    """Resolve a printer from a loose name the user spoke/typed."""
    printers = (await session.execute(select(Printer))).scalars().all()
    if not query:
        return None
    q = query.strip().lower()
    # exact name, then substring, then token match (handles "i4", "ender 2").
    for p in printers:
        if p.name.lower() == q:
            return p
    for p in printers:
        if q in p.name.lower() or p.name.lower() in q:
            return p
    q_tokens = set(q.replace("-", " ").split())
    for p in printers:
        if q_tokens & set(p.name.lower().replace("-", " ").split()):
            return p
    return None


async def _find_jobs(session, query: str, statuses: list[str]) -> list[PrintJob]:
    """Resolve queue jobs matching a loose name the user spoke/typed.

    Searches only within `statuses`. Returns every candidate so the caller can
    disambiguate (ask the user) when more than one matches, instead of guessing.
    Tries, in order: exact name, substring (either direction), token overlap —
    and stops at the first tier that yields any match.
    """
    jobs = (
        await session.execute(
            select(PrintJob).where(PrintJob.status.in_(statuses)).order_by(PrintJob.id)
        )
    ).scalars().all()
    if not query:
        return []
    q = query.strip().lower()

    def names(j: PrintJob) -> list[str]:
        return [n.lower() for n in (j.name, j.gcode_original_name) if n]

    exact = [j for j in jobs if any(n == q for n in names(j))]
    if exact:
        return exact
    substr = [j for j in jobs if any(q in n or n in q for n in names(j))]
    if substr:
        return substr
    q_tokens = set(q.replace("-", " ").replace("_", " ").split())
    token = [
        j for j in jobs
        if q_tokens & set(" ".join(names(j)).replace("-", " ").replace("_", " ").split())
    ]
    return token


def _label(status: str) -> str:
    return STATUS_LABELS.get(status, status)


async def _broadcast(printer: Printer) -> None:
    try:
        await ws_hub.broadcast_printer_update(printer.to_dict())
        await ws_hub.broadcast_queue_update()
    except Exception:  # noqa: BLE001 — broadcasting must never break an action
        logger.debug("ws broadcast failed after action", exc_info=True)


async def _broadcast_queue() -> None:
    try:
        await ws_hub.broadcast_queue_update()
    except Exception:  # noqa: BLE001 — broadcasting must never break an action
        logger.debug("ws queue broadcast failed after action", exc_info=True)


@tool_registry.register(
    name="vaciar_cama",
    description=(
        "Marca la cama de una impresora como vacía (equivale al botón 'Vaciar Cama') "
        "y despacha el próximo trabajo compatible. Solo válido si la impresora terminó "
        "y está esperando que se retire la pieza."
    ),
    parameters=PRINTER_ARG,
    is_action=True,
    domain=DOMAIN,
)
async def vaciar_cama(impresora: str) -> dict[str, Any]:
    async with async_session() as session:
        printer = await _find_printer(session, impresora)
        if not printer:
            return {"error": f"No encontré una impresora que coincida con '{impresora}'."}
        if printer.status != "requires_clearance":
            return {"error": f"{printer.name} no está esperando vaciado (está: {_label(printer.status)})."}

        await dispatcher.on_print_complete(printer.id)
        printer.status = "available"
        printer.bed_cleared = True
        printer.current_job_progress = 0.0
        printer.current_filename = None
        printer.thumbnail_url = None
        await session.commit()
        await session.refresh(printer)
        await _broadcast(printer)

    dispatched = await dispatcher.try_dispatch(printer.id)
    return {
        "ok": True,
        "impresora": printer.name,
        "resultado": "Cama vaciada" + (" y se envió el próximo trabajo." if dispatched else ". No hay trabajos compatibles pendientes."),
    }


@tool_registry.register(
    name="despachar_trabajo",
    description=(
        "Envía el próximo trabajo compatible de la cola a una impresora libre "
        "(en espera o disponible)."
    ),
    parameters=PRINTER_ARG,
    is_action=True,
    domain=DOMAIN,
)
async def despachar_trabajo(impresora: str) -> dict[str, Any]:
    async with async_session() as session:
        printer = await _find_printer(session, impresora)
        if not printer:
            return {"error": f"No encontré una impresora que coincida con '{impresora}'."}
        if printer.status not in ("standby", "available"):
            return {"error": f"{printer.name} no está libre (está: {_label(printer.status)})."}
        printer_id, name = printer.id, printer.name

    dispatched = await dispatcher.try_dispatch(printer_id)
    return {
        "ok": True,
        "impresora": name,
        "resultado": "Trabajo enviado." if dispatched else "No hay trabajos compatibles en la cola.",
    }


JOB_ARG = {
    "type": "object",
    "properties": {
        "trabajo": {
            "type": "string",
            "description": (
                "Nombre del trabajo de la cola o de su archivo gcode, ej. "
                "'soporte monitor' o 'pieza_v2.gcode'."
            ),
        }
    },
    "required": ["trabajo"],
}


@tool_registry.register(
    name="pausar_trabajo",
    description=(
        "Pone EN PAUSA un trabajo PENDIENTE de la cola para que no se despache a "
        "ninguna impresora hasta que se reanude. No afecta impresiones en curso "
        "(para eso está 'pausar_impresion'). Identificá el trabajo por su nombre."
    ),
    parameters=JOB_ARG,
    is_action=True,
    domain=DOMAIN,
)
async def pausar_trabajo(trabajo: str) -> dict[str, Any]:
    async with async_session() as session:
        matches = await _find_jobs(session, trabajo, ["pending"])
        if not matches:
            return {"error": f"No encontré ningún trabajo pendiente que coincida con '{trabajo}'."}
        if len(matches) > 1:
            return {
                "ambiguo": True,
                "mensaje": "Hay varios trabajos pendientes que coinciden; especificá cuál.",
                "candidatos": [m.name for m in matches],
            }
        job = matches[0]
        job.status = "paused"
        name = job.name
        await session.commit()
    await _broadcast_queue()
    return {"ok": True, "trabajo": name, "resultado": "Trabajo puesto en pausa. No se despachará hasta reanudarlo."}


@tool_registry.register(
    name="reanudar_trabajo",
    description=(
        "Saca de pausa un trabajo de la cola que estaba EN PAUSA: lo vuelve a poner "
        "pendiente y dispara el despacho normal (busca una impresora compatible "
        "libre). Identificá el trabajo por su nombre."
    ),
    parameters=JOB_ARG,
    is_action=True,
    domain=DOMAIN,
)
async def reanudar_trabajo(trabajo: str) -> dict[str, Any]:
    async with async_session() as session:
        matches = await _find_jobs(session, trabajo, ["paused"])
        if not matches:
            return {"error": f"No encontré ningún trabajo en pausa que coincida con '{trabajo}'."}
        if len(matches) > 1:
            return {
                "ambiguo": True,
                "mensaje": "Hay varios trabajos en pausa que coinciden; especificá cuál.",
                "candidatos": [m.name for m in matches],
            }
        job = matches[0]
        job.status = "pending"
        name = job.name
        await session.commit()
    await _broadcast_queue()
    dispatched = await dispatcher.try_dispatch_all()
    return {
        "ok": True,
        "trabajo": name,
        "resultado": "Trabajo reanudado y vuelto a la cola. Se intentó despacharlo a una impresora compatible.",
    }


@tool_registry.register(
    name="pausar_impresion",
    description="Pausa la impresión en curso de una impresora.",
    parameters=PRINTER_ARG,
    is_action=True,
    domain=DOMAIN,
)
async def pausar_impresion(impresora: str) -> dict[str, Any]:
    async with async_session() as session:
        printer = await _find_printer(session, impresora)
        if not printer:
            return {"error": f"No encontré una impresora que coincida con '{impresora}'."}
        if printer.status != "printing":
            return {"error": f"{printer.name} no está imprimiendo (está: {_label(printer.status)})."}
        printer_id, name = printer.id, printer.name

    client = moonraker_manager.get_client(printer_id)
    if not client or not client.is_connected:
        return {"error": f"{name} no está conectada a Moonraker."}
    ok = await client.pause_print()
    return {"ok": ok, "impresora": name, "resultado": "Impresión pausada." if ok else "No se pudo pausar."}


@tool_registry.register(
    name="reanudar_impresion",
    description="Reanuda una impresión que estaba pausada.",
    parameters=PRINTER_ARG,
    is_action=True,
    domain=DOMAIN,
)
async def reanudar_impresion(impresora: str) -> dict[str, Any]:
    async with async_session() as session:
        printer = await _find_printer(session, impresora)
        if not printer:
            return {"error": f"No encontré una impresora que coincida con '{impresora}'."}
        printer_id, name = printer.id, printer.name

    client = moonraker_manager.get_client(printer_id)
    if not client or not client.is_connected:
        return {"error": f"{name} no está conectada a Moonraker."}
    ok = await client.resume_print()
    return {"ok": ok, "impresora": name, "resultado": "Impresión reanudada." if ok else "No se pudo reanudar."}


@tool_registry.register(
    name="precalentar",
    description=(
        "Precalienta una impresora a las temperaturas configuradas para un material "
        "(PLA, PETG, ABS, ASA, TPU, NYLON u otros materiales personalizados), "
        "lista para empezar a imprimir."
    ),
    parameters={
        "type": "object",
        "properties": {
            "impresora": {"type": "string", "description": "Nombre o id de la impresora."},
            "material": {
                "type": "string",
                "description": "Material (PLA, PETG, ABS, ASA, TPU, NYLON u otro configurado).",
            },
        },
        "required": ["impresora", "material"],
    },
    is_action=True,
    domain=DOMAIN,
)
async def precalentar(impresora: str, material: str) -> dict[str, Any]:
    mat = (material or "").strip().upper()
    material_temps = await _get_material_temps()
    if mat not in material_temps:
        return {"error": f"No conozco el material '{material}'. Opciones: {', '.join(material_temps)}."}
    hotend, bed = material_temps[mat]

    async with async_session() as session:
        printer = await _find_printer(session, impresora)
        if not printer:
            return {"error": f"No encontré una impresora que coincida con '{impresora}'."}
        if printer.status == "printing":
            return {"error": f"{printer.name} está imprimiendo; no la precaliento para no interferir."}
        printer_id, name = printer.id, printer.name

    client = moonraker_manager.get_client(printer_id)
    if not client or not client.is_connected:
        return {"error": f"{name} no está conectada a Moonraker."}
    ok = await client.run_gcode(f"M140 S{bed}\nM104 S{hotend}")
    return {
        "ok": ok,
        "impresora": name,
        "material": mat,
        "resultado": f"Precalentando para {mat}: hotend {hotend}°C, cama {bed}°C." if ok else "No se pudo precalentar.",
    }


@tool_registry.register(
    name="enfriar",
    description="Apaga todos los calentadores de una impresora (hotend y cama).",
    parameters=PRINTER_ARG,
    is_action=True,
    domain=DOMAIN,
)
async def enfriar(impresora: str) -> dict[str, Any]:
    async with async_session() as session:
        printer = await _find_printer(session, impresora)
        if not printer:
            return {"error": f"No encontré una impresora que coincida con '{impresora}'."}
        if printer.status == "printing":
            return {"error": f"{printer.name} está imprimiendo; no apago los calentadores."}
        printer_id, name = printer.id, printer.name

    client = moonraker_manager.get_client(printer_id)
    if not client or not client.is_connected:
        return {"error": f"{name} no está conectada a Moonraker."}
    ok = await client.run_gcode("TURN_OFF_HEATERS")
    return {"ok": ok, "impresora": name, "resultado": "Calentadores apagados." if ok else "No se pudo apagar."}


@tool_registry.register(
    name="cancelar_impresion",
    description=(
        "Cancela (aborta) la impresión en curso de una impresora. Acción destructiva: "
        "queda una pieza a medias en la cama. Confirmá siempre antes de usarla."
    ),
    parameters=PRINTER_ARG,
    is_action=True,
    domain=DOMAIN,
)
async def cancelar_impresion(impresora: str) -> dict[str, Any]:
    async with async_session() as session:
        printer = await _find_printer(session, impresora)
        if not printer:
            return {"error": f"No encontré una impresora que coincida con '{impresora}'."}
        if printer.status != "printing":
            return {"error": f"{printer.name} no está imprimiendo (está: {_label(printer.status)})."}
        printer_id, name = printer.id, printer.name

    client = moonraker_manager.get_client(printer_id)
    if client and client.is_connected:
        await client.cancel_print()
    await dispatcher.on_print_aborted(printer_id, "cancelled")

    async with async_session() as session:
        printer = (await session.execute(select(Printer).where(Printer.id == printer_id))).scalar_one_or_none()
        if printer:
            printer.status = "requires_clearance"
            printer.current_job_progress = 0.0
            await session.commit()
            await session.refresh(printer)
            await _broadcast(printer)
    return {"ok": True, "impresora": name, "resultado": "Impresión cancelada. La impresora quedó esperando que vacíes la cama."}


@tool_registry.register(
    name="reiniciar_firmware",
    description=(
        "Reinicia el firmware de Klipper (FIRMWARE_RESTART) de una impresora. Sirve "
        "para sacarla de un estado de error sin tocarla físicamente."
    ),
    parameters=PRINTER_ARG,
    is_action=True,
    domain=DOMAIN,
)
async def reiniciar_firmware(impresora: str) -> dict[str, Any]:
    async with async_session() as session:
        printer = await _find_printer(session, impresora)
        if not printer:
            return {"error": f"No encontré una impresora que coincida con '{impresora}'."}
        if printer.status == "printing":
            return {"error": f"{printer.name} está imprimiendo; reiniciar el firmware abortaría la impresión."}
        printer_id, name = printer.id, printer.name

    client = moonraker_manager.get_client(printer_id)
    if not client or not client.is_connected:
        return {"error": f"{name} no está conectada a Moonraker."}
    ok = await client.firmware_restart()
    return {"ok": ok, "impresora": name, "resultado": "Firmware reiniciado." if ok else "No se pudo reiniciar el firmware."}
