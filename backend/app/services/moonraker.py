"""
MoonrakerClient — WebSocket client that maintains persistent connections
to each Moonraker instance and processes real-time printer state updates.

This is the heart of the integration: it subscribes to printer objects,
detects print completion to trigger the 'requires_clearance' state, and
provides methods to upload G-codes and start prints.
"""

import asyncio
import json
import logging
from typing import Dict, Optional, Callable, Any

import websockets
import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session
from app.models.printer import Printer
from app.services.telegram import telegram_notifier

logger = logging.getLogger("printfarm.moonraker")


class MoonrakerClient:
    """Manages a single WebSocket connection to one Moonraker instance."""

    def __init__(self, printer_id: int, moonraker_url: str, on_state_change: Optional[Callable] = None):
        self.printer_id = printer_id
        self.base_url = moonraker_url.rstrip("/")
        self.ws_url = self.base_url.replace("http://", "ws://").replace("https://", "wss://") + "/websocket"
        self.on_state_change = on_state_change
        self._ws = None
        self._running = False
        self._connected = False
        self._task: Optional[asyncio.Task] = None
        self._request_id = 0
        self._last_state: Optional[str] = None

    @property
    def is_connected(self) -> bool:
        return self._connected

    def _next_id(self) -> int:
        self._request_id += 1
        return self._request_id

    async def connect(self):
        """Start the WebSocket connection loop in a background task."""
        self._running = True
        self._task = asyncio.create_task(self._connection_loop())
        logger.info(f"[Printer {self.printer_id}] Starting connection to {self.ws_url}")

    async def disconnect(self):
        """Stop the WebSocket connection."""
        self._running = False
        if self._ws:
            await self._ws.close()
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info(f"[Printer {self.printer_id}] Disconnected")

    async def _connection_loop(self):
        """Main loop: connect, subscribe, listen. Reconnects on failure."""
        while self._running:
            try:
                async with websockets.connect(self.ws_url, ping_interval=20) as ws:
                    self._ws = ws
                    self._connected = True
                    logger.info(f"[Printer {self.printer_id}] Connected to Moonraker")

                    # Update printer status to indicate we're online
                    # But respect manual states (paused, available)
                    await self._set_online_status()

                    # Identify ourselves
                    await self._send_jsonrpc(ws, "server.connection.identify", {
                        "client_name": "PrintFarm Manager",
                        "version": "1.1.1",
                        "type": "other",
                        "url": "http://printfarm-manager"
                    })

                    # Check current Klipper state explicitly on connection
                    await self._send_jsonrpc(ws, "server.info")

                    # Subscribe to printer objects for real-time updates
                    await self._subscribe_objects(ws)

                    # Process incoming messages
                    async for message in ws:
                        await self._handle_message(json.loads(message))

            except websockets.ConnectionClosed:
                logger.warning(f"[Printer {self.printer_id}] Connection closed, reconnecting...")
            except (ConnectionRefusedError, OSError) as e:
                logger.warning(f"[Printer {self.printer_id}] Cannot connect ({e}), retrying...")
                await self._update_printer_db(status="offline")
            except Exception as e:
                logger.error(f"[Printer {self.printer_id}] Unexpected error: {e}", exc_info=True)
            finally:
                self._connected = False

            if self._running:
                await asyncio.sleep(5)  # Wait before reconnecting

        await self._update_printer_db(status="offline")

    async def _send_jsonrpc(self, ws, method: str, params: dict = None) -> int:
        """Send a JSON-RPC 2.0 request over WebSocket."""
        req_id = self._next_id()
        msg = {
            "jsonrpc": "2.0",
            "method": method,
            "id": req_id,
        }
        if params:
            msg["params"] = params
        await ws.send(json.dumps(msg))
        return req_id

    async def _handle_message(self, data: dict):
        """Process incoming WebSocket messages from Moonraker."""
        method = data.get("method")

        if method == "notify_status_update":
            params = data.get("params", [])
            if params and isinstance(params[0], dict):
                await self._process_status_update(params[0])
                
        elif "result" in data and isinstance(data["result"], dict):
            # Handle response from server.info
            if "klippy_state" in data["result"]:
                klippy_state = data["result"]["klippy_state"]
                if klippy_state in ("error", "shutdown"):
                    logger.warning(f"[Printer {self.printer_id}] Klipper is in error state on connect")
                    await self._update_printer_db(status="error")
                elif klippy_state == "disconnected":
                    logger.warning(f"[Printer {self.printer_id}] Klipper is disconnected on connect")
                    await self._update_printer_db(status="offline")
            
            # Handle initial status response from printer.objects.subscribe
            if "status" in data["result"] and isinstance(data["result"]["status"], dict):
                await self._process_status_update(data["result"]["status"])

        elif method == "notify_klippy_ready":
            logger.info(f"[Printer {self.printer_id}] Klipper is ready")
            await self._set_online_status()
            if self._ws:
                await self._subscribe_objects(self._ws)

        elif method == "notify_klippy_shutdown":
            logger.warning(f"[Printer {self.printer_id}] Klipper shutdown")
            await self._update_printer_db(status="error")

        elif method == "notify_klippy_disconnected":
            logger.warning(f"[Printer {self.printer_id}] Klipper disconnected")
            await self._update_printer_db(status="offline")

    async def _process_status_update(self, status_data: dict):
        """Process a notify_status_update with changed printer object fields."""
        updates = {}

        # Extract extruder temperatures
        if "extruder" in status_data:
            ext = status_data["extruder"]
            if "temperature" in ext:
                updates["hotend_temp"] = round(ext["temperature"], 1)
            if "target" in ext:
                updates["hotend_target"] = round(ext["target"], 1)

        # Extract bed temperatures
        if "heater_bed" in status_data:
            bed = status_data["heater_bed"]
            if "temperature" in bed:
                updates["bed_temp"] = round(bed["temperature"], 1)
            if "target" in bed:
                updates["bed_target"] = round(bed["target"], 1)

        # Extract print progress
        if "display_status" in status_data:
            ds = status_data["display_status"]
            if "progress" in ds and ds["progress"] is not None:
                updates["current_job_progress"] = round(ds["progress"], 4)

        if "virtual_sdcard" in status_data:
            vsd = status_data["virtual_sdcard"]
            if "progress" in vsd and vsd["progress"] is not None:
                updates["current_job_progress"] = round(vsd["progress"], 4)

        # Extract print stats (state changes are critical!)
        if "print_stats" in status_data:
            ps = status_data["print_stats"]

            if "filename" in ps:
                updates["current_filename"] = ps["filename"]

            if "total_duration" in ps:
                updates["total_print_time_secs"] = int(ps["total_duration"])

            if "state" in ps:
                new_state = ps["state"]
                old_state = self._last_state

                if new_state == "printing":
                    updates["status"] = "printing"
                elif new_state == "paused":
                    updates["status"] = "printing"  # Still show as printing
                elif new_state == "complete":
                    # CRITICAL BUSINESS RULE: Print done → requires clearance
                    updates["status"] = "requires_clearance"
                    updates["current_job_progress"] = 1.0
                    if old_state != "complete":
                        logger.info(
                            f"[Printer {self.printer_id}] Print COMPLETE → requires_clearance"
                        )
                        # Send Telegram notification
                        asyncio.create_task(
                            self._notify_print_complete()
                        )
                elif new_state == "standby":
                    # Only set standby if we weren't in a manual/clearance state
                    if old_state != "complete":
                        # Check DB for manual states we should preserve
                        current_db_status = await self._get_current_db_status()
                        if current_db_status not in ("paused", "available", "requires_clearance"):
                            updates["status"] = "standby"
                elif new_state == "error":
                    updates["status"] = "error"
                    if old_state != "error":
                        asyncio.create_task(
                            self._notify_printer_error()
                        )

                self._last_state = new_state

        if updates:
            # Never override 'paused' status from Moonraker state changes
            if "status" in updates:
                current_db_status = await self._get_current_db_status()
                if current_db_status == "paused" and updates["status"] in ("standby",):
                    del updates["status"]

            await self._update_printer_db(**updates)

    async def _subscribe_objects(self, ws):
        """Subscribe to printer objects to receive real-time updates via notify_status_update."""
        await self._send_jsonrpc(ws, "printer.objects.subscribe", {
            "objects": {
                "print_stats": None,
                "extruder": ["temperature", "target"],
                "heater_bed": ["temperature", "target"],
                "display_status": ["progress"],
                "virtual_sdcard": ["progress", "file_position", "file_path"],
            }
        })

    async def _update_printer_db(self, **kwargs):
        """Update the printer record in the database and notify listeners."""
        async with async_session() as session:
            result = await session.execute(
                select(Printer).where(Printer.id == self.printer_id)
            )
            printer = result.scalar_one_or_none()
            if printer:
                changed = False
                for key, value in kwargs.items():
                    if getattr(printer, key) != value:
                        setattr(printer, key, value)
                        changed = True
                
                if changed:
                    await session.commit()
                    await session.refresh(printer)

                    # Notify the WebSocket hub of state changes
                    if self.on_state_change:
                        await self.on_state_change(printer.to_dict())

    async def _get_current_db_status(self) -> str:
        """Get the current status from the database."""
        async with async_session() as session:
            result = await session.execute(
                select(Printer).where(Printer.id == self.printer_id)
            )
            printer = result.scalar_one_or_none()
            return printer.status if printer else "offline"

    async def _set_online_status(self):
        """Set the printer online, but respect manual states like 'paused' and 'available'."""
        current_status = await self._get_current_db_status()
        if current_status in ("paused", "available"):
            logger.info(f"[Printer {self.printer_id}] Connected but keeping manual status: {current_status}")
            return
        await self._update_printer_db(status="standby")

    # --- Telegram notification helpers ---

    async def _notify_print_complete(self):
        """Send Telegram notification for print completion."""
        try:
            async with async_session() as session:
                result = await session.execute(
                    select(Printer).where(Printer.id == self.printer_id)
                )
                printer = result.scalar_one_or_none()
                if printer:
                    job_name = printer.current_filename or "Archivo desconocido"
                    await telegram_notifier.notify_print_complete(
                        printer.name, job_name
                    )
        except Exception as e:
            logger.error(f"Error sending Telegram notification: {e}")

    async def _notify_printer_error(self):
        """Send Telegram notification for printer error."""
        try:
            async with async_session() as session:
                result = await session.execute(
                    select(Printer).where(Printer.id == self.printer_id)
                )
                printer = result.scalar_one_or_none()
                if printer:
                    await telegram_notifier.notify_printer_error(printer.name)
        except Exception as e:
            logger.error(f"Error sending Telegram notification: {e}")

    # --- HTTP API methods for file operations and print control ---

    async def upload_gcode(self, file_path: str, filename: str) -> bool:
        """Upload a G-code file to Moonraker via HTTP POST."""
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                with open(file_path, "rb") as f:
                    files = {"file": (filename, f, "application/octet-stream")}
                    response = await client.post(
                        f"{self.base_url}/server/files/upload",
                        files=files
                    )
                    if response.status_code == 201:
                        logger.info(f"[Printer {self.printer_id}] Uploaded {filename}")
                        return True
                    else:
                        logger.error(
                            f"[Printer {self.printer_id}] Upload failed: {response.status_code} {response.text}"
                        )
                        return False
        except Exception as e:
            logger.error(f"[Printer {self.printer_id}] Upload error: {e}")
            return False

    async def start_print(self, filename: str) -> bool:
        """Start a print job on the printer via Moonraker HTTP API."""
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{self.base_url}/printer/print/start",
                    params={"filename": filename}
                )
                if response.status_code == 200:
                    logger.info(f"[Printer {self.printer_id}] Started printing {filename}")
                    return True
                else:
                    logger.error(
                        f"[Printer {self.printer_id}] Start failed: {response.status_code} {response.text}"
                    )
                    return False
        except Exception as e:
            logger.error(f"[Printer {self.printer_id}] Start print error: {e}")
            return False

    async def get_thumbnail_url(self, filename: str) -> Optional[str]:
        """Fetch the thumbnail URL for a G-code file from Moonraker metadata."""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    f"{self.base_url}/server/files/metadata",
                    params={"filename": filename}
                )
                if response.status_code == 200:
                    metadata = response.json().get("result", {})
                    thumbnails = metadata.get("thumbnails", [])
                    if thumbnails:
                        # Get the largest thumbnail
                        best = max(thumbnails, key=lambda t: t.get("width", 0))
                        rel_path = best.get("relative_path", "")
                        if rel_path:
                            return f"{self.base_url}/server/files/gcodes/{rel_path}"
        except Exception as e:
            logger.warning(f"[Printer {self.printer_id}] Thumbnail fetch error: {e}")
        return None

    async def get_print_stats(self) -> Optional[dict]:
        """Query current print_stats object via HTTP."""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    f"{self.base_url}/printer/objects/query",
                    params={"print_stats": ""}
                )
                if response.status_code == 200:
                    return response.json().get("result", {}).get("status", {}).get("print_stats", {})
        except Exception as e:
            logger.warning(f"[Printer {self.printer_id}] Stats fetch error: {e}")
        return None

    async def set_active_spool(self, spool_id: Optional[int]) -> bool:
        """Set the active spool for this printer in Moonraker's Spoolman integration."""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                # Si spool_id es None, mandamos una cadena vacía o un ID nulo para desasignar.
                params = {"spool_id": spool_id if spool_id is not None else ""}
                response = await client.post(
                    f"{self.base_url}/server/spoolman/spool_id",
                    params=params
                )
                if response.status_code == 200:
                    logger.info(f"[Printer {self.printer_id}] Active spool set to {spool_id} in Moonraker")
                    return True
                else:
                    logger.warning(f"[Printer {self.printer_id}] Failed to set spool in Moonraker: {response.status_code}")
                    return False
        except Exception as e:
            logger.error(f"[Printer {self.printer_id}] Set active spool error: {e}")
            return False


