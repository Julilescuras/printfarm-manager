"""
Manages custom tools (G-code macros) and the disabled-tool registry state.

Call refresh_custom_tools() after any CRUD on custom_tools.
Call refresh_disabled_tools() after toggling a builtin tool's enabled state.
"""

import json
import logging
from typing import Any

from sqlalchemy import select

from app.database import async_session
from app.models.custom_tool import CustomTool
from app.models.settings import AppSettings
from app.services.assistant.registry import tool_registry
from app.services.moonraker import moonraker_manager

logger = logging.getLogger("printfarm.assistant")

CUSTOM_DOMAIN = "custom"

_PRINTER_PARAM = {
    "type": "object",
    "properties": {
        "impresora": {
            "type": "string",
            "description": "Nombre o identificador de la impresora.",
        }
    },
    "required": ["impresora"],
}


async def _resolve_printer(query: str):
    """Find a printer from a loose user-typed name. Returns (printer_id, name) or None."""
    from app.models.printer import Printer
    async with async_session() as session:
        printers = (await session.execute(select(Printer))).scalars().all()
    if not query:
        return None
    q = query.strip().lower()
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


def _make_printer_handler(tool_name: str, gcode: str):
    """Return an async handler that resolves a printer and runs the G-code."""

    async def handler(impresora: str) -> dict[str, Any]:
        printer = await _resolve_printer(impresora)
        if not printer:
            return {"error": f"No encontré una impresora que coincida con '{impresora}'."}
        if printer.status == "printing":
            return {"error": f"{printer.name} está imprimiendo; no ejecuto el script para no interferir."}
        printer_id, name = printer.id, printer.name

        client = moonraker_manager.get_client(printer_id)
        if not client or not client.is_connected:
            return {"error": f"{name} no está conectada a Moonraker."}
        ok = await client.run_gcode(gcode)
        return {
            "ok": ok,
            "impresora": name,
            "resultado": "Script ejecutado correctamente." if ok else "No se pudo ejecutar el script.",
        }

    handler.__name__ = tool_name
    return handler


def _make_no_printer_handler(tool_name: str):
    async def handler() -> dict[str, Any]:
        return {"error": "Esta herramienta no tiene impresora destino configurada."}

    handler.__name__ = tool_name
    return handler


async def refresh_custom_tools() -> None:
    """Unregister all custom tools and re-register the enabled ones from the DB."""
    tool_registry.unregister_domain(CUSTOM_DOMAIN)

    async with async_session() as session:
        tools = (
            await session.execute(
                select(CustomTool).where(CustomTool.enabled == True)  # noqa: E712
            )
        ).scalars().all()

    for t in tools:
        params = _PRINTER_PARAM if t.requires_printer else {"type": "object", "properties": {}}
        handler = (
            _make_printer_handler(t.name, t.gcode)
            if t.requires_printer
            else _make_no_printer_handler(t.name)
        )
        tool_registry.register(
            name=t.name,
            description=t.description,
            parameters=params,
            is_action=t.is_action,
            domain=CUSTOM_DOMAIN,
        )(handler)

    logger.info("Custom tools refreshed: %d registered", len(tools))


async def refresh_disabled_tools() -> None:
    """Load the disabled-builtin list from settings and push it into the registry."""
    async with async_session() as session:
        row = (
            await session.execute(
                select(AppSettings).where(AppSettings.key == "assistant_disabled_tools")
            )
        ).scalar_one_or_none()
    disabled: set[str] = set()
    if row and row.value:
        try:
            disabled = set(json.loads(row.value))
        except (json.JSONDecodeError, TypeError):
            pass
    tool_registry.set_disabled(disabled)
    logger.debug("Disabled tools loaded: %s", disabled)
