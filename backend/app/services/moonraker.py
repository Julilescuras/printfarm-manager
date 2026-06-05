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
import time
from typing import Dict, Optional, Callable, Any

import websockets
import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session
from app.models.printer import Printer
from app.services.telegram import telegram_notifier
from app.version import APP_VERSION

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
        
        # Filament tracking
        self._last_filament_used: float = 0.0
        self._filament_used_accumulated: float = 0.0
        self._last_display_progress: float = 0.0
        self._last_spoolman_update_time: float = 0.0
        self._syncing_filament: bool = False

        # ETA tracking
        self._last_print_duration: float = 0.0

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
                        "version": APP_VERSION,
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
                # Typical of a power loss / cable pull mid-print: the socket just
                # drops. Previously we did NOT mark offline here, so the card
                # stayed frozen on 'printing'. Always reflect the disconnect.
                logger.warning(f"[Printer {self.printer_id}] Connection closed, reconnecting...")
                await self._mark_disconnected()
            except (ConnectionRefusedError, OSError) as e:
                logger.warning(f"[Printer {self.printer_id}] Cannot connect ({e}), retrying...")
                await self._mark_disconnected()
            except Exception as e:
                logger.error(f"[Printer {self.printer_id}] Unexpected error: {e}", exc_info=True)
                await self._mark_disconnected()
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
        # Track display_status (M73) progress
        if "display_status" in status_data:
            ds = status_data["display_status"]
            if "progress" in ds and ds["progress"] is not None:
                self._last_display_progress = ds["progress"]

        # Base progress from virtual_sdcard (often byte-based and less accurate)
        if "virtual_sdcard" in status_data:
            vs = status_data["virtual_sdcard"]
            if "progress" in vs and vs["progress"] is not None:
                if self._last_display_progress <= 0:
                    updates["current_job_progress"] = round(vs["progress"], 4)
                
        # Overwrite with display_status if available and > 0, as it's more accurate
        if self._last_display_progress > 0:
            updates["current_job_progress"] = round(self._last_display_progress, 4)

        # Extract print stats (state changes are critical!)
        if "print_stats" in status_data:
            ps = status_data["print_stats"]

            # Real-time filament tracking
            if "filament_used" in ps:
                current_used = float(ps["filament_used"])
                if not getattr(self, "_filament_tracking_initialized", False):
                    self._last_filament_used = current_used
                    self._filament_tracking_initialized = True
                elif current_used < self._last_filament_used:
                    # Reset (e.g. new print started)
                    self._last_filament_used = current_used
                else:
                    delta = current_used - self._last_filament_used
                    self._filament_used_accumulated += delta
                    self._last_filament_used = current_used

                # Sync to Spoolman every 60 seconds
                now = time.time()
                if self._filament_used_accumulated > 0 and (now - self._last_spoolman_update_time > 60):
                    asyncio.create_task(self._sync_filament_to_spoolman())

            if "filename" in ps:
                updates["current_filename"] = ps["filename"]

            if "total_duration" in ps:
                self._last_print_duration = float(ps["total_duration"])
                updates["total_print_time_secs"] = int(ps["total_duration"])

            if "state" in ps:
                new_state = ps["state"]
                old_state = self._last_state

                if new_state == "printing":
                    updates["status"] = "printing"
                    if self._last_state not in ("printing", "paused"):
                        # New print started — reset ETA trackers
                        self._last_print_duration = 0.0
                        self._last_display_progress = 0.0
                elif new_state == "paused":
                    updates["status"] = "printing"  # Still show as printing
                elif new_state == "complete":
                    # Flush any remaining filament
                    if self._filament_used_accumulated > 0:
                        asyncio.create_task(self._sync_filament_to_spoolman())
                        
                    # CRITICAL BUSINESS RULE: Print done -> requires clearance
                    updates["status"] = "requires_clearance"
                    updates["current_job_progress"] = 1.0
                    if old_state != "complete":
                        logger.info(
                            f"[Printer {self.printer_id}] Print COMPLETE -> requires_clearance"
                        )
                        # NOTE: maintenance/lifetime hours are credited live by the
                        # monitor loop (incrementally, from total_print_time_secs).
                        # We deliberately do NOT add a lump sum here — that caused
                        # the counters to only move once at the end of a print and
                        # risked double-counting.

                        # Close out the job NOW (mark completed + write history)
                        # so a finished print leaves the "En Impresión" tab even
                        # before the bed is cleared. Idempotent: clearing the bed
                        # later calls this again and it becomes a no-op.
                        from app.services.dispatcher import dispatcher
                        asyncio.create_task(
                            dispatcher.on_print_complete(self.printer_id)
                        )

                        # Send Telegram notification
                        asyncio.create_task(
                            self._notify_print_complete()
                        )
                elif new_state == "cancelled":
                    # Print aborted from Klipper/Fluidd (or via our own cancel).
                    # Flush any remaining filament, then move the printer to
                    # requires_clearance (there's a half-finished piece on the bed)
                    # and close out the job in the queue + history.
                    if self._filament_used_accumulated > 0:
                        asyncio.create_task(self._sync_filament_to_spoolman())

                    # Don't override a manual state the user may have set
                    current_db_status = await self._get_current_db_status()
                    if current_db_status not in ("paused", "available"):
                        updates["status"] = "requires_clearance"
                    if old_state not in ("cancelled", "standby"):
                        logger.info(
                            f"[Printer {self.printer_id}] Print CANCELLED -> requires_clearance"
                        )
                        from app.services.dispatcher import dispatcher
                        asyncio.create_task(
                            dispatcher.on_print_aborted(self.printer_id, "cancelled")
                        )
                elif new_state == "standby":
                    # Only set standby if we weren't in a manual/clearance state
                    if old_state != "complete":
                        # Check DB for manual states we should preserve
                        current_db_status = await self._get_current_db_status()
                        if current_db_status not in ("paused", "available", "requires_clearance"):
                            updates["status"] = "standby"
                elif new_state == "error":
                    # Flush any remaining filament
                    if self._filament_used_accumulated > 0:
                        asyncio.create_task(self._sync_filament_to_spoolman())

                    updates["status"] = "error"
                    if old_state != "error":
                        asyncio.create_task(
                            self._notify_printer_error()
                        )
                        # Close out the in-flight job as failed in queue + history
                        from app.services.dispatcher import dispatcher
                        asyncio.create_task(
                            dispatcher.on_print_aborted(self.printer_id, "failed")
                        )

                self._last_state = new_state

        # Calculate ETA from elapsed duration and progress
        progress = self._last_display_progress
        if progress > 0.01 and self._last_print_duration > 0:
            estimated_total = self._last_print_duration / progress
            remaining = estimated_total - self._last_print_duration
            updates["eta_seconds"] = max(0, int(remaining))
        elif updates.get("status") in ("standby", "available", "requires_clearance", "error", "offline", "complete"):
            updates["eta_seconds"] = None

        if updates:
            # Never override 'paused' status from Moonraker state changes
            if "status" in updates:
                current_db_status = await self._get_current_db_status()
                if current_db_status == "paused" and updates["status"] in ("standby",):
                    del updates["status"]

            # Any live state report means the printer is back — clear a stale
            # "disconnected while printing" flag. (_update_printer_db only writes
            # fields that actually changed, so this is a no-op when already clear.)
            if updates.get("status") and updates["status"] != "offline":
                updates["disconnected_while_printing"] = False

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

    async def _sync_filament_to_spoolman(self):
        """Send accumulated filament usage to Spoolman."""
        if self._filament_used_accumulated <= 0 or self._syncing_filament:
            return

        self._syncing_filament = True
        try:
            async with async_session() as session:
                result = await session.execute(
                    select(Printer).where(Printer.id == self.printer_id)
                )
                printer = result.scalar_one_or_none()
                if not printer or not printer.current_spool_id:
                    return

                # If the printer's native Moonraker/Spoolman integration handles
                # filament tracking, discard the accumulated amount and let it manage.
                if printer.filament_tracking_mode == "moonraker":
                    self._filament_used_accumulated = 0.0
                    self._last_spoolman_update_time = time.time()
                    return

                spool_id = printer.current_spool_id

            amount_to_use = self._filament_used_accumulated
            self._filament_used_accumulated = 0.0
            self._last_spoolman_update_time = time.time()

            from app.services.spoolman import spoolman_client
            success = await spoolman_client.use_filament(spool_id, amount_to_use)
            if not success:
                # If it failed, add the amount back to retry later
                self._filament_used_accumulated += amount_to_use
        except Exception as e:
            logger.error(f"[Printer {self.printer_id}] Filament sync error: {e}")
        finally:
            self._syncing_filament = False

    async def _update_printer_db(self, **kwargs):
        """Update the printer record in the database and notify listeners."""
        async with async_session() as session:
            result = await session.execute(
                select(Printer).where(Printer.id == self.printer_id)
            )
            printer = result.scalar_one_or_none()
            if printer:
                high_freq_fields = {"hotend_temp", "bed_temp", "current_job_progress"}
                only_ephemeral = all(k in high_freq_fields for k in kwargs.keys())

                changed = False
                for key, value in kwargs.items():
                    if getattr(printer, key) != value:
                        setattr(printer, key, value)
                        changed = True
                
                if changed:
                    now = time.time()
                    if not only_ephemeral or (now - getattr(self, "_last_db_commit_time", 0)) > 5.0:
                        await session.commit()
                        await session.refresh(printer)
                        self._last_db_commit_time = now

                    # Notify the WebSocket hub of state changes (always broadcast)
                    if self.on_state_change:
                        await self.on_state_change(printer.to_dict())

    async def _mark_disconnected(self):
        """Mark the printer offline after a connection loss.

        If the drop happened mid-print, flag it as a likely power/connection loss
        so the UI can show a warning instead of a frozen 'printing' card. The flag
        is cleared automatically once the printer reports a live state again (see
        _process_status_update). A clean, intentional disconnect raises
        CancelledError and never reaches here, so we won't false-flag on shutdown.
        """
        prev = await self._get_current_db_status()
        was_printing = prev in ("printing", "paused")
        await self._update_printer_db(
            status="offline",
            disconnected_while_printing=was_printing,
        )

    async def _get_current_db_status(self) -> str:
        """Get the current status from the database."""
        async with async_session() as session:
            result = await session.execute(
                select(Printer).where(Printer.id == self.printer_id)
            )
            printer = result.scalar_one_or_none()
            return printer.status if printer else "offline"

    async def _set_online_status(self):
        """Set the printer online, but respect states that must survive reconnects.

        CRITICAL: 'requires_clearance' MUST be preserved here. Otherwise a brief
        WebSocket reconnect (Klipper restart, network blip, ping timeout) would
        silently downgrade the printer to 'standby', and the dispatcher would
        start the next queued job ON TOP of the finished print still on the bed.
        """
        current_status = await self._get_current_db_status()
        # 'printing' is preserved too: a printer that was printing and merely
        # reconnected is still printing. Downgrading it to standby (even for the
        # ~1s until the subscribe response arrives) could let the reconciler
        # wrongly close a live job.
        if current_status in ("paused", "available", "requires_clearance", "printing"):
            logger.info(f"[Printer {self.printer_id}] Connected but keeping protected status: {current_status}")
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

    async def upload_gcode(self, file_path: str, filename: str, folder: str = "") -> bool:
        """Upload a G-code file to Moonraker via HTTP POST, optionally into a subfolder."""
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                with open(file_path, "rb") as f:
                    files = {"file": (filename, f, "application/octet-stream")}
                    data = {"path": folder} if folder else {}
                    response = await client.post(
                        f"{self.base_url}/server/files/upload",
                        files=files,
                        data=data,
                    )
                    if response.status_code == 201:
                        dest = f"{folder}/{filename}" if folder else filename
                        logger.info(f"[Printer {self.printer_id}] Uploaded {dest}")
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

    async def cancel_print(self) -> bool:
        """Cancel the currently running print on the printer via Moonraker."""
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(f"{self.base_url}/printer/print/cancel")
                if response.status_code == 200:
                    logger.info(f"[Printer {self.printer_id}] Print cancelled")
                    return True
                logger.error(
                    f"[Printer {self.printer_id}] Cancel failed: {response.status_code} {response.text}"
                )
                return False
        except Exception as e:
            logger.error(f"[Printer {self.printer_id}] Cancel print error: {e}")
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
