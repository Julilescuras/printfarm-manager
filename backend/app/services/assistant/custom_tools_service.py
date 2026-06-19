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
from app.services.assistant.farm_tools import match_printers
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


def _make_printer_handler(tool_name: str, gcode: str):
    """Return an async handler that resolves one or more printers and runs the
    G-code on each. Accepts a group term ('enders', 'todas') and skips any
    printer that is currently printing, so a macro never interrupts a job."""

    async def handler(impresora: str) -> dict[str, Any]:
        async with async_session() as session:
            targets = await match_printers(session, impresora)
            if not targets:
                return {"error": f"No encontré ninguna impresora que coincida con '{impresora}'."}
            candidatas = [(p.id, p.name) for p in targets if p.status != "printing"]
            imprimiendo = [p.name for p in targets if p.status == "printing"]

        if not candidatas:
            return {
                "ok": False,
                "ejecutado_en": [],
                "imprimiendo": imprimiendo,
                "mensaje": "Esas impresoras están imprimiendo; no ejecuto el script para no interferir.",
            }

        ejecutado: list[str] = []
        fallaron: list[str] = []
        for printer_id, name in candidatas:
            client = moonraker_manager.get_client(printer_id)
            if not client or not client.is_connected:
                fallaron.append(f"{name} (no conectada a Moonraker)")
                continue
            if await client.run_gcode(gcode):
                ejecutado.append(name)
            else:
                fallaron.append(name)

        return {
            "ok": bool(ejecutado),
            "ejecutado_en": ejecutado,
            "fallaron": fallaron,
            "imprimiendo": imprimiendo,
        }

    handler.__name__ = tool_name
    return handler


async def refresh_custom_tools() -> None:
    """Unregister all custom tools and re-register the enabled ones from the DB.

    Every custom tool runs G-code on a target printer, so it is ALWAYS registered
    as an action (requires authorization) and ALWAYS takes a printer argument —
    regardless of how the DB row's is_action/requires_printer flags were saved.
    This closes the hole where a G-code macro stored with is_action=False would
    have been exposed to unauthorized users.
    """
    tool_registry.unregister_domain(CUSTOM_DOMAIN)

    async with async_session() as session:
        tools = (
            await session.execute(
                select(CustomTool).where(CustomTool.enabled == True)  # noqa: E712
            )
        ).scalars().all()

    for t in tools:
        tool_registry.register(
            name=t.name,
            description=t.description,
            parameters=_PRINTER_PARAM,
            is_action=True,
            domain=CUSTOM_DOMAIN,
        )(_make_printer_handler(t.name, t.gcode))

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
