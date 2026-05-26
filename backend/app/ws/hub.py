"""
WebSocket Hub — Aggregates state from all printers and broadcasts
to connected frontend clients via a single WebSocket endpoint.
"""

import asyncio
import json
import logging
from typing import Set, Dict, Any

from fastapi import WebSocket, WebSocketDisconnect
from sqlalchemy import select

from app.database import async_session
from app.models.printer import Printer
from app.models.maintenance import MaintenanceRecord

logger = logging.getLogger("printfarm.ws_hub")


class WebSocketHub:
    """
    Manages WebSocket connections from frontend clients.
    Broadcasts printer state updates in real-time.
    """

    def __init__(self):
        self._connections: Set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket):
        """Accept a new WebSocket connection and send initial state."""
        await websocket.accept()
        async with self._lock:
            self._connections.add(websocket)
        logger.info(f"Frontend client connected. Total: {len(self._connections)}")

        # Send initial full state
        try:
            state = await self._get_full_state()
            await websocket.send_json({
                "type": "initial_state",
                "data": state,
            })
        except Exception as e:
            logger.error(f"Error sending initial state: {e}")

    async def disconnect(self, websocket: WebSocket):
        """Remove a disconnected WebSocket client."""
        async with self._lock:
            self._connections.discard(websocket)
        logger.info(f"Frontend client disconnected. Total: {len(self._connections)}")

    async def broadcast_printer_update(self, printer_data: dict):
        """Broadcast a printer state update to all connected frontends."""
        message = json.dumps({
            "type": "printer_update",
            "data": printer_data,
        })
        await self._broadcast(message)

    async def broadcast_queue_update(self):
        """Notify frontends that the queue has changed."""
        message = json.dumps({
            "type": "queue_update",
            "data": {},
        })
        await self._broadcast(message)

    async def broadcast_maintenance_update(self):
        """Notify frontends that maintenance records have changed."""
        message = json.dumps({
            "type": "maintenance_update",
            "data": {},
        })
        await self._broadcast(message)

    async def _broadcast(self, message: str):
        """Send a message to all connected clients, removing dead connections."""
        dead = set()
        async with self._lock:
            connections = self._connections.copy()

        for ws in connections:
            try:
                await ws.send_text(message)
            except Exception:
                dead.add(ws)

        if dead:
            async with self._lock:
                self._connections -= dead

    async def _get_full_state(self) -> dict:
        """Get the complete state of all printers and active alerts."""
        async with async_session() as session:
            # Get all printers
            result = await session.execute(select(Printer))
            printers = [p.to_dict() for p in result.scalars().all()]

            # Get active maintenance alerts
            result = await session.execute(
                select(MaintenanceRecord).where(MaintenanceRecord.is_alert_active == True)
            )
            alerts = [r.to_dict() for r in result.scalars().all()]

        return {
            "printers": printers,
            "active_alerts": alerts,
        }

    async def handle_websocket(self, websocket: WebSocket):
        """Main handler for a frontend WebSocket connection."""
        await self.connect(websocket)
        try:
            while True:
                # Keep the connection alive; handle pings/messages from frontend
                data = await websocket.receive_text()
                try:
                    msg = json.loads(data)
                    # Handle client messages if needed (e.g., request refresh)
                    if msg.get("type") == "refresh":
                        state = await self._get_full_state()
                        await websocket.send_json({
                            "type": "initial_state",
                            "data": state,
                        })
                except json.JSONDecodeError:
                    pass
        except WebSocketDisconnect:
            await self.disconnect(websocket)
        except Exception as e:
            logger.error(f"WebSocket error: {e}")
            await self.disconnect(websocket)


# Singleton instance
ws_hub = WebSocketHub()
