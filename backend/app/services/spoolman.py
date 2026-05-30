"""
SpoolmanClient — HTTP client to proxy requests to the local Spoolman API.
We don't store filament data ourselves; we consume Spoolman's REST API.
"""

import logging
from typing import Optional, List, Dict, Any

import httpx

from app.config import settings

logger = logging.getLogger("printfarm.spoolman")


class SpoolmanClient:
    """Async HTTP client for Spoolman REST API (v1)."""

    def __init__(self, base_url: Optional[str] = None):
        self.base_url = (base_url or settings.spoolman_url).rstrip("/")
        self.api_url = f"{self.base_url}/api/v1"

    async def _get(self, path: str, params: dict = None) -> Optional[Any]:
        """Make a GET request to Spoolman API."""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(f"{self.api_url}{path}", params=params)
                if response.status_code == 200:
                    return response.json()
                else:
                    logger.warning(f"Spoolman GET {path} returned {response.status_code}")
                    return None
        except httpx.ConnectError:
            logger.warning("Cannot connect to Spoolman — is it running?")
            return None
        except Exception as e:
            logger.error(f"Spoolman GET {path} error: {e}")
            return None

    async def get_spools(self) -> List[Dict[str, Any]]:
        """Get all spools from Spoolman."""
        result = await self._get("/spool")
        return result if isinstance(result, list) else []

    async def get_spool(self, spool_id: int) -> Optional[Dict[str, Any]]:
        """Get a single spool by ID."""
        return await self._get(f"/spool/{spool_id}")

    async def get_filaments(self) -> List[Dict[str, Any]]:
        """Get all filament types."""
        result = await self._get("/filament")
        return result if isinstance(result, list) else []

    async def get_vendors(self) -> List[Dict[str, Any]]:
        """Get all vendors."""
        result = await self._get("/vendor")
        return result if isinstance(result, list) else []

    async def get_spool_info(self, spool_id: int) -> Optional[Dict[str, Any]]:
        """Get enriched spool info including filament and vendor details."""
        spool = await self.get_spool(spool_id)
        if not spool:
            return None

        # Spoolman usually nests filament info inside the spool object
        return {
            "id": spool.get("id"),
            "filament": spool.get("filament", {}),
            "remaining_weight": spool.get("remaining_weight"),
            "used_weight": spool.get("used_weight"),
            "first_used": spool.get("first_used"),
            "last_used": spool.get("last_used"),
            "material": spool.get("filament", {}).get("material", "Unknown"),
            "color_hex": spool.get("filament", {}).get("color_hex", ""),
            "vendor": spool.get("filament", {}).get("vendor", {}).get("name", "Unknown"),
        }

    async def use_filament(self, spool_id: int, use_length_mm: float) -> bool:
        """Deduct used filament length (in mm) from a spool in Spoolman."""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                payload = {"use_length": use_length_mm}
                response = await client.put(f"{self.api_url}/spool/{spool_id}/use", json=payload)
                if response.status_code == 200:
                    logger.info(f"Spoolman updated: used {use_length_mm:.1f}mm from spool {spool_id}")
                    return True
                else:
                    logger.warning(f"Spoolman PUT /use returned {response.status_code}: {response.text}")
                    return False
        except Exception as e:
            logger.error(f"Spoolman PUT /use error: {e}")
            return False

    async def health_check(self) -> bool:
        """Check if Spoolman is reachable."""
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{self.base_url}/api/v1/info")
                return response.status_code == 200
        except Exception:
            return False


# Singleton instance
spoolman_client = SpoolmanClient()
