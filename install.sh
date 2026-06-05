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

# Habilitar Docker para que arranque automáticamente al bootear
if [ -d /run/systemd/system ]; then
    sudo systemctl enable docker 2>/dev/null && \
        echo -e "  ${GREEN}✓${NC} Docker habilitado en boot (systemd)" || true
elif command -v update-rc.d &> /dev/null; then
    sudo update-rc.d docker defaults 2>/dev/null && \
        echo -e "  ${GREEN}✓${NC} Docker habilitado en boot (sysvinit)" || true
fi

# Asegurarse de que el daemon esté corriendo ahora
if ! docker info &> /dev/null; then
    echo -e "  ${YELLOW}⚠${NC} Daemon de Docker no está corriendo. Iniciando..."
    sudo service docker start
    echo -e "  ${GREEN}✓${NC} Docker iniciado"
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

# ─── Step 5: Pull images from GHCR ─────────────────
echo -e "\n${CYAN}[5/7]${NC} Descargando imágenes Docker desde GHCR (2-3 min)..."
echo ""

$COMPOSE_CMD pull

echo ""
echo -e "  ${GREEN}✓${NC} Imágenes descargadas correctamente"

# ─── Step 6: Start services ─────────────────────────
echo -e "\n${CYAN}[6/7]${NC} Iniciando servicios..."
echo ""

$COMPOSE_CMD up -d

# Record initial installed commit
git rev-parse HEAD > backend/data/installed_commit.txt 2>/dev/null || true

echo ""
echo -e "  ${GREEN}✓${NC} Servicios iniciados"

# ─── Step 7: Configure update watchdog ─────────────
echo -e "\n${CYAN}[7/7]${NC} Configurando vigilante de actualizaciones automáticas..."

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
# El watchdog ahora vive en el repo (watchdog.sh), así `git pull` lo mantiene al
# día y el cron nunca queda apuntando a un script inexistente.
WATCHDOG_SCRIPT="$PROJECT_DIR/watchdog.sh"

chmod +x "$WATCHDOG_SCRIPT"

# Add or replace the crontab entry (runs every minute). Limpiamos cualquier
# entrada vieja (la histórica en /usr/local/bin y rutas previas del repo) para
# no duplicar ni dejar apuntando a un archivo que no existe.
(crontab -l 2>/dev/null | grep -v "printfarm-watchdog" | grep -v "printfarm-manager/watchdog.sh"; echo "* * * * * $WATCHDOG_SCRIPT") | crontab -

echo -e "  ${GREEN}✓${NC} Watchdog configurado en cron (cada minuto)"
echo -e "  ${BLUE}ℹ${NC}  Log de actualizaciones: $PROJECT_DIR/backend/data/update.log"

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
echo "║  • Actualizar:   ./update.sh  (o desde el frontend)"
echo "║                                                       ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Show container status
echo -e "${BLUE}Estado de los contenedores:${NC}"
$COMPOSE_CMD ps
