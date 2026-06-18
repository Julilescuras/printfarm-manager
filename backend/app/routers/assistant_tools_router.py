"""
Assistant Tools Router — configure bot tools: material temps, enable/disable, custom macros.
"""

import json
import re
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.custom_tool import CustomTool
from app.models.settings import AppSettings
from app.services.assistant.registry import tool_registry
from app.services.assistant.custom_tools_service import (
    CUSTOM_DOMAIN,
    refresh_custom_tools,
    refresh_disabled_tools,
)

router = APIRouter(prefix="/api/settings/assistant", tags=["assistant-tools"])

_VALID_NAME = re.compile(r"^[a-z][a-z0-9_]{1,49}$")


# ── Material temps ─────────────────────────────────────────────────────────────

@router.get("/material-temps")
async def get_material_temps(db: AsyncSession = Depends(get_db)):
    row = (
        await db.execute(
            select(AppSettings).where(AppSettings.key == "assistant_material_temps")
        )
    ).scalar_one_or_none()
    if row and row.value:
        try:
            return json.loads(row.value)
        except (json.JSONDecodeError, TypeError):
            pass
    from app.services.assistant.action_tools import DEFAULT_MATERIAL_TEMPS
    return {mat: {"hotend": h, "bed": b} for mat, (h, b) in DEFAULT_MATERIAL_TEMPS.items()}


class MaterialTempsPayload(BaseModel):
    temps: dict[str, dict[str, int]]


@router.put("/material-temps")
async def update_material_temps(
    data: MaterialTempsPayload,
    db: AsyncSession = Depends(get_db),
):
    payload = json.dumps(
        {mat.upper(): {"hotend": v["hotend"], "bed": v["bed"]} for mat, v in data.temps.items()}
    )
    row = (
        await db.execute(
            select(AppSettings).where(AppSettings.key == "assistant_material_temps")
        )
    ).scalar_one_or_none()
    if row:
        row.value = payload
    else:
        db.add(AppSettings(key="assistant_material_temps", value=payload))
    await db.commit()
    return {"status": "ok"}


# ── Tool listing & enable/disable ──────────────────────────────────────────────

@router.get("/tools")
async def list_tools(db: AsyncSession = Depends(get_db)):
    row = (
        await db.execute(
            select(AppSettings).where(AppSettings.key == "assistant_disabled_tools")
        )
    ).scalar_one_or_none()
    disabled: set[str] = set()
    if row and row.value:
        try:
            disabled = set(json.loads(row.value))
        except (json.JSONDecodeError, TypeError):
            pass

    custom_db = (await db.execute(select(CustomTool).order_by(CustomTool.name))).scalars().all()
    custom_names = {t.name for t in custom_db}

    result: list[dict[str, Any]] = []
    for t in tool_registry.all_tools():
        if t.domain != CUSTOM_DOMAIN:
            result.append({
                "name": t.spec.name,
                "description": t.spec.description,
                "is_action": t.is_action,
                "domain": t.domain,
                "enabled": t.spec.name not in disabled,
                "is_custom": False,
            })

    for ct in custom_db:
        result.append({
            "name": ct.name,
            "description": ct.description,
            "is_action": ct.is_action,
            "domain": CUSTOM_DOMAIN,
            "enabled": ct.enabled,
            "is_custom": True,
        })

    return result


class ToolEnabledPayload(BaseModel):
    enabled: bool


@router.put("/tools/{name}/enabled")
async def set_tool_enabled(
    name: str,
    data: ToolEnabledPayload,
    db: AsyncSession = Depends(get_db),
):
    # Custom tool — toggle via DB
    ct = (await db.execute(select(CustomTool).where(CustomTool.name == name))).scalar_one_or_none()
    if ct:
        ct.enabled = data.enabled
        await db.commit()
        await refresh_custom_tools()
        return {"status": "ok", "name": name, "enabled": data.enabled}

    # Builtin — toggle via assistant_disabled_tools setting
    if tool_registry.get(name) is None:
        raise HTTPException(status_code=404, detail=f"Herramienta '{name}' no encontrada.")

    row = (
        await db.execute(
            select(AppSettings).where(AppSettings.key == "assistant_disabled_tools")
        )
    ).scalar_one_or_none()
    disabled: set[str] = set()
    if row and row.value:
        try:
            disabled = set(json.loads(row.value))
        except (json.JSONDecodeError, TypeError):
            pass

    if data.enabled:
        disabled.discard(name)
    else:
        disabled.add(name)

    payload = json.dumps(sorted(disabled))
    if row:
        row.value = payload
    else:
        db.add(AppSettings(key="assistant_disabled_tools", value=payload))
    await db.commit()
    tool_registry.set_disabled(disabled)

    return {"status": "ok", "name": name, "enabled": data.enabled}


