"""
G-code storage helpers shared by the print queue upload and the G-code library.

- ``stream_upload_to_disk``: copies an upload in 1 MB chunks with a size cap
  (``MAX_GCODE_MB``), never holding the file in memory.
- ``save_gcode_upload``: validates extension/size of a FastAPI ``UploadFile``
  and streams it to an already-confined destination path (HTTP errors on
  failure).
- ``library_dir_for``: ``<gcodes_path>/library/<product_key_slug>/`` (created,
  realpath-confined). The purge never enters ``library/``.
"""

import asyncio
import hashlib
import os
import re
import unicodedata

from fastapi import HTTPException, UploadFile

from app.config import settings
from app.security import gcodes_root, is_within, sanitize_filename

GCODE_EXTS = (".gcode", ".gco", ".g")
LIBRARY_DIR = "library"
_COPY_CHUNK = 1024 * 1024  # 1 MB


def stream_upload_to_disk(src, dest_path: str, max_bytes: int) -> int:
    """Copy an upload's file object to ``dest_path`` in 1 MB chunks.

    Never holds the whole file in memory. Returns the number of bytes written,
    or raises ValueError (after deleting the partial file) if the upload is
    larger than ``max_bytes``.
    """
    written = 0
    try:
        src.seek(0)
    except Exception:
        pass
    try:
        with open(dest_path, "wb") as out:
            while True:
                chunk = src.read(_COPY_CHUNK)
                if not chunk:
                    break
                written += len(chunk)
                if written > max_bytes:
                    raise ValueError("too_large")
                out.write(chunk)
    except BaseException:
        try:
            os.remove(dest_path)
        except OSError:
            pass
        raise
    return written


def max_gcode_bytes() -> int:
    return max(1, settings.max_gcode_mb) * 1024 * 1024


def validated_gcode_name(upload: UploadFile) -> str:
    """Sanitized original name of an uploaded G-code (400 if not a G-code)."""
    name = sanitize_filename(upload.filename)
    if not name.lower().endswith(GCODE_EXTS):
        raise HTTPException(
            status_code=400,
            detail="El archivo debe ser un G-code (.gcode, .gco o .g)",
        )
    if upload.size is not None and upload.size > max_gcode_bytes():
        raise HTTPException(
            status_code=413,
            detail=f"El G-code supera el máximo permitido ({settings.max_gcode_mb} MB)",
        )
    return name


async def save_gcode_upload(upload: UploadFile, dest_path: str) -> None:
    """Stream ``upload`` to ``dest_path`` (413 if over MAX_GCODE_MB)."""
    try:
        await asyncio.to_thread(stream_upload_to_disk, upload.file, dest_path, max_gcode_bytes())
    except ValueError:
        raise HTTPException(
            status_code=413,
            detail=f"El G-code supera el máximo permitido ({settings.max_gcode_mb} MB)",
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error guardando el archivo: {e}")
    finally:
        await upload.close()


def product_key_slug(product_key: str) -> str:
    """Filesystem-safe, stable folder name for a CV product key.

    ``"Cortantes/Sueltos/Animales/Perro"`` → ``"cortantes-sueltos-animales-perro-1a2b3c4d"``
    (readable prefix + short sha1 of the exact key so different keys never
    collide after normalization).
    """
    raw = product_key or ""
    ascii_ = unicodedata.normalize("NFKD", raw).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_.lower()).strip("-")[:60].strip("-")
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:8]
    return f"{slug or 'producto'}-{digest}"


def library_dest_path(product_key: str, original_name: str) -> str:
    """Unique destination path inside ``library/<slug>/`` for a new upload."""
    root = gcodes_root()
    target_dir = os.path.realpath(
        os.path.join(root, LIBRARY_DIR, product_key_slug(product_key))
    )
    if not is_within(root, target_dir):
        raise HTTPException(status_code=400, detail="Ruta de destino inválida")
    os.makedirs(target_dir, exist_ok=True)

    safe_name = sanitize_filename(original_name)
    full_path = os.path.join(target_dir, safe_name)
    stem, ext = os.path.splitext(safe_name)
    counter = 1
    while os.path.exists(full_path):
        full_path = os.path.join(target_dir, f"{stem}_{counter}{ext}")
        counter += 1
    if not is_within(root, os.path.realpath(full_path)):
        raise HTTPException(status_code=400, detail="Ruta de destino inválida")
    return full_path
