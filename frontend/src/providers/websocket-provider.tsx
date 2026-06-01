"use client";

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import type { PrinterState, WSMessage, InitialState, MaintenanceRecord } from "@/lib/types";

interface WSContextValue {
  printers: PrinterState[];
  activeAlerts: MaintenanceRecord[];
  isConnected: boolean;
  refreshState: () => void;
}

const WSContext = createContext<WSContextValue>({
  printers: [],
  activeAlerts: [],
  isConnected: false,
  refreshState: () => {},
});

export function useWSContext() {
  return useContext(WSContext);
}

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const [printers, setPrinters] = useState<PrinterState[]>([]);
  const [activeAlerts, setActiveAlerts] = useState<MaintenanceRecord[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Guards against zombie reconnects after the provider unmounts: once false,
  // onclose/onerror handlers stop scheduling new connection attempts.
  const shouldReconnect = useRef(true);

  const connect = useCallback(() => {
    let wsUrl = process.env.NEXT_PUBLIC_WS_URL || `ws://${window.location.hostname}:8000/ws`;
    if (typeof window !== "undefined" && wsUrl.includes("localhost") && window.location.hostname !== "localhost") {
      wsUrl = wsUrl.replace("localhost", window.location.hostname);
    }

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        console.log("[WS] Connected to PrintFarm backend");
      };

      ws.onmessage = (event) => {
        try {
          const msg: WSMessage = JSON.parse(event.data);

          switch (msg.type) {
            case "initial_state": {
              const state = msg.data as InitialState;
              setPrinters(state.printers);
              setActiveAlerts(state.active_alerts);
              break;
            }
            case "printer_update": {
              const updatedPrinter = msg.data as PrinterState;
              setPrinters((prev) =>
                prev.map((p) => (p.id === updatedPrinter.id ? updatedPrinter : p))
              );
              break;
            }
            case "queue_update":
              // Trigger a re-fetch of queue data in consuming components
              window.dispatchEvent(new CustomEvent("queue-updated"));
              break;
            case "maintenance_update":
              window.dispatchEvent(new CustomEvent("maintenance-updated"));
              break;
          }
        } catch (e) {
          console.error("[WS] Parse error:", e);
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        if (shouldReconnect.current) {
          console.log("[WS] Disconnected, reconnecting in 3s...");
          reconnectTimeout.current = setTimeout(connect, 3000);
        }
      };

      ws.onerror = (error) => {
        console.error("[WS] Error:", error);
        ws.close(); // triggers onclose, which decides whether to reconnect
      };
    } catch (e) {
      console.error("[WS] Connection failed:", e);
      if (shouldReconnect.current) {
        reconnectTimeout.current = setTimeout(connect, 3000);
      }
    }
  }, []);

  const refreshState = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "refresh" }));
    }
  }, []);

  useEffect(() => {
    shouldReconnect.current = true;
    connect();
    return () => {
      shouldReconnect.current = false;
      clearTimeout(reconnectTimeout.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return (
    <WSContext.Provider value={{ printers, activeAlerts, isConnected, refreshState }}>
      {children}
    </WSContext.Provider>
  );
}
