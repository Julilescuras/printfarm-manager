#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# PrintFarm Manager — Script de Instalación 1-Click
# ═══════════════════════════════════════════════════════════════
# Ejecutá este script en tu servidor Linux:
#   chmod +x install.sh && ./install.sh
# ═══════════════════════════════════════════════════════════════

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${PURPLE}"
echo "╔═══════════════════════════════════════════════╗"
echo "║       🖨️  PrintFarm Manager Installer         ║"
echo "║       Sistema de Granja de Impresión 3D       ║"
echo "╚═══════════════════════════════════════════════╝"
echo -e "${NC}"

# ─── Step 1: Check/Install Docker ────────────────────
echo -e "\n${CYAN}[1/6]${NC} Verificando Docker..."

if command -v docker &> /dev/null; then
    echo -e "  ${GREEN}✓${NC} Docker instalado: $(docker --version)"
else
    echo -e "  ${YELLOW}⚠${NC} Docker no encontrado. Instalando..."
    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker $USER
    echo -e "  ${GREEN}✓${NC} Docker instalado correctamente"
    echo -e "  ${YELLOW}⚠${NC} Se agregó tu usuario al grupo 'docker'."
    echo -e "  ${YELLOW}  Puede que necesites cerrar sesión y volver a entrar.${NC}"
fi

# ─── Step 2: Check/Install Docker Compose ────────────
echo -e "\n${CYAN}[2/6]${NC} Verificando Docker Compose..."

if docker compose version &> /dev/null; then
    echo -e "  ${GREEN}✓${NC} Docker Compose instalado: $(docker compose version --short)"
elif command -v docker-compose &> /dev/null; then
    echo -e "  ${GREEN}✓${NC} Docker Compose (legacy) instalado"
    # Create alias
    COMPOSE_CMD="docker-compose"
else
    echo -e "  ${YELLOW}⚠${NC} Docker Compose no encontrado. Instalando plugin..."
    sudo apt-get update -qq
    sudo apt-get install -y -qq docker-compose-plugin
    echo -e "  ${GREEN}✓${NC} Docker Compose instalado"
fi

# Determine compose command
if docker compose version &> /dev/null 2>&1; then
    COMPOSE_CMD="docker compose"
else
    COMPOSE_CMD="docker-compose"
fi

# ─── Step 3: Configure .env ─────────────────────────
echo -e "\n${CYAN}[3/6]${NC} Configurando variables de entorno..."

if [ ! -f .env ]; then
    cp .env.example .env
    echo -e "  ${GREEN}✓${NC} Archivo .env creado desde .env.example"
    echo ""
    echo -e "  ${BLUE}ℹ️  Las impresoras se configuran desde la interfaz web${NC}"
    echo -e "  ${BLUE}   después de la instalación (http://tu-ip:3000/printers)${NC}"
    echo ""
else
    echo -e "  ${GREEN}✓${NC} Archivo .env ya existe"
fi

# ─── Step 4: Create directories ─────────────────────
echo -e "\n${CYAN}[4/6]${NC} Creando directorios..."

mkdir -p backend/data
mkdir -p backend/gcodes
echo -e "  ${GREEN}✓${NC} backend/data/ (SQLite)"
echo -e "  ${GREEN}✓${NC} backend/gcodes/ (Archivos G-code)"

# ─── Step 5: Build images ───────────────────────────
echo -e "\n${CYAN}[5/6]${NC} Construyendo imágenes Docker (esto puede tomar unos minutos)..."
echo ""

$COMPOSE_CMD build --no-cache

echo ""
echo -e "  ${GREEN}✓${NC} Imágenes construidas correctamente"

# ─── Step 6: Start services ─────────────────────────
echo -e "\n${CYAN}[6/6]${NC} Iniciando servicios..."
echo ""

$COMPOSE_CMD up -d

echo ""
echo -e "  ${GREEN}✓${NC} Servicios iniciados"

# ─── Summary ────────────────────────────────────────
echo ""
echo -e "${GREEN}"
echo "╔═══════════════════════════════════════════════════════╗"
echo "║            🎉 ¡Instalación Completada!               ║"
echo "╠═══════════════════════════════════════════════════════╣"
echo "║                                                       ║"

# Get local IP
LOCAL_IP=$(hostname -I | awk '{print $1}')

echo "║  🌐 Frontend:   http://${LOCAL_IP}:3000              "
echo "║  🔧 Backend:    http://${LOCAL_IP}:8000              "
echo "║  🧵 Spoolman:   http://${LOCAL_IP}:7912              "
echo "║  📡 API Docs:   http://${LOCAL_IP}:8000/docs         "
echo "║                                                       ║"
echo "╠═══════════════════════════════════════════════════════╣"
echo "║  Comandos útiles:                                     ║"
echo "║  • Ver logs:     docker compose logs -f               ║"
echo "║  • Reiniciar:    docker compose restart               ║"
echo "║  • Detener:      docker compose down                  ║"
echo "║  • Actualizar:   git pull && docker compose up -d --build"
echo "║                                                       ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Show container status
echo -e "${BLUE}Estado de los contenedores:${NC}"
$COMPOSE_CMD ps
