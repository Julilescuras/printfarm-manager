#!/bin/bash
# PrintFarm Manager — Reinicio total del stack ("Zona peligrosa" en Configuración).
# Uso manual: ./restart.sh
# También lo ejecuta el watchdog del host cuando el frontend pide un reinicio total.
#
# Es un reinicio PESADO: no es `docker compose restart`, sino bajar todo
# (`down`: contenedores + red del proyecto) y recrearlo desde cero
# (`up --force-recreate`). Sirve para destrabar contenedores colgados, la red
# interna de Docker o conexiones zombis.
#
# NO toca:
#   - Tailscale ni nada del host (vive fuera de Docker) → el acceso remoto sigue.
#   - Los datos: base SQLite, G-codes y el volumen de Spoolman se conservan
#     (`down` sin `-v`).
#   - Las imágenes: no descarga versiones nuevas (para eso está update.sh).
#
# NOTA: a propósito NO usamos `set -e`, para que un paso no-crítico no aborte todo.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

DATA_DIR="$SCRIPT_DIR/backend/data"
LOCK_FILE="$DATA_DIR/.update_lock"   # el mismo lock que update.sh: nunca se pisan

mkdir -p "$DATA_DIR"

# ── Anti-concurrencia ────────────────────────────────────────────────────────
if [ -f "$LOCK_FILE" ]; then
    if [ -n "$(find "$LOCK_FILE" -mmin +15 2>/dev/null)" ]; then
        echo "Lock viejo (>15 min) detectado, se asume colgado y se continúa."
    else
        echo "Hay una actualización o reinicio en curso (lock presente). Saliendo."
        exit 0
    fi
fi
touch "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT   # Limpiar el lock pase lo que pase

echo "=========================================="
echo " Reinicio total de PrintFarm Manager..."
echo "=========================================="

# ── 1. Bajar todo ────────────────────────────────────────────────────────────
# Si `down` falla igual seguimos: el `up --force-recreate` recrea lo que quede.
echo ""
echo "[1/2] Deteniendo y eliminando todos los contenedores..."
if timeout 180 docker compose down --remove-orphans --timeout 30; then
    echo "      ✓ Stack detenido"
else
    echo "      ⚠ 'docker compose down' falló o tardó >3 min — se intenta recrear igual"
fi

# ── 2. Levantar todo desde cero (PASO CRÍTICO) ──────────────────────────────
# Primero el Manager (crítico); después los opcionales (Control Ventas, OneDrive),
# así un fallo de esos nunca deja al Manager caído.
echo ""
echo "[2/2] Recreando servicios..."
if docker compose up -d --force-recreate backend frontend spoolman; then
    echo "      ✓ Manager recreado"
    if ! docker compose up -d --force-recreate; then
        echo "      ⚠ Los servicios opcionales (Control Ventas/OneDrive) no arrancaron — el Manager sigue OK"
    fi
    echo ""
    echo "=========================================="
    echo " ¡Reinicio total completado!"
    echo "=========================================="
    exit 0
else
    echo "      ✗ 'docker compose up -d' falló."
    exit 1
fi
