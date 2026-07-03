"""
Files Router — browse, search and download the G-codes the manager stores.

All file access is confined to ``settings.gcodes_path``. Every path coming from
the client is resolved with ``os.path.realpath`` and rejected (HTTP 400) if it
escapes that root, so a crafted ``../`` can never read arbitrary files.
"""

import os
import asyncio
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.print_job import PrintJob, PrintHistory
from app.services.gcode_thumbnail import extract_gcode_thumbnail

router = APIRouter(prefix="/api/files", tags=["files"])

# Extensions we treat as G-code files in the explorer.
_GCODE_EXTS = (".gcode", ".gco", ".g")
# Cap search results so a huge library can't produce an unbounded response.
_SEARCH_LIMIT = 300


# ─── Schemas ─────────────────────────────────────────────────────────────────

class FileNode(BaseModel):
    name: str
    path: str            # relative to gcodes_path, POSIX-style
    size_bytes: int
    modified_at: datetime


class FolderNode(BaseModel):
    name: str
    path: str            # relative to gcodes_path, POSIX-style
    file_count: int


class Breadcrumb(BaseModel):
    name: str
    path: str


class BrowseResult(BaseModel):
    path: str
    breadcrumb: List[Breadcrumb]
    folders: List[FolderNode]
    files: List[FileNode]


class SearchResult(BaseModel):
    files: List[FileNode]


# ─── Path safety ─────────────────────────────────────────────────────────────

def _root() -> str:
    return os.path.realpath(settings.gcodes_path)


def _resolve_within_root(rel_path: str) -> str:
    """Resolve a client-supplied relative path inside gcodes_path.

    Raises HTTP 400 if the resolved path escapes the root (path traversal).
    Empty / "." / "/" all map to the root itself.
    """
    root = _root()
    cleaned = (rel_path or "").strip().lstrip("/\\")
    target = os.path.realpath(os.path.join(root, cleaned))
    if target != root and not target.startswith(root + os.sep):
        raise HTTPException(status_code=400, detail="Ruta inválida")
    return target


def _to_rel(abs_path: str) -> str:
    """Path relative to the root, POSIX-style (forward slashes)."""
    rel = os.path.relpath(abs_path, _root())
    if rel == ".":
        return ""
    return rel.replace(os.sep, "/")


def _is_gcode(name: str) -> bool:
    return name.lower().endswith(_GCODE_EXTS)


def _count_gcodes_recursive(dir_path: str, cap: int = 9999) -> int:
    """Count G-code files under a folder (recursively), stopping at ``cap``.

    Month folders hold their files one level down (under material subfolders),
    so a recursive count is what makes the folder chip meaningful. The cap keeps
    it cheap on a pathologically large tree.
    """
    total = 0
    for _dirpath, dirnames, filenames in os.walk(dir_path):
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        for name in filenames:
            if _is_gcode(name):
                total += 1
                if total >= cap:
                    return total
    return total


def _file_node(abs_path: str) -> FileNode:
    st = os.stat(abs_path)
    return FileNode(
        name=os.path.basename(abs_path),
        path=_to_rel(abs_path),
        size_bytes=st.st_size,
        modified_at=datetime.fromtimestamp(st.st_mtime, tz=timezone.utc),
    )


# ─── Endpoints ───────────────────────────────────────────────────────────────

@router.get("/browse", response_model=BrowseResult)
async def browse_files(path: str = Query(default="")):
    """List the folders and G-code files directly inside ``path``."""
    target = _resolve_within_root(path)
    if not os.path.isdir(target):
        raise HTTPException(status_code=404, detail="Carpeta no encontrada")

    folders: List[FolderNode] = []
    files: List[FileNode] = []

    try:
        entries = list(os.scandir(target))
    except OSError:
        raise HTTPException(status_code=500, detail="No se pudo leer la carpeta")

    for entry in entries:
        if entry.name.startswith("."):
            continue
        if entry.is_dir(follow_symlinks=False):
            # Count G-code files under the folder (recursively) so month folders,
            # whose files live one level down under material subfolders, show a
            # meaningful total on the chip.
            try:
                count = _count_gcodes_recursive(entry.path)
            except OSError:
                count = 0
            folders.append(FolderNode(name=entry.name, path=_to_rel(entry.path), file_count=count))
        elif entry.is_file(follow_symlinks=False) and _is_gcode(entry.name):
            files.append(_file_node(entry.path))

    folders.sort(key=lambda f: f.name.lower())
    files.sort(key=lambda f: f.modified_at, reverse=True)

    # Breadcrumb: root + each segment of the current relative path.
    rel = _to_rel(target)
    breadcrumb: List[Breadcrumb] = [Breadcrumb(name="G-codes", path="")]
    if rel:
        acc = ""
        for seg in rel.split("/"):
            acc = f"{acc}/{seg}" if acc else seg
            breadcrumb.append(Breadcrumb(name=seg, path=acc))

    return BrowseResult(path=rel, breadcrumb=breadcrumb, folders=folders, files=files)


