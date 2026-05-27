# 🖨️ PrintFarm Manager v1.1.1

Sistema centralizado de gestión para granja de impresión 3D con integración Moonraker + Spoolman.

## Características

- **Dashboard en tiempo real** — Estado de todas las impresoras vía WebSocket con temperaturas, progreso y estimaciones
- **Cola de impresión inteligente** — Despacho automático basado en compatibilidad de modelo, boquilla, material, color y verificación de filamento disponible
- **Asignación automática** — Al conectarse una impresora o vaciarse la cama, el sistema busca y envía el siguiente trabajo compatible automáticamente
- **Control manual de estados** — Cambiá el estado de cada impresora desde la interfaz: Disponible, En Espera o En Pausa (no recibe trabajos)
- **Parseo automático de G-code** — Al subir un archivo, se extraen automáticamente el tiempo estimado y el peso de filamento desde los comentarios del slicer (Cura, PrusaSlicer, OrcaSlicer, Simplify3D)
- **Drag & drop** — Reordená las prioridades de la cola arrastrando los trabajos
- **Lógica de "Cama Ocupada"** — Control de flujo con botón de vaciado
- **Inventario de filamento** — Integración con Spoolman, verificación automática de stock antes de imprimir
- **Historial de impresiones** — Registro completo con impresora, duración, material y resultado
- **Alertas de mantenimiento** — Contadores configurables por tipo de mantenimiento con reset y notificaciones
- **Notificaciones por Telegram** — Alertas automáticas de: impresión completada, cama para vaciar, errores y mantenimiento. Configuración desde la web
- **Reportes semanales** — Resumen automático enviado al grupo de Telegram con estadísticas de impresiones, horas y filamento usado
- **Modo oscuro/claro** — Toggle de tema con persistencia
- **CI/CD con GitHub Actions** — Las imágenes Docker se construyen automáticamente en GitHub y se descargan pre-compiladas en el servidor

## Instalación Rápida (Linux)

```bash
# 1. Cloná el repositorio
git clone https://github.com/Julilescuras/printfarm-manager.git
cd printfarm-manager

# 2. Ejecutá el instalador:
chmod +x install.sh
./install.sh
```

El script automáticamente:
- Instala Docker y Docker Compose si no están presentes
- Copia `.env.example` a `.env`
- Descarga las imágenes Docker pre-construidas desde GitHub Container Registry
- Levanta todos los servicios

> 💡 **Nota:** Las imágenes se descargan ya compiladas, no se construyen localmente. Esto hace que la instalación sea mucho más rápida (~1 minuto vs ~15 minutos).

## Actualización

```bash
cd printfarm-manager

# Ejecutá el script de actualización
chmod +x update.sh   # (solo la primera vez)
./update.sh
```

El script descarga los últimos cambios de GitHub, baja las imágenes Docker pre-compiladas y reinicia los servicios. **No necesita compilar nada localmente.**

## Acceso

| Servicio | URL | Puerto |
|----------|-----|--------|
| Frontend | `http://tu-ip:3000` | 3000 |
| Backend API | `http://tu-ip:8000` | 8000 |
| API Docs (Swagger) | `http://tu-ip:8000/docs` | 8000 |
| Spoolman | `http://tu-ip:7912` | 7912 |

## Configuración

### Impresoras

Las impresoras se configuran directamente desde la **interfaz web**. Abrí el frontend (`http://tu-ip:3000`), andá a la pestaña **Impresoras** y usá el formulario para agregar, editar o eliminar máquinas. El sistema se conecta automáticamente a Moonraker.

### Estados de Impresora

Desde la pantalla de detalle de cada impresora podés cambiar su estado manualmente:

| Estado | Descripción |
|--------|-------------|
| **Disponible** | Recibe trabajos automáticamente de la cola |
| **En Espera** | Recibe trabajos automáticamente de la cola |
| **En Pausa** | ⏸ No recibe trabajos automáticamente. Útil para mantenimiento o cuando no querés que imprima |
| **Cama Ocupada** | Se activa automáticamente al terminar una impresión. Requiere vaciar la cama para continuar |

### Notificaciones de Telegram

Desde la pestaña **Configuración** en el menú lateral podés:
1. Crear un bot con [@BotFather](https://t.me/BotFather) en Telegram
2. Crear un grupo e invitar al bot
3. Obtener el Chat ID del grupo con [@RawDataBot](https://t.me/RawDataBot)
4. Pegar el token y chat ID en la configuración
5. Probar con el botón "Enviar prueba"

### Tema oscuro/claro

Desde **Configuración > Apariencia** podés alternar entre modo oscuro y claro.

## Comandos Útiles

```bash
# Ver logs en tiempo real
docker compose logs -f

# Reiniciar todo
docker compose restart

# Reiniciar solo el backend
docker compose restart backend

# Detener todo
docker compose down

# Actualizar a la última versión
./update.sh
```

## Arquitectura

```
┌─────────────┐     ┌─────────────────┐     ┌─────────────┐
│   Frontend   │────▶│     Backend      │────▶│  Moonraker   │
│  (Next.js)   │ WS  │    (FastAPI)     │ WS  │  (Klipper)   │
│  Port 3000   │     │    Port 8000     │     │  Port 7125+  │
└─────────────┘     └───────┬─────────┘     └─────────────┘
                            │
                    ┌───────┼───────┐
                    │       │       │
              ┌─────┴──┐ ┌─┴────┐ ┌┴────────┐
              │Spoolman │ │SQLite│ │Telegram  │
              │Port 7912│ │  DB  │ │Bot API   │
              └────────┘ └──────┘ └──────────┘

┌──────────────────────────────────────────────┐
│          GitHub Actions (CI/CD)               │
│  Build Docker Images → Push to ghcr.io       │
│  Trigger: push to main / tags v*             │
└──────────────────────────────────────────────┘
```

## Endpoints API

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/printers` | Lista de impresoras |
| POST | `/api/printers` | Agregar impresora |
| PUT | `/api/printers/{id}` | Editar impresora |
| DELETE | `/api/printers/{id}` | Eliminar impresora |
| POST | `/api/printers/{id}/clear-bed` | Vaciar cama |
| PUT | `/api/printers/{id}/status` | Cambiar estado (paused/available/standby) |
| PUT | `/api/printers/{id}/spool` | Asignar spool |
| POST | `/api/printers/{id}/dispatch` | Forzar despacho manual |
| GET | `/api/queue` | Cola de impresión |
| POST | `/api/queue` | Agregar trabajo (multipart con G-code) |
| PUT | `/api/queue/reorder` | Reordenar prioridades |
| GET | `/api/queue/history` | Historial de impresiones |
| DELETE | `/api/queue/{id}` | Cancelar trabajo |
| GET | `/api/maintenance` | Registros de mantenimiento |
| POST | `/api/maintenance/{id}/reset` | Reset de contador |
| GET | `/api/settings` | Configuración del sistema |
| PUT | `/api/settings` | Actualizar configuración |
| POST | `/api/settings/telegram/test` | Probar Telegram |
| GET | `/api/spoolman/spools` | Spools de Spoolman |
| GET | `/api/status` | Estado general del sistema |
| GET | `/health` | Health check |

## Stack Tecnológico

- **Backend:** Python 3.12, FastAPI, SQLAlchemy (async), SQLite, WebSockets
- **Frontend:** Next.js 15, React 19, Tailwind CSS, TypeScript
- **Filamento:** Spoolman (contenedor oficial)
- **Notificaciones:** Telegram Bot API
- **Infra:** Docker, Docker Compose, GitHub Actions, GitHub Container Registry
