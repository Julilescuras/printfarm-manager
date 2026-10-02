"""
Integration Router — machine-to-machine API for Control Ventas.

Every endpoint here requires ``Authorization: Bearer <integration_token>``
(see app/security.py). The token lives in app_settings and is shown /
regenerated from Configuración → "Integración con Control Ventas".
Endpoints for the G-code library, jobs and events land here in PT-1b/PT-2.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from app.security import require_integration_token
from app.version import APP_VERSION

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
