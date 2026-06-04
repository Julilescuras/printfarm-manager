#!/bin/bash
# PrintFarm Manager — Script de Actualización
# Uso manual: ./update.sh
# También lo ejecuta el watchdog del host cuando el frontend solicita una actualización.
#
# DISEÑO ROBUSTO:
#   El código real corre desde las imágenes de GHCR, NO desde el working tree de
#   git. Por eso la recreación de contenedores (`docker compose up -d`) es el paso
#   CRÍTICO y se ejecuta SIEMPRE, aunque fallen pasos previos como `git pull`.
#   Un fallo de git (árbol sucio, remoto inaccesible, etc.) nunca debe impedir que
#   el backend se actualice.
#
# NOTA: a propósito NO usamos `set -e`, para que un paso no-crítico no aborte todo.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

DATA_DIR="$SCRIPT_DIR/backend/data"
FLAG_FILE="$DATA_DIR/.update_requested"
LOCK_FILE="$DATA_DIR/.update_lock"

mkdir -p "$DATA_DIR"

# ── Anti-concurrencia ────────────────────────────────────────────────────────
# El watchdog corre cada minuto; evitamos solapar dos updates simultáneos.
if [ -f "$LOCK_FILE" ]; then
    if [ -n "$(find "$LOCK_FILE" -mmin +15 2>/dev/null)" ]; then
        echo "Lock viejo (>15 min) detectado, se asume colgado y se continúa."
    else
        echo "Ya hay una actualización en curso (lock presente). Saliendo."
        exit 0
    fi
fi
touch "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT   # Limpiar el lock pase lo que pase

echo "=========================================="
echo " Actualizando PrintFarm Manager..."
echo "=========================================="

# ── 1. Sincronizar código (NO crítico) ───────────────────────────────────────
# Solo sirve para tener docker-compose.yml y estos scripts al día. Si falla,
# seguimos igual: la imagen ya trae el código de la app.
echo ""
echo "[1/3] Descargando código actualizado desde GitHub..."
if git pull origin main; then
    echo "      ✓ Código actualizado"
else
    echo "      ⚠ 'git pull' falló — se continúa con la imagen disponible"
fi

# ── 2. Bajar imágenes desde GHCR (NO crítico) ─────────────────────────────────
# Puede que el frontend ya las haya bajado vía el SDK de Docker.
# timeout 300s: docker pull puede quedarse colgado indefinidamente sin red.
echo ""
echo "[2/3] Descargando imágenes Docker desde GitHub Container Registry..."
if ! timeout 300 docker compose pull; then
    echo "      ⚠ 'docker compose pull' falló o tardó >5 min — se intenta recrear con la caché local"
fi

# ── 3. Recrear servicios (PASO CRÍTICO) ───────────────────────────────────────
echo ""
echo "[3/3] Reiniciando servicios con la nueva versión..."
if docker compose up -d; then
    echo "      ✓ Servicios recreados"

    # Recién acá la actualización se considera exitosa: borramos la banderita
    # para que el watchdog no reintente.
    rm -f "$FLAG_FILE"

    # Registrar el commit instalado (best-effort, usado por /api/settings/update-check)
    if git rev-parse HEAD > "$DATA_DIR/installed_commit.txt" 2>/dev/null; then
        echo "      Versión registrada: $(head -c 7 "$DATA_DIR/installed_commit.txt")"
    fi

    echo ""
    echo "=========================================="
    echo " ¡Actualización completada con éxito!"
    echo "=========================================="
    exit 0
else
    echo "      ✗ 'docker compose up -d' falló."
    echo "        Se CONSERVA la banderita para reintentar en el próximo ciclo del watchdog."
    exit 1
fi
