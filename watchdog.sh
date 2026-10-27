#!/bin/bash
# PrintFarm Manager — Watchdog de actualización (ejecutado por cron cada minuto).
#
# Cuando el frontend solicita una actualización, el backend deja la banderita
# backend/data/.update_requested. Este watchdog la detecta y corre update.sh,
# que recrea el contenedor backend (el frontend ya se recreó solo).
#
# NO borra la banderita: de eso se encarga update.sh, y SOLO si tuvo éxito. Así,
# si una actualización falla, la banderita persiste y se reintenta el próximo
# minuto (update.sh tiene su propio lock anti-concurrencia).
#
# Vive en el repo (en vez de generarse en /usr/local/bin) para que `git pull`
# lo mantenga al día y el cron nunca quede apuntando a un script inexistente.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FLAG="$SCRIPT_DIR/backend/data/.update_requested"
LOG="$SCRIPT_DIR/backend/data/update.log"

RESTART_FLAG="$SCRIPT_DIR/backend/data/.restart_requested"

if [ -f "$FLAG" ]; then
    echo "$(date): actualización solicitada desde el frontend, ejecutando update.sh..." >> "$LOG"
    cd "$SCRIPT_DIR" && bash update.sh >> "$LOG" 2>&1
    echo "$(date): update.sh finalizó con código $?." >> "$LOG"
elif [ -f "$RESTART_FLAG" ]; then
    # A diferencia del update, la banderita se borra ANTES de reiniciar: si el
    # reinicio falla no queremos un loop de reinicios cada minuto.
    rm -f "$RESTART_FLAG"
    echo "$(date): reinicio total solicitado desde el frontend, ejecutando restart.sh..." >> "$LOG"
    cd "$SCRIPT_DIR" && bash restart.sh >> "$LOG" 2>&1
    echo "$(date): restart.sh finalizó con código $?." >> "$LOG"
fi
