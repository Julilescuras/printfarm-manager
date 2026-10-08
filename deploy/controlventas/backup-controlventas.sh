#!/usr/bin/env bash
# Respaldo nocturno de los datos de Control Ventas (pedidos, clientes, costos).
# Independiente de OneDrive. Cron sugerido (usuario del servidor):
#   0 3 * * * /home/<usuario>/printfarm-manager/deploy/controlventas/backup-controlventas.sh
set -euo pipefail
SRC="/srv/ziegel/OneDrive/3D/Diseños/dieseños 2026/.controlventas"
DST="/srv/ziegel/backups"
mkdir -p "$DST"
[ -d "$SRC" ] || { echo "No existe $SRC"; exit 1; }
tar -czf "$DST/controlventas-$(date +%F).tar.gz" --exclude=cache -C "$(dirname "$SRC")" .controlventas
find "$DST" -name 'controlventas-*.tar.gz' -mtime +30 -delete
