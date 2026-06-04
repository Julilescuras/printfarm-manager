# PrintFarm Manager — Contexto para Claude

## El proyecto
Orquestador de granja de impresión 3D. Monorepo con:
- **Backend:** FastAPI + Python + SQLite (aiosqlite) en `backend/`
- **Frontend:** Next.js 15 + TypeScript + Tailwind en `frontend/`
- **Infra:** Docker Compose, GitHub Actions → GHCR, servidor AntiX Linux

## Servidor de producción
- **IP local:** `192.168.0.169` (también accesible por Tailscale en `100.73.163.62`)
- **Usuario SSH:** `ziegelimpresoras3D` 
- **Directorio:** `/home/ziegelimpresoras3D/printfarm-manager`
- **Acceso SSH programático:** usar `paramiko` (ya instalado en el proyecto), ver `scripts/update_server.py` como referencia

## Versión actual: 1.5.0

### Dónde vive la versión — tocar SOLO este archivo al hacer bump:
1. `backend/app/version.py` → `APP_VERSION = "X.Y.Z"` ← fuente de verdad única

El sidebar del frontend lee la versión desde `/api/status` (backend), no desde `package.json`. No tocar `package.json` para bumps de versión.

### Convención de versioning (semver)
- **X**.y.z → features grandes / funcionalidad nueva importante
- x.**Y**.z → cambios de UI, mejoras medianas
- x.y.**Z** → bugs, fixes, seguridad, errores de funcionamiento

`main.py`, `updater.py` y `moonraker.py` importan `APP_VERSION` desde `version.py`. No tocar la versión en esos archivos directamente.

## Flujo de deploy
```
git push origin main
→ GitHub Actions buildea imágenes (~3 min) → publica en GHCR (paquetes públicos)
→ Botón "Actualizar ahora" en /settings del frontend
  O: SSH → cd ~/printfarm-manager && bash update.sh
```

`update.sh` hace: `git pull` → `docker compose pull` → `docker compose up -d` → escribe SHA en `backend/data/installed_commit.txt`

## Arquitectura del 1-click update
- El contenedor backend tiene `/var/run/docker.sock` montado → Python docker SDK habla con el daemon del host
- `POST /api/settings/update-apply` → descarga imágenes, recrea el contenedor **frontend** inmediatamente, escribe flag `/app/data/.update_requested`
- Host cron (`* * * * *`) ejecuta `watchdog.sh` → detecta el flag → corre `update.sh` → recrea el **backend** con la nueva imagen
- Esto resuelve que el proceso no puede matarse a sí mismo

## Migraciones de base de datos
No hay Alembic en uso. Las migraciones son bloques `try/except` en `backend/app/database.py` → función `init_db()`, lista `migrations`. Cuando agregues una columna nueva, añadila ahí:
```python
("nombre_tabla", "nombre_columna", "TIPO SQL DEFAULT x"),
```

## Estructura de archivos clave
```
backend/app/
  version.py          ← versión única del backend
  main.py             ← FastAPI app, lifespan, /health, /api/status
  config.py           ← settings desde .env (pydantic-settings)
  database.py         ← init_db() con migraciones inline
  models/             ← ORM SQLAlchemy (printer.py, print_job.py, etc.)
  schemas/            ← Pydantic schemas (request/response)
  routers/            ← endpoints por dominio
  services/
    moonraker.py      ← WebSocket client por impresora + filament tracking
    updater.py        ← lógica de auto-update (Docker SDK)
    spoolman.py       ← cliente HTTP a Spoolman
    telegram.py       ← notificaciones
    dispatcher.py     ← despacho automático de trabajos
    monitor.py        ← alertas de mantenimiento

frontend/src/
  app/                ← páginas Next.js (App Router)
  components/layout/sidebar.tsx  ← lee versión desde /api/status dinámicamente
  lib/
    api.ts            ← cliente HTTP centralizado (apiFetch)
    types.ts          ← interfaces TypeScript
  providers/
    websocket-provider.tsx  ← estado global via WebSocket
```

## Convenciones importantes
- **No usar Alembic** — migraciones inline en `database.py`
- **Impresoras:** tienen `filament_tracking_mode` (`"manager"` | `"moonraker"`) para evitar doble descuento con Spoolman nativo
- **WebSocket hub:** `ws/hub.py` — el frontend recibe actualizaciones en tiempo real, no hacer polling
- **Estados de impresora:** `printing | standby | requires_clearance | available | paused | error | offline`
- **GHCR:** los paquetes `printfarm-backend` y `printfarm-frontend` son **públicos** — no se necesita autenticación para pull

## Scripts útiles
```bash
scripts/update_server.py   # deploy remoto vía SSH con paramiko
scripts/get_logs.py        # bajar logs del servidor
update.sh                  # actualización completa (git pull + docker pull + up)
install.sh                 # instalación desde cero (incluye cron watchdog)
```

## GHCR images
- `ghcr.io/julilescuras/printfarm-backend:latest`
- `ghcr.io/julilescuras/printfarm-frontend:latest`