# ── Custom tools CRUD ──────────────────────────────────────────────────────────

class CustomToolCreate(BaseModel):
    name: str
    description: str
    gcode: str
    is_action: bool = True
    requires_printer: bool = True


class CustomToolUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    gcode: Optional[str] = None
    is_action: Optional[bool] = None
    requires_printer: Optional[bool] = None
    enabled: Optional[bool] = None


@router.get("/custom-tools")
async def list_custom_tools(db: AsyncSession = Depends(get_db)):
    tools = (await db.execute(select(CustomTool).order_by(CustomTool.created_at))).scalars().all()
    return [t.to_dict() for t in tools]


@router.post("/custom-tools")
async def create_custom_tool(data: CustomToolCreate, db: AsyncSession = Depends(get_db)):
    name = data.name.strip().lower().replace(" ", "_")
    if not _VALID_NAME.match(name):
        raise HTTPException(
            status_code=422,
            detail="El nombre debe ser snake_case: solo minúsculas, números y guiones bajos, 2–50 caracteres.",
        )
    if tool_registry.get(name) is not None and tool_registry.get(name).domain != CUSTOM_DOMAIN:
        raise HTTPException(status_code=409, detail=f"'{name}' es el nombre de una herramienta integrada.")
    existing = (
        await db.execute(select(CustomTool).where(CustomTool.name == name))
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail=f"Ya existe una herramienta personalizada con el nombre '{name}'.")

    tool = CustomTool(
        name=name,
        description=data.description.strip(),
        gcode=data.gcode.strip(),
        is_action=data.is_action,
        requires_printer=data.requires_printer,
        enabled=True,
    )
    db.add(tool)
    await db.commit()
    await db.refresh(tool)
    await refresh_custom_tools()
    return tool.to_dict()


@router.put("/custom-tools/{tool_id}")
async def update_custom_tool(
    tool_id: int,
    data: CustomToolUpdate,
    db: AsyncSession = Depends(get_db),
):
    tool = (
        await db.execute(select(CustomTool).where(CustomTool.id == tool_id))
    ).scalar_one_or_none()
    if not tool:
        raise HTTPException(status_code=404, detail="Herramienta no encontrada.")

    if data.name is not None:
        new_name = data.name.strip().lower().replace(" ", "_")
        if not _VALID_NAME.match(new_name):
            raise HTTPException(status_code=422, detail="Nombre inválido.")
        if new_name != tool.name:
            existing_builtin = tool_registry.get(new_name)
            if existing_builtin and existing_builtin.domain != CUSTOM_DOMAIN:
                raise HTTPException(status_code=409, detail=f"'{new_name}' es el nombre de una herramienta integrada.")
            existing_other = (
                await db.execute(
                    select(CustomTool).where(CustomTool.name == new_name, CustomTool.id != tool_id)
                )
            ).scalar_one_or_none()
            if existing_other:
                raise HTTPException(status_code=409, detail=f"Ya existe otra herramienta con el nombre '{new_name}'.")
        tool.name = new_name
    if data.description is not None:
        tool.description = data.description.strip()
    if data.gcode is not None:
        tool.gcode = data.gcode.strip()
    if data.is_action is not None:
        tool.is_action = data.is_action
    if data.requires_printer is not None:
        tool.requires_printer = data.requires_printer
    if data.enabled is not None:
        tool.enabled = data.enabled

    await db.commit()
    await db.refresh(tool)
    await refresh_custom_tools()
    return tool.to_dict()


@router.delete("/custom-tools/{tool_id}")
async def delete_custom_tool(tool_id: int, db: AsyncSession = Depends(get_db)):
    tool = (
        await db.execute(select(CustomTool).where(CustomTool.id == tool_id))
    ).scalar_one_or_none()
    if not tool:
        raise HTTPException(status_code=404, detail="Herramienta no encontrada.")
    await db.delete(tool)
    await db.commit()
    await refresh_custom_tools()
    return {"status": "ok"}
