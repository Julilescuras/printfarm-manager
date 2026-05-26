"""
Spoolman Proxy Router — Proxies requests to the local Spoolman instance.
This keeps the frontend from needing to know Spoolman's internal URL.
"""

from typing import List, Dict, Any
from fastapi import APIRouter, HTTPException

from app.services.spoolman import spoolman_client

router = APIRouter(prefix="/api/spoolman", tags=["spoolman"])


@router.get("/health")
async def spoolman_health():
    """Check if Spoolman is reachable."""
    is_healthy = await spoolman_client.health_check()
    return {
        "status": "ok" if is_healthy else "unreachable",
        "connected": is_healthy,
    }


@router.get("/spools")
async def get_spools():
    """Get all spools from Spoolman."""
    spools = await spoolman_client.get_spools()
    return spools


@router.get("/spools/{spool_id}")
async def get_spool(spool_id: int):
    """Get a single spool with enriched info."""
    spool = await spoolman_client.get_spool_info(spool_id)
    if not spool:
        raise HTTPException(status_code=404, detail="Spool not found in Spoolman")
    return spool


@router.get("/filaments")
async def get_filaments():
    """Get all filament types from Spoolman."""
    return await spoolman_client.get_filaments()


@router.get("/vendors")
async def get_vendors():
    """Get all vendors from Spoolman."""
    return await spoolman_client.get_vendors()
