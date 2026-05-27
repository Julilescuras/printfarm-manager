#!/bin/bash
# PrintFarm Manager - Script de Actualización Automática

echo "=========================================="
echo " Actualizando PrintFarm Manager..."
echo "=========================================="

# 1. Traer los últimos cambios de GitHub
echo "[1/3] Descargando últimas actualizaciones desde GitHub..."
git pull origin main

# 2. Reconstruir imágenes
echo "[2/3] Reconstruyendo contenedores de Docker..."
docker compose build

# 3. Reiniciar los servicios
echo "[3/3] Reiniciando servicios con la nueva versión..."
docker compose up -d

echo "=========================================="
echo " ¡Actualización completada con éxito! 🎉"
echo "=========================================="