@router.get("/search", response_model=SearchResult)
async def search_files(q: str = Query(..., min_length=1)):
    """Search G-code files by name (case-insensitive substring) across the tree."""
    root = _root()
    needle = q.strip().lower()
    if not needle:
        return SearchResult(files=[])

    def _walk() -> List[FileNode]:
        found: List[FileNode] = []
        for dirpath, dirnames, filenames in os.walk(root):
            # Skip hidden dirs
            dirnames[:] = [d for d in dirnames if not d.startswith(".")]
            for name in filenames:
                if _is_gcode(name) and needle in name.lower():
                    found.append(_file_node(os.path.join(dirpath, name)))
                    if len(found) >= _SEARCH_LIMIT:
                        return found
        return found

    files = await asyncio.to_thread(_walk)
    files.sort(key=lambda f: f.modified_at, reverse=True)
    return SearchResult(files=files)


@router.get("/download")
async def download_file(path: str = Query(...)):
    """Download a stored G-code as an attachment."""
    target = _resolve_within_root(path)
    if not os.path.isfile(target) or not _is_gcode(os.path.basename(target)):
        raise HTTPException(status_code=404, detail="Archivo no encontrado")
    return FileResponse(
        target,
        media_type="text/plain; charset=utf-8",
        filename=os.path.basename(target),
    )


@router.get("/thumbnail")
async def file_thumbnail(path: str = Query(...)):
    """Serve the embedded preview of a stored G-code (204 if it has none)."""
    target = _resolve_within_root(path)
    if not os.path.isfile(target):
        raise HTTPException(status_code=404, detail="Archivo no encontrado")

    img = await asyncio.to_thread(extract_gcode_thumbnail, target)
    if not img:
        return Response(status_code=204)

    media_type = "image/jpeg" if img[:2] == b"\xff\xd8" else "image/png"
    return Response(
        content=img,
        media_type=media_type,
        headers={"Cache-Control": "public, max-age=3600"},
    )


# ─── History-scoped file access (for the job detail panel) ───────────────────

async def _resolve_history_file(history_id: int, db: AsyncSession) -> Optional[str]:
    """Locate the stored G-code for a history entry, or None if unavailable.

    Prefers the snapshotted ``gcode_path``; falls back to the linked PrintJob's
    path for entries created before the snapshot existed. Confined to the root
    and only returned if the file actually exists on disk.
    """
    result = await db.execute(select(PrintHistory).where(PrintHistory.id == history_id))
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(status_code=404, detail="Registro de historial no encontrado")

    candidate = entry.gcode_path
    if not candidate and entry.print_job_id:
        result = await db.execute(select(PrintJob).where(PrintJob.id == entry.print_job_id))
        job = result.scalar_one_or_none()
        if job:
            candidate = job.gcode_filename

    if not candidate:
        return None

    resolved = os.path.realpath(candidate)
    root = _root()
    if resolved != root and not resolved.startswith(root + os.sep):
        return None
    if not os.path.isfile(resolved):
        return None
    return resolved


@router.get("/history/{history_id}/download")
async def download_history_file(history_id: int, db: AsyncSession = Depends(get_db)):
    """Download the G-code of a history entry (404 if the file is gone)."""
    target = await _resolve_history_file(history_id, db)
    if not target:
        raise HTTPException(status_code=404, detail="El archivo ya no está en disco")
    return FileResponse(
        target,
        media_type="text/plain; charset=utf-8",
        filename=os.path.basename(target),
    )


@router.get("/history/{history_id}/thumbnail")
async def history_thumbnail(history_id: int, db: AsyncSession = Depends(get_db)):
    """Serve the embedded preview of a history entry's G-code (204 if none)."""
    target = await _resolve_history_file(history_id, db)
    if not target:
        return Response(status_code=204)

    img = await asyncio.to_thread(extract_gcode_thumbnail, target)
    if not img:
        return Response(status_code=204)

    media_type = "image/jpeg" if img[:2] == b"\xff\xd8" else "image/png"
    return Response(
        content=img,
        media_type=media_type,
        headers={"Cache-Control": "public, max-age=3600"},
    )
