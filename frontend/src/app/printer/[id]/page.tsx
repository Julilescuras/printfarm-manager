"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Thermometer,
  Box,
  Clock,
  FileCode,
  ExternalLink,
  X,
  Play,
  Pause,
  Power,
} from "lucide-react";
import { useWSContext } from "@/providers/websocket-provider";
import { api } from "@/lib/api";
import { getStatusInfo, formatDuration } from "@/lib/utils";

export default function PrinterDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const printerId = parseInt(params.id as string, 10);

  const { printers, isConnected, refreshState } = useWSContext();
  const [spoolInfo, setSpoolInfo] = useState<any>(null);
  const [isLoadingSpool, setIsLoadingSpool] = useState(false);
  const [isChangingStatus, setIsChangingStatus] = useState(false);

  const printer = printers.find((p) => p.id === printerId);

  useEffect(() => {
    if (printer?.current_spool_id && (!spoolInfo || spoolInfo.id !== printer.current_spool_id)) {
      setIsLoadingSpool(true);
      api.getSpool(printer.current_spool_id)
        .then((data) => setSpoolInfo(data))
        .catch((err) => console.error("Error fetching spool info:", err))
        .finally(() => setIsLoadingSpool(false));
    } else if (!printer?.current_spool_id) {
      setSpoolInfo(null);
    }
  }, [printer?.current_spool_id]);

  if (!printer) {
    return (
      <div className="flex flex-col items-center justify-center h-full space-y-4">
        <h2 className="text-xl font-bold">Impresora no encontrada</h2>
        <button
          onClick={() => router.push("/dashboard")}
          className="px-4 py-2 bg-secondary rounded-lg"
        >
          Volver al Dashboard
        </button>
      </div>
    );
  }

  const handleClearBed = async () => {
    try {
      await api.clearBed(printer.id);
    } catch {
      alert("Error al vaciar la cama");
    }
  };

  const handleUnassignSpool = async () => {
    try {
      await api.assignSpool(printer.id, null);
      setSpoolInfo(null);
      await refreshState();
    } catch {
      alert("Error al desasignar el filamento");
    }
  };

  const handleSetStatus = async (status: string) => {
    setIsChangingStatus(true);
    try {
      await api.setPrinterStatus(printer.id, status);
      await refreshState();
    } catch {
      alert("Error al cambiar el estado");
    } finally {
      setIsChangingStatus(false);
    }
  };

  const statusColors: Record<string, string> = {
    printing: "text-blue-400 bg-blue-500/20 border-blue-500/30",
    available: "text-green-400 bg-green-500/20 border-green-500/30",
    requires_clearance: "text-purple-400 bg-purple-500/20 border-purple-500/30",
    paused: "text-amber-400 bg-amber-500/20 border-amber-500/30",
    error: "text-red-400 bg-red-500/20 border-red-500/30",
    offline: "text-gray-400 bg-gray-500/20 border-gray-500/30",
    standby: "text-emerald-400 bg-emerald-500/20 border-emerald-500/30",
  };

  const isIdle = ["standby", "available", "paused"].includes(printer.status);

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => router.push("/dashboard")}
          className="p-2 bg-secondary hover:bg-secondary/80 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-3xl font-bold text-gradient flex items-center gap-3 flex-wrap">
            {printer.name}
            <span
              className={`text-xs px-3 py-1 rounded-full border uppercase tracking-wider font-semibold ${
                statusColors[printer.status] || statusColors.offline
              }`}
            >
              {getStatusInfo(printer.status).label}
            </span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {printer.model} ·{" "}
            <span className={printer.extruder_type === "bowden" ? "text-amber-400" : "text-primary"}>
              {printer.extruder_type === "bowden" ? "Bowden" : "Direct Drive"}
            </span>
            {" "}· Boquilla: {printer.nozzle_size}mm · URL: {printer.moonraker_url}
          </p>
        </div>

        {/* Fluidd button */}
        {printer.fluidd_url && (
          <a
            href={printer.fluidd_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-colors text-sm font-medium shrink-0"
          >
            <ExternalLink className="w-4 h-4" />
            Abrir en Fluidd
          </a>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left Column: Temperatures & Actions */}
        <div className="space-y-6">
          <div className="glass-card p-6">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              <Thermometer className="w-5 h-5 text-primary" /> Temperaturas
            </h2>
            <div className="space-y-6">
              <div>
                <div className="flex justify-between text-sm mb-1 text-muted-foreground">
                  <span>Hotend</span>
                  <span>{printer.hotend_temp.toFixed(1)}°C / {printer.hotend_target.toFixed(1)}°C</span>
                </div>
                <div className="h-4 bg-secondary rounded-full overflow-hidden border border-border">
                  <div
                    className="h-full bg-orange-500 transition-all duration-500"
                    style={{
                      width: `${Math.min((printer.hotend_temp / Math.max(printer.hotend_target, 250)) * 100, 100)}%`,
                    }}
                  />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1 text-muted-foreground">
                  <span>Cama (Bed)</span>
                  <span>{printer.bed_temp.toFixed(1)}°C / {printer.bed_target.toFixed(1)}°C</span>
                </div>
                <div className="h-4 bg-secondary rounded-full overflow-hidden border border-border">
                  <div
                    className="h-full bg-blue-500 transition-all duration-500"
                    style={{
                      width: `${Math.min((printer.bed_temp / Math.max(printer.bed_target, 100)) * 100, 100)}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="glass-card p-6">
            <h2 className="text-lg font-bold mb-4">Estado de la Impresora</h2>
            {printer.status === "requires_clearance" ? (
              <button
                onClick={handleClearBed}
                className="w-full py-3 bg-purple-500 hover:bg-purple-600 text-white rounded-lg font-semibold shadow-lg shadow-purple-500/20 transition-all"
              >
                Vaciar Cama (Clear Bed)
              </button>
            ) : isIdle ? (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground mb-3">
                  Seleccioná el estado de la impresora. Las impresoras en pausa no reciben trabajos automáticamente.
                </p>
                <div className="grid grid-cols-1 gap-2">
                  <button
                    onClick={() => handleSetStatus("available")}
                    disabled={isChangingStatus || printer.status === "available"}
                    className={`flex items-center justify-center gap-2 py-2.5 rounded-lg font-medium text-sm transition-all disabled:opacity-50 ${
                      printer.status === "available"
                        ? "bg-green-500/20 text-green-400 border-2 border-green-500/50 ring-2 ring-green-500/20"
                        : "bg-secondary hover:bg-green-500/10 text-muted-foreground hover:text-green-400 border border-border hover:border-green-500/30"
                    }`}
                  >
                    <Play className="w-4 h-4" />
                    Disponible
                    {printer.status === "available" && <span className="text-xs opacity-70">(actual)</span>}
                  </button>
                  <button
                    onClick={() => handleSetStatus("standby")}
                    disabled={isChangingStatus || printer.status === "standby"}
                    className={`flex items-center justify-center gap-2 py-2.5 rounded-lg font-medium text-sm transition-all disabled:opacity-50 ${
                      printer.status === "standby"
                        ? "bg-blue-500/20 text-blue-400 border-2 border-blue-500/50 ring-2 ring-blue-500/20"
                        : "bg-secondary hover:bg-blue-500/10 text-muted-foreground hover:text-blue-400 border border-border hover:border-blue-500/30"
                    }`}
                  >
                    <Power className="w-4 h-4" />
                    En Espera
                    {printer.status === "standby" && <span className="text-xs opacity-70">(actual)</span>}
                  </button>
                  <button
                    onClick={() => handleSetStatus("paused")}
                    disabled={isChangingStatus || printer.status === "paused"}
                    className={`flex items-center justify-center gap-2 py-2.5 rounded-lg font-medium text-sm transition-all disabled:opacity-50 ${
                      printer.status === "paused"
                        ? "bg-amber-500/20 text-amber-400 border-2 border-amber-500/50 ring-2 ring-amber-500/20"
                        : "bg-secondary hover:bg-amber-500/10 text-muted-foreground hover:text-amber-400 border border-border hover:border-amber-500/30"
                    }`}
                  >
                    <Pause className="w-4 h-4" />
                    En Pausa
                    {printer.status === "paused" && <span className="text-xs opacity-70">(actual)</span>}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground text-center mt-2">
                  {printer.status === "paused"
                    ? "⏸ No se asignarán trabajos mientras esté en pausa"
                    : "✅ Los trabajos compatibles se asignan automáticamente"}
                </p>
              </div>
            ) : (
              <div className="text-center p-4 bg-secondary/50 rounded-lg text-sm text-muted-foreground">
                {printer.status === "printing"
                  ? "Imprimiendo — esperá a que termine"
                  : printer.status === "error"
                  ? "Error detectado — revisá la impresora"
                  : "Impresora desconectada"}
              </div>
            )}
          </div>
        </div>

        {/* Middle Column: Print Status */}
        <div className="glass-card p-6 md:col-span-2">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
            <FileCode className="w-5 h-5 text-primary" /> Progreso de Impresión
          </h2>

          {printer.status === "printing" ? (
            <div className="space-y-6 mt-6">
              <div className="text-center space-y-2">
                <div className="text-5xl font-bold text-primary">
                  {(printer.current_job_progress * 100).toFixed(1)}%
                </div>
                <div className="text-lg text-foreground truncate px-4">
                  {printer.current_filename || "Desconocido"}
                </div>
              </div>

              <div className="h-6 bg-secondary rounded-full overflow-hidden border border-border">
                <div
                  className="h-full bg-primary transition-all duration-500 relative"
                  style={{ width: `${printer.current_job_progress * 100}%` }}
                >
                  <div className="absolute inset-0 bg-white/20 animate-pulse" />
                </div>
              </div>

              <div className="flex items-center justify-between px-4">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Clock className="w-4 h-4" />
                  <span>
                    Tiempo restante: ~{printer.eta_seconds ? formatDuration(printer.eta_seconds) : "calculando..."}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-48 space-y-3 text-muted-foreground">
              <Box className="w-12 h-12 opacity-50" />
              <p>No hay ninguna impresión en curso</p>
            </div>
          )}
        </div>

        {/* Bottom Span: Spoolman Details */}
        <div className="glass-card p-6 md:col-span-3">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Box className="w-5 h-5 text-primary" /> Filamento Cargado (Spoolman)
            </h2>
            {printer.current_spool_id && spoolInfo && (
              <button
                onClick={handleUnassignSpool}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-red-400 hover:bg-red-500/10 border border-border hover:border-red-500/30 transition-all"
              >
                <X className="w-3 h-3" />
                Desasignar filamento
              </button>
            )}
          </div>

          {!printer.current_spool_id ? (
            <div className="p-4 bg-secondary/50 rounded-lg text-sm text-muted-foreground">
              No hay ningún filamento asignado a esta impresora.
            </div>
          ) : isLoadingSpool ? (
            <div className="p-4 text-sm text-muted-foreground animate-pulse">
              Cargando información del filamento...
            </div>
          ) : spoolInfo ? (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="bg-secondary/50 p-4 rounded-lg">
                <div className="text-xs text-muted-foreground mb-1">Material</div>
                <div className="font-bold text-lg">{spoolInfo.filament?.material || "N/A"}</div>
              </div>
              <div className="bg-secondary/50 p-4 rounded-lg">
                <div className="text-xs text-muted-foreground mb-1">Color</div>
                <div className="flex items-center gap-2">
                  <div
                    className="w-5 h-5 rounded-full border border-white/20"
                    style={{ backgroundColor: `#${spoolInfo.filament?.color_hex || "FFF"}` }}
                  />
                  <div className="font-bold text-lg capitalize">{spoolInfo.filament?.name || "N/A"}</div>
                </div>
              </div>
              <div className="bg-secondary/50 p-4 rounded-lg">
                <div className="text-xs text-muted-foreground mb-1">Fabricante</div>
                <div className="font-bold text-lg">{spoolInfo.filament?.vendor?.name || "Desconocido"}</div>
              </div>
              <div className="bg-secondary/50 p-4 rounded-lg">
                <div className="text-xs text-muted-foreground mb-1">Peso Restante</div>
                <div className={`font-bold text-lg ${spoolInfo.remaining_weight < 100 ? "text-amber-400" : ""}`}>
                  {spoolInfo.remaining_weight ? `${spoolInfo.remaining_weight.toFixed(1)}g` : "Desconocido"}
                </div>
              </div>
              <div className="bg-secondary/50 p-4 rounded-lg">
                <div className="text-xs text-muted-foreground mb-1">ID Spool</div>
                <div className="font-bold text-lg font-mono">#{printer.current_spool_id}</div>
              </div>
            </div>
          ) : (
            <div className="p-4 bg-red-500/10 text-red-400 rounded-lg text-sm">
              No se pudo cargar la información del spool (ID: {printer.current_spool_id})
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