class MoonrakerManager:
    """Manages all MoonrakerClient instances for the printer farm."""

    def __init__(self):
        self.clients: Dict[int, MoonrakerClient] = {}
        self._on_state_change: Optional[Callable] = None

    def set_state_change_callback(self, callback: Callable):
        """Set the callback for state changes (used by WebSocket hub)."""
        self._on_state_change = callback

    async def add_printer(self, printer_id: int, moonraker_url: str):
        """Add and connect a new printer client."""
        if printer_id in self.clients:
            await self.clients[printer_id].disconnect()

        client = MoonrakerClient(
            printer_id=printer_id,
            moonraker_url=moonraker_url,
            on_state_change=self._on_state_change,
        )
        self.clients[printer_id] = client
        await client.connect()

    async def remove_printer(self, printer_id: int):
        """Disconnect and remove a printer client."""
        if printer_id in self.clients:
            await self.clients[printer_id].disconnect()
            del self.clients[printer_id]

    def get_client(self, printer_id: int) -> Optional[MoonrakerClient]:
        """Get a MoonrakerClient by printer ID."""
        return self.clients.get(printer_id)

    async def connect_all(self, printers: list):
        """Connect to all configured printers."""
        for p in printers:
            await self.add_printer(p["id"], p["moonraker_url"])

    async def disconnect_all(self):
        """Disconnect from all printers."""
        for client in list(self.clients.values()):
            await client.disconnect()
        self.clients.clear()


# Singleton instance
moonraker_manager = MoonrakerManager()
