"""
PrintFarm Manager — FastAPI Application Entry Point

This is the main application that ties everything together:
- Registers all API routers
- Sets up WebSocket endpoint for frontend
- Connects to all Moonraker instances on startup
- Initializes the database
- Starts the maintenance monitor
"""

import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select

from app.config import settings
from app.version import APP_VERSION
from app.database import init_db, async_session
from app.models.printer import Printer
from app.models.maintenance import MaintenanceRecord
from app.routers import printers, print_queue, maintenance, spoolman
from app.routers import settings_router
from app.routers import assistant_tools_router
from app.services.moonraker import moonraker_manager
from app.services.monitor import monitor
from app.services.reporter import weekly_reporter
from app.services.dispatcher import dispatcher
from app.services.assistant.listener import telegram_listener
from app.ws.hub import ws_hub

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("printfarm")


async def _seed_printers_from_config():
    """
    On first run, seed the database with printers from .env config.
    Existing printers (matched by moonraker_url) are skipped.
    """
    printer_configs = settings.printers

    if not printer_configs:
        logger.info("No printers configured in PRINTERS_CONFIG env var")
        return

    async with async_session() as session:
        # Check if database already has printers
        result = await session.execute(select(Printer).limit(1))
        existing = result.scalar_one_or_none()
        
        if existing:
            logger.info("Database already contains printers. Skipping PRINTERS_CONFIG seed.")
            return

        for pc in printer_configs:
            printer = Printer(
                name=pc.name,
                model=pc.model,
                moonraker_url=pc.url,
                nozzle_size=pc.nozzle,
                extruder_type=pc.extruder_type,
                fluidd_url=pc.fluidd_url,
                status="offline",
            )
            session.add(printer)
            logger.info(f"Seeded printer: {pc.name} ({pc.url}) [{pc.extruder_type}]")

        await session.commit()

    # Also seed default maintenance records for new printers
    async with async_session() as session:
        result = await session.execute(select(Printer))
        all_printers = result.scalars().all()

        for printer in all_printers:
            # Check if maintenance records exist
            result = await session.execute(
                select(MaintenanceRecord).where(
                    MaintenanceRecord.printer_id == printer.id
                )
            )
            existing_records = result.scalars().all()

            if not existing_records:
                # Create maintenance records based on extruder type
                defaults = settings.get_maintenance_defaults(printer.extruder_type)
                for item in defaults:
                    record = MaintenanceRecord(
                        printer_id=printer.id,
                        maintenance_type=item["type"],
                        threshold_hours=item["hours"],
                        last_reset_at=datetime.now(timezone.utc),
                    )
                    session.add(record)
                logger.info(
                    f"Seeded {len(defaults)} maintenance records for: {printer.name} ({printer.extruder_type})"
                )

        await session.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: startup and shutdown logic."""
    logger.info("🚀 PrintFarm Manager starting up...")

    # 1. Initialize database (create tables)
    await init_db()
    logger.info("✅ Database initialized")

    # 2. Seed printers from config
    await _seed_printers_from_config()

    # 3. Set up WebSocket hub callback for Moonraker state changes
    moonraker_manager.set_state_change_callback(ws_hub.broadcast_printer_update)

    # 4. Connect to all Moonraker instances
    async with async_session() as session:
        result = await session.execute(select(Printer))
        printers_list = [
            {"id": p.id, "moonraker_url": p.moonraker_url}
            for p in result.scalars().all()
        ]
    await moonraker_manager.connect_all(printers_list)
    logger.info(f"✅ Connected to {len(printers_list)} Moonraker instances")

    # 5. Start maintenance monitor
    await monitor.start()
    logger.info("✅ Maintenance monitor started")

    # 6. Start weekly reporter
    await weekly_reporter.start()
    logger.info("✅ Weekly reporter started")

    # 7. Start auto-dispatch loop
    await dispatcher.start_auto_dispatch()

    # 8. Load custom tools and disabled-tool state into the registry
    from app.services.assistant.custom_tools_service import refresh_custom_tools, refresh_disabled_tools
    await refresh_custom_tools()
    await refresh_disabled_tools()
    logger.info("✅ Assistant tools registry loaded")

    # 9. Start the Telegram assistant listener (no-ops until enabled in settings)
    await telegram_listener.start()
    logger.info("✅ Telegram assistant listener started")

    logger.info("🟢 PrintFarm Manager is ready!")

    yield  # App is running

    # Shutdown
    logger.info("🔴 PrintFarm Manager shutting down...")
    await telegram_listener.stop()
    await dispatcher.stop_auto_dispatch()
    await weekly_reporter.stop()
    await monitor.stop()
    await moonraker_manager.disconnect_all()
    logger.info("👋 Goodbye!")


# Create FastAPI app
app = FastAPI(
    title="PrintFarm Manager",
    description="Sistema centralizado de gestión para granja de impresión 3D",
    version=APP_VERSION,
    lifespan=lifespan,
)

from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request, exc):
    logger.error(f"422 Validation Error: {exc}")
    # Truncate: an invalid G-code upload would otherwise dump megabytes to the log
    body = await request.body()
    logger.error(f"Body (primeros 500 bytes de {len(body)}): {body[:500]!r}")
    return JSONResponse(status_code=422, content={"detail": exc.errors()})

# Allow CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files (G-codes and thumbnails)
os.makedirs(settings.gcodes_path, exist_ok=True)
app.mount("/gcodes", StaticFiles(directory=settings.gcodes_path), name="gcodes")

# Register routers
app.include_router(printers.router)
app.include_router(print_queue.router)
app.include_router(maintenance.router)
app.include_router(spoolman.router)
app.include_router(settings_router.router)
app.include_router(assistant_tools_router.router)


# WebSocket endpoint for frontend
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for real-time updates to frontend clients."""
    await ws_hub.handle_websocket(websocket)


# Health check
@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "ok",
        "service": "PrintFarm Manager",
        "version": APP_VERSION,
    }


@app.get("/api/status")
async def system_status():
    """Get overall system status."""
    from app.services.spoolman import spoolman_client

    spoolman_ok = await spoolman_client.health_check()

    async with async_session() as session:
        result = await session.execute(select(Printer))
        all_printers = result.scalars().all()

    connected = sum(1 for p in all_printers if p.status != "offline")

    return {
        "version": APP_VERSION,
        "printers_total": len(all_printers),
        "printers_connected": connected,
        "spoolman_connected": spoolman_ok,
        "moonraker_clients": len(moonraker_manager.clients),
    }
