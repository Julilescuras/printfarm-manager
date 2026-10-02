"""
PrintFarm Manager — Security helpers.

- Path confinement for everything that touches ``settings.gcodes_path``
  (uploads, explorer, downloads, thumbnails). Any client-supplied name or
  relative path is sanitized and then verified with ``os.path.realpath`` so a
  crafted ``../`` (or an absolute path, or a symlink) can never escape the root.
- Integration token: a random secret stored in ``app_settings`` (key
  ``integration_token``), generated on first startup. Machine-to-machine
  endpoints under ``/api/integration/*`` (Control Ventas) require it as
  ``Authorization: Bearer <token>``. The LAN UI itself still has no login
  (that is out of scope for now).
"""

import hmac
import os
import re
import secrets
from typing import Optional

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db

# ─── Path safety ─────────────────────────────────────────────────────────────

_UNSAFE_NAME_CHARS = re.compile(r"[^\w.\- ]", re.UNICODE)
_SAFE_MATERIAL = re.compile(r"[^A-Z0-9]")


def gcodes_root() -> str:
    """Canonical absolute path of the G-code storage root."""
    return os.path.realpath(settings.gcodes_path)


def is_within(root: str, target: str) -> bool:
    """True if ``target`` (already realpath'd) is ``root`` or lives under it."""
    root_n = os.path.normcase(root)
    target_n = os.path.normcase(target)
    return target_n == root_n or target_n.startswith(root_n.rstrip(os.sep) + os.sep)


def resolve_within_gcodes(rel_path: str) -> Optional[str]:
    """Resolve a client-supplied relative path inside gcodes_path.

    Returns the canonical absolute path, or None if it escapes the root.
    Empty / "." / "/" map to the root itself.
    """
    root = gcodes_root()
    cleaned = (rel_path or "").strip().lstrip("/\\")
    target = os.path.realpath(os.path.join(root, cleaned))
    return target if is_within(root, target) else None


def sanitize_filename(name: Optional[str], default: str = "archivo.gcode") -> str:
    """Reduce a client-supplied filename to a safe single path component.

    Takes the basename (handling both / and \\), replaces anything outside
    ``[\\w.\\- ]`` with ``_``, collapses whitespace and strips leading dots/spaces
    (no hidden files, no ``..``) and trailing dots/spaces (Windows).
    """
    raw = (name or "").replace("\\", "/")
    base = raw.rsplit("/", 1)[-1]
    base = _UNSAFE_NAME_CHARS.sub("_", base)
    base = re.sub(r"\s+", " ", base).strip()
    base = base.lstrip(". ").rstrip(". ")
    if not base:
        return default
    # Keep names reasonably short (filesystems cap at 255 bytes).
    if len(base) > 180:
        stem, ext = os.path.splitext(base)
        base = stem[: 180 - len(ext)] + ext
    return base


def sanitize_material(material: Optional[str]) -> str:
    """Material folder name: uppercase alphanumerics only (e.g. 'PLA', 'PETG')."""
    cleaned = _SAFE_MATERIAL.sub("", (material or "").upper())[:20]
    return cleaned or "OTHER"


# ─── Integration token ───────────────────────────────────────────────────────

INTEGRATION_TOKEN_KEY = "integration_token"


def new_integration_token() -> str:
    return secrets.token_urlsafe(32)


async def get_integration_token(db: AsyncSession) -> str:
    """Return the stored integration token, creating it if missing."""
    from app.models.settings import AppSettings

    result = await db.execute(
        select(AppSettings).where(AppSettings.key == INTEGRATION_TOKEN_KEY)
    )
    row = result.scalar_one_or_none()
    if row and row.value:
        return row.value
    token = new_integration_token()
    if row:
        row.value = token
    else:
        db.add(AppSettings(key=INTEGRATION_TOKEN_KEY, value=token))
    await db.commit()
    return token


async def regenerate_integration_token(db: AsyncSession) -> str:
    """Replace the integration token with a fresh one (old one stops working)."""
    from app.models.settings import AppSettings

    token = new_integration_token()
    result = await db.execute(
        select(AppSettings).where(AppSettings.key == INTEGRATION_TOKEN_KEY)
    )
    row = result.scalar_one_or_none()
    if row:
        row.value = token
    else:
        db.add(AppSettings(key=INTEGRATION_TOKEN_KEY, value=token))
    await db.commit()
    return token


async def require_integration_token(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> None:
    """FastAPI dependency: require ``Authorization: Bearer <integration_token>``."""
    header = request.headers.get("authorization") or ""
    scheme, _, supplied = header.partition(" ")
    if scheme.lower() != "bearer" or not supplied.strip():
        raise HTTPException(
            status_code=401,
            detail="Falta el token de integración",
            headers={"WWW-Authenticate": "Bearer"},
        )
    expected = await get_integration_token(db)
    if not hmac.compare_digest(supplied.strip().encode(), expected.encode()):
        raise HTTPException(
            status_code=401,
            detail="Token de integración inválido",
            headers={"WWW-Authenticate": "Bearer"},
        )
