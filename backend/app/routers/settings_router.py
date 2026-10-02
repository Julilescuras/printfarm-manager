"""
Settings Router — Manage application settings (Telegram, theme, updates, etc.)
"""

from typing import Dict
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.settings import AppSettings
from app.security import (
    INTEGRATION_TOKEN_KEY,
    get_integration_token,
    regenerate_integration_token,
)
from app.services.telegram import telegram_notifier
from app.services.llm.base import ChatMessage, LLMProviderError
from app.services.llm.factory import PROVIDER_DEFAULTS, get_provider
from pydantic import BaseModel

router = APIRouter(prefix="/api/settings", tags=["settings"])


class SettingsUpdate(BaseModel):
    settings: Dict[str, str]


@router.get("")
async def get_settings(db: AsyncSession = Depends(get_db)):
    """Get all application settings.

    Includes ``integration_token`` (the LAN UI has no login yet, so whoever can
    open Configuración can see it — same trust level as the Telegram token).
    """
    result = await db.execute(select(AppSettings))
    settings = {s.key: s.value for s in result.scalars().all()}
    if not settings.get(INTEGRATION_TOKEN_KEY):
        settings[INTEGRATION_TOKEN_KEY] = await get_integration_token(db)
    return settings


@router.put("")
async def update_settings(
    data: SettingsUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update application settings."""
    for key, value in data.settings.items():
        # The integration token is only changed through its regenerate endpoint
        # (never set to an arbitrary / empty value from the generic form).
        if key == INTEGRATION_TOKEN_KEY:
            continue
        result = await db.execute(
            select(AppSettings).where(AppSettings.key == key)
        )
        setting = result.scalar_one_or_none()
        if setting:
            setting.value = value
        else:
            db.add(AppSettings(key=key, value=value))

    await db.commit()
    return {"status": "ok"}


@router.post("/integration-token/regenerate")
async def regenerate_token(db: AsyncSession = Depends(get_db)):
    """Generate a new integration token. The previous one stops working at once
    (Control Ventas must be updated with the new value)."""
    token = await regenerate_integration_token(db)
    return {"status": "ok", "integration_token": token}


@router.post("/telegram/test")
async def test_telegram():
    """Send a test message to the configured Telegram group."""
    success = await telegram_notifier.send_message(
        "🧪 <b>Mensaje de prueba</b>\n"
        "✅ PrintFarm Manager está conectado correctamente a este grupo.",
        force=True,
    )
    if success:
        return {"status": "ok", "message": "Mensaje de prueba enviado correctamente"}
    return {"status": "error", "message": "No se pudo enviar. Verificá el Bot Token y Chat ID."}


# ─── Assistant (conversational agent) Endpoints ───────────────────────────────

@router.get("/assistant/providers")
async def list_assistant_providers():
    """List the available LLM providers and their defaults, for the settings UI."""
    return {
        "providers": [
            {
                "id": pid,
                "label": meta["label"],
                "default_model": meta["model"],
                "paid": pid in ("openai", "anthropic"),
            }
            for pid, meta in PROVIDER_DEFAULTS.items()
        ]
    }


@router.post("/assistant/test")
async def test_assistant():
    """Ping the configured LLM with a minimal prompt to validate provider + key."""
    try:
        provider = await get_provider()
    except LLMProviderError as exc:
        return {"status": "error", "message": str(exc)}

    try:
        response = await provider.chat(
            [
                ChatMessage(role="system", content="Respondé únicamente con la palabra: OK"),
                ChatMessage(role="user", content="ping"),
            ],
            tools=None,
        )
    except LLMProviderError as exc:
        return {"status": "error", "message": str(exc)}

    return {
        "status": "ok",
        "message": f"Motor '{provider.name}' respondió correctamente.",
        "reply": (response.content or "").strip()[:100],
    }


# ─── System Update Endpoints ──────────────────────────────────────────────────

@router.get("/update-check")
async def check_update():
    """Query GitHub for the latest commit and compare with the installed version."""
    from app.services.updater import check_for_updates
    return await check_for_updates()


@router.post("/update-apply")
async def apply_update():
    """Pull new Docker images, recreate the frontend, and flag the backend for restart."""
    from app.services.updater import apply_update as _apply
    try:
        return await _apply()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@router.get("/update-status")
async def update_status():
    """Return the current update log and whether an update is in progress."""
    from app.services.updater import get_update_status
    return get_update_status()
