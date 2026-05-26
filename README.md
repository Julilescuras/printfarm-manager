# 🖨️ PrintFarm Manager

Sistema centralizado de gestión para granja de impresión 3D con integración Moonraker + Spoolman.

## Características

- **Dashboard en tiempo real** — Estado de todas las impresoras vía WebSocket
- **Cola de impresión inteligente** — Despacho automático basado en compatibilidad
- **Lógica de "Cama Ocupada"** — Control de flujo con botón de vaciado
- **Inventario de filamento** — Integración con Spoolman
- **Alertas de mantenimiento** — Contadores configurables con reset

## Instalación Rápida (Linux)

```bash
# 1. Cloná o copiá el proyecto a tu servidor Linux
# 2. Ejecutá el instalador:
chmod +x install.sh
./install.sh
```

El script automáticamente:
- Instala Docker y Docker Compose si no están presentes
- Construye las imágenes Docker
- Levanta todos los servicios

## Acceso

| Servicio | URL | Puerto |
|----------|-----|--------|
| Frontend | `http://tu-ip:3000` | 3000 |
| Backend API | `http://tu-ip:8000` | 8000 |
| API Docs (Swagger) | `http://tu-ip:8000/docs` | 8000 |
| Spoolman | `http://tu-ip:7912` | 7912 |

## Configuración de Impresoras

A diferencia de versiones anteriores, **las impresoras ya no se configuran mediante archivos .env**. 

Una vez que el sistema esté corriendo, simplemente abre el **Frontend** (`http://tu-ip:3000`), dirígete a la pestaña de **Impresoras** y utiliza la interfaz web para añadir, editar o eliminar las máquinas de tu granja. El sistema las conectará automáticamente.

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
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Frontend   │────▶│   Backend    │────▶│  Moonraker   │
│  (Next.js)   │ WS  │  (FastAPI)   │ WS  │  (Klipper)   │
│  Port 3000   │     │  Port 8000   │     │  Port 7125+  │
└─────────────┘     └──────┬───────┘     └─────────────┘
                           │
                    ┌──────┴───────┐
                    │   Spoolman    │
                    │  Port 7912    │
                    └──────────────┘
```

## Stack Tecnológico

- **Backend:** Python 3.12, FastAPI, SQLAlchemy (async), SQLite, WebSockets
- **Frontend:** Next.js 15, React 19, Tailwind CSS, TypeScript
- **Filamento:** Spoolman (contenedor oficial)
- **Infra:** Docker, Docker Compose
