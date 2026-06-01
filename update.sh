#!/bin/bash
# PrintFarm Manager — Script de Actualización
# Uso manual: ./update.sh
# También lo ejecuta el watchdog del host cuando el frontend solicita una actualización.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "=========================================="
echo " Actualizando PrintFarm Manager..."
echo "=========================================="

# Eliminar el flag de actualización para no ejecutar esto dos veces
rm -f backend/data/.update_requested

# 1. Traer los últimos cambios de código
echo ""
echo "[1/3] Descargando código actualizado desde GitHub..."
git pull origin main

# 2. Descargar las imágenes pre-compiladas desde GHCR (~2-3 min, antes eran 25 min)
echo ""
echo "[2/3] Descargando imágenes Docker desde GitHub Container Registry..."
docker compose pull

# 3. Reiniciar servicios con las nuevas imágenes
echo ""
echo "[3/3] Reiniciando servicios con la nueva versión..."
docker compose up -d

# Registrar el commit instalado (usado por el endpoint /api/settings/update-check)
git rev-parse HEAD > backend/data/installed_commit.txt
echo "      Versión registrada: $(cat backend/data/installed_commit.txt | head -c 7)"

echo ""
echo "=========================================="
echo " ¡Actualización completada con éxito!"
echo "=========================================="
