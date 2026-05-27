# 🖨️ PrintFarm Manager

Sistema centralizado de gestión para granja de impresión 3D con integración Moonraker + Spoolman.

## Características

- **Dashboard en tiempo real** — Estado de todas las impresoras vía WebSocket con temperaturas, progreso y estimaciones
- **Cola de impresión inteligente** — Despacho automático basado en compatibilidad de modelo, boquilla, material, color y verificación de filamento disponible
- **Parseo automático de G-code** — Al subir un archivo, se extraen automáticamente el tiempo estimado y el peso de filamento desde los comentarios del slicer (Cura, PrusaSlicer, OrcaSlicer, Simplify3D)
- **Drag & drop** — Reordená las prioridades de la cola arrastrando los trabajos
- **Lógica de "Cama Ocupada"** — Control de flujo con botón de vaciado
- **Inventario de filamento** — Integración con Spoolman, verificación automática de stock antes de imprimir
- **Historial de impresiones** — Registro completo con impresora, duración, material y resultado
- **Alertas de mantenimiento** — Contadores configurables por tipo de mantenimiento con reset y notificaciones
- **Notificaciones por Telegram** — Alertas automáticas de: impresión completada, cama para vaciar, errores y mantenimiento. Configuración desde la web
- **Reportes semanales** — Resumen automático enviado al grupo de Telegram con estadísticas de impresiones, horas y filamento usado
- **Modo oscuro/claro** — Toggle de tema con persistencia

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
- Construye las imágenes Docker
- Levanta todos los servicios

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

# Actualizar y reiniciar
docker compose up -d --build
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
```

## Endpoints API

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/printers` | Lista de impresoras |
| POST | `/api/printers` | Agregar impresora |
| PUT | `/api/printers/{id}` | Editar impresora |
| DELETE | `/api/printers/{id}` | Eliminar impresora |
| POST | `/api/printers/{id}/clear-bed` | Vaciar cama |
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
- **Infra:** Docker, Docker Compose
