"""
Updater Service — 1-click update via Docker socket.

Strategy:
  - Pull new images using the Python docker SDK (communicates with the host
    Docker daemon via the mounted /var/run/docker.sock).
  - Recreate the frontend container immediately (we are not the frontend).
  - For the backend itself: write a flag file to the shared volume
    (/app/data/.update_requested). A host-side cron job (installed by
    install.sh) detects this file and runs update.sh, which does
    `docker compose pull && docker compose up -d` — recreating the backend
    container with the new image.
"""

import asyncio
import logging
import time
from pathlib import Path
from typing import Optional

import httpx

logger = logging.getLogger("printfarm.updater")

APP_VERSION = "1.3.0"
GITHUB_REPO = "julilescuras/printfarm-manager"
UPDATE_FLAG_FILE = Path("/app/data/.update_requested")
INSTALLED_COMMIT_FILE = Path("/app/data/installed_commit.txt")

IMAGES = {
    "frontend": "ghcr.io/julilescuras/printfarm-frontend:latest",
    "backend": "ghcr.io/julilescuras/printfarm-backend:latest",
}
CONTAINER_NAMES = {
    "frontend": "printfarm-frontend",
    "backend": "printfarm-backend",
}

_update_in_progress: bool = False
_update_log: list[str] = []


# ─── Public API ──────────────────────────────────────────────────────────────

async def check_for_updates() -> dict:
    """Query GitHub for the latest commit on main and compare with installed."""
    installed_sha = _read_installed_sha()

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"https://api.github.com/repos/{GITHUB_REPO}/commits/main",
                headers={
                    "Accept": "application/vnd.github.v3+json",
                    "User-Agent": "PrintFarm-Manager",
                },
            )
            if resp.status_code == 200:
                data = resp.json()
                latest_sha: str = data["sha"]
                commit_msg: str = data["commit"]["message"].split("\n")[0]
                commit_date: str = data["commit"]["author"]["date"]

                up_to_date: Optional[bool] = None
                if installed_sha:
                    up_to_date = installed_sha == latest_sha

                return {
                    "current_version": APP_VERSION,
                    "installed_commit": installed_sha[:7] if installed_sha else "desconocido",
                    "latest_commit": latest_sha[:7],
                    "latest_message": commit_msg,
                    "latest_date": commit_date,
                    "up_to_date": up_to_date,
                    "check_ok": True,
                }
            else:
                return _check_error(f"GitHub respondió HTTP {resp.status_code}", installed_sha)
    except Exception as exc:
        logger.warning(f"[Updater] Update check failed: {exc}")
        return _check_error(str(exc), installed_sha)


def _check_error(msg: str, installed_sha: Optional[str]) -> dict:
    return {
        "current_version": APP_VERSION,
        "installed_commit": installed_sha[:7] if installed_sha else "desconocido",
        "latest_commit": None,
        "latest_message": None,
        "latest_date": None,
        "up_to_date": None,
        "check_ok": False,
        "error": f"No se pudo verificar: {msg}",
    }


async def apply_update() -> dict:
    """Start the update process in the background. Returns immediately."""
    global _update_in_progress
    if _update_in_progress:
        return {"status": "busy", "message": "Ya hay una actualización en progreso"}

    _test_docker_socket()  # Raises if socket not accessible

    _update_in_progress = True
    _update_log.clear()
    asyncio.create_task(_update_task())
    return {
        "status": "started",
        "message": (
            "Actualización iniciada. El frontend se reiniciará en ~30s, "
            "el backend en ≤60s."
        ),
    }


def get_update_status() -> dict:
    return {
        "in_progress": _update_in_progress,
        "log": list(_update_log),
    }


# ─── Internal ────────────────────────────────────────────────────────────────

def _test_docker_socket():
    """Raise RuntimeError if the Docker socket is not accessible."""
    import docker
    try:
        client = docker.DockerClient(base_url="unix://var/run/docker.sock")
        client.ping()
    except Exception as exc:
        raise RuntimeError(
            "Socket de Docker no disponible. "
            "Verificá que /var/run/docker.sock esté montado en el contenedor."
        ) from exc


async def _update_task():
    global _update_in_progress
    try:
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _run_update_sync)
    except Exception as exc:
        logger.error(f"[Updater] Update task failed: {exc}", exc_info=True)
        _update_log.append(f"ERROR: {exc}")
    finally:
        _update_in_progress = False


