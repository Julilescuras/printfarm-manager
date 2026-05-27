#!/bin/bash
# PrintFarm Manager - Script de Actualización Automática
# Descarga imágenes pre-construidas desde GitHub Container Registry

echo "=========================================="
echo " Actualizando PrintFarm Manager..."
echo "=========================================="

# 1. Traer los últimos cambios de GitHub (docker-compose.yml, .env.example, etc.)
echo "[1/3] Descargando últimas actualizaciones desde GitHub..."
git pull origin main

# 2. Descargar imágenes pre-construidas (sin necesidad de compilar)
echo "[2/3] Descargando imágenes Docker pre-construidas..."
docker compose pull

# 3. Reiniciar los servicios con las nuevas imágenes
echo "[3/3] Reiniciando servicios con la nueva versión..."
docker compose up -d

echo "=========================================="
echo " ¡Actualización completada con éxito! 🎉"
echo "=========================================="
echo ""
echo " Las imágenes se descargaron ya compiladas,"
echo " sin necesidad de esperar el build local."
echo ""