def _run_update_sync():
    """Blocking update logic — runs in a thread executor."""
    import docker

    _log("Conectando con el demonio de Docker...")
    client = docker.DockerClient(base_url="unix://var/run/docker.sock")

    # ── 1. Pull all images ────────────────────────────────────────────────────
    for service, image in IMAGES.items():
        _log(f"Descargando imagen {service} desde GHCR...")
        logger.info(f"[Updater] Pulling {image}")
        try:
            client.images.pull(image)
            _log(f"✓ Imagen {service} actualizada")
        except Exception as exc:
            _log(f"✗ Error al descargar {service}: {exc}")
            raise

    # ── 2. Recreate frontend (we are not the frontend) ────────────────────────
    _log("Reiniciando contenedor frontend con nueva imagen...")
    try:
        _recreate_container(client, CONTAINER_NAMES["frontend"], IMAGES["frontend"])
        _log("✓ Frontend reiniciado correctamente")
    except Exception as exc:
        _log(f"✗ Error al reiniciar frontend: {exc}")
        raise

    # ── 3. Signal backend update via flag file ────────────────────────────────
    _log("Solicitando reinicio del backend (se aplicará en <60s)...")
    try:
        UPDATE_FLAG_FILE.parent.mkdir(parents=True, exist_ok=True)
        UPDATE_FLAG_FILE.touch()
        _log("✓ Backend marcado para reinicio. El sistema completará la actualización automáticamente.")
    except Exception as exc:
        _log(f"✗ No se pudo escribir el flag de actualización: {exc}")
        raise

    # ── 4. Record latest commit ───────────────────────────────────────────────
    _try_write_installed_sha()


def _recreate_container(client, name: str, new_image: str):
    """Stop, remove, and recreate a container preserving its full config."""
    import docker.errors

    try:
        container = client.containers.get(name)
    except docker.errors.NotFound:
        logger.warning(f"[Updater] Container '{name}' not found, skipping")
        _log(f"  ⚠ Contenedor '{name}' no encontrado, omitiendo")
        return

    attrs = container.attrs
    host_cfg = attrs.get("HostConfig", {})
    config = attrs.get("Config", {})
    networks = attrs.get("NetworkSettings", {}).get("Networks", {})
    network_names = list(networks.keys())

    env = config.get("Env") or []
    binds = host_cfg.get("Binds") or []
    port_bindings = _convert_port_bindings(host_cfg.get("PortBindings") or {})
    restart_policy = host_cfg.get("RestartPolicy") or {"Name": "unless-stopped"}
    mem_limit = host_cfg.get("Memory") or 0
    nano_cpus = host_cfg.get("NanoCpus") or 0
    labels = config.get("Labels") or {}

    # Stop + remove old container
    logger.info(f"[Updater] Stopping {name}")
    container.stop(timeout=30)
    container.remove()

    # Build kwargs for the new container
    run_kwargs: dict = {
        "image": new_image,
        "name": name,
        "detach": True,
        "environment": env,
        "restart_policy": restart_policy,
        "labels": labels,
    }
    if binds:
        run_kwargs["volumes"] = binds
    if port_bindings:
        run_kwargs["ports"] = port_bindings
    if network_names:
        run_kwargs["network"] = network_names[0]
    if mem_limit and mem_limit > 0:
        run_kwargs["mem_limit"] = mem_limit
    if nano_cpus and nano_cpus > 0:
        run_kwargs["nano_cpus"] = nano_cpus

    logger.info(f"[Updater] Creating new {name} from {new_image}")
    new_container = client.containers.run(**run_kwargs)

    # Reconnect to additional networks
    for net_name in network_names[1:]:
        try:
            net = client.networks.get(net_name)
            net.connect(new_container)
        except Exception as exc:
            logger.warning(f"[Updater] Could not connect {name} to {net_name}: {exc}")


def _convert_port_bindings(bindings: dict) -> dict:
    """Convert Docker inspect PortBindings format to containers.run() format."""
    result = {}
    for container_port, host_bindings in bindings.items():
        if host_bindings:
            host_ip = host_bindings[0].get("HostIp", "")
            host_port = host_bindings[0].get("HostPort", "")
            if host_port:
                result[container_port] = (host_ip, int(host_port)) if host_ip else int(host_port)
    return result


def _read_installed_sha() -> Optional[str]:
    try:
        return INSTALLED_COMMIT_FILE.read_text().strip() or None
    except FileNotFoundError:
        return None


def _try_write_installed_sha():
    """Fetch and persist the latest GitHub commit SHA (best-effort)."""
    try:
        resp = httpx.get(
            f"https://api.github.com/repos/{GITHUB_REPO}/commits/main",
            headers={"User-Agent": "PrintFarm-Manager"},
            timeout=5.0,
        )
        if resp.status_code == 200:
            sha = resp.json()["sha"]
            INSTALLED_COMMIT_FILE.write_text(sha)
            _log(f"✓ Versión registrada: {sha[:7]}")
    except Exception:
        pass


def _log(msg: str):
    logger.info(f"[Updater] {msg}")
    _update_log.append(msg)
