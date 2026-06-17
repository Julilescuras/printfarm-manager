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
  Video,
  ChevronDown,
  ChevronUp,
  RefreshCw,
} from "lucide-react";
import { useWSContext } from "@/providers/websocket-provider";
import { api } from "@/lib/api";
import { getStatusInfo, formatDuration } from "@/lib/utils";
import { PrinterMediaView } from "@/components/dashboard/printer-media-view";

export default function PrinterDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const printerId = parseInt(params.id as string, 10);

  const { printers, isConnected, refreshState } = useWSContext();
  const [spoolInfo, setSpoolInfo] = useState<any>(null);
  const [isLoadingSpool, setIsLoadingSpool] = useState(false);
  const [isSettingStatus, setIsSettingStatus] = useState(false);
  const [showSpoolSelector, setShowSpoolSelector] = useState(false);
  const [availableSpools, setAvailableSpools] = useState<any[]>([]);
  const [isLoadingSpools, setIsLoadingSpools] = useState(false);
  const [isAssigningSpool, setIsAssigningSpool] = useState(false);

  const printer = printers.find((p) => p.id === printerId);

  useEffect(() => {
    if (printer?.current_spool_id && (!spoolInfo || spoolInfo.id !== printer.current_spool_id)) {
      setIsLoadingSpool(true);
      api.getSpoolCached(printer.current_spool_id)
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

  const handleOpenSpoolSelector = async () => {
    if (showSpoolSelector) {
      setShowSpoolSelector(false);
      return;
    }
    setShowSpoolSelector(true);
    setIsLoadingSpools(true);
    try {
      const spools = await api.getSpools();
      setAvailableSpools(spools);
    } catch {
      alert("Error al cargar los spools de Spoolman");
      setShowSpoolSelector(false);
    } finally {
      setIsLoadingSpools(false);
    }
  };

  const handleAssignSpool = async (spoolId: number) => {
    setIsAssigningSpool(true);
    try {
      await api.assignSpool(printer.id, spoolId);
      setShowSpoolSelector(false);
      await refreshState();
    } catch {
      alert("Error al asignar el filamento");
    } finally {
      setIsAssigningSpool(false);
    }
  };

  const handleSetStatus = async (status: string) => {
    setIsSettingStatus(true);
    try {
      await api.setStatus(printer.id, status);
      await refreshState();
    } catch {
      alert("Error al cambiar el estado");
    } finally {
      setIsSettingStatus(false);
    }
  };

  const handleCancelPrint = async () => {
    if (!window.confirm("¿Seguro que querés cancelar la impresión en curso? Se frenará la impresora y quedará la cama por vaciar.")) return;
    setIsSettingStatus(true);
    try {
      await api.cancelPrint(printer.id);
      await refreshState();
    } catch (error: any) {
      alert(`Error al cancelar la impresión: ${error.message || error}`);
    } finally {
      setIsSettingStatus(false);
    }
  };

  const statusColors: Record<string, string> = {
    printing: "text-blue-400 bg-blue-500/20 border-blue-500/30",
    available: "text-green-400 bg-green-500/20 border-green-500/30",
    requires_clearance: "text-purple-400 bg-purple-500/20 border-purple-500/30",
    error: "text-red-400 bg-red-500/20 border-red-500/30",
    offline: "text-gray-400 bg-gray-500/20 border-gray-500/30",
    // 'standby' se unifica visualmente con 'available' (ver getStatusInfo).
    standby: "text-green-400 bg-green-500/20 border-green-500/30",
  };

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
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold text-gradient flex items-center gap-3 flex-wrap">
            {printer.name}
            <span
              className={`text-xs px-3 py-1 rounded-full border uppercase tracking-wider font-semibold ${
                statusColors[printer.status] || statusColors.offline
              }`}
            >
              {getStatusInfo(printer.status).label}
            </span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1 break-words">
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
            <h2 className="text-lg font-bold mb-4">Acciones</h2>
            {printer.status === "printing" ? (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  No se puede cambiar el estado manualmente mientras imprime.
                </p>
                <button
                  onClick={handleCancelPrint}
                  disabled={isSettingStatus}
                  className="w-full py-2 px-3 rounded-lg text-sm font-semibold bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors disabled:opacity-50"
                >
                  {isSettingStatus ? "Cancelando..." : "Cancelar impresión"}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <label className="text-xs text-muted-foreground">Cambiar estado manualmente:</label>
                <div className="grid gap-2">
                  <button
                    onClick={() => handleSetStatus("available")}
                    disabled={isSettingStatus || printer.status === "available" || printer.status === "standby"}
                    className={`py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                      printer.status === "available" || printer.status === "standby"
                        ? "bg-green-500/20 text-green-400 border border-green-500/30"
                        : "bg-secondary hover:bg-secondary/80 text-foreground"
                    }`}
                  >
                    Disponible
                  </button>
                  <button
                    onClick={() => handleSetStatus("paused")}
                    disabled={isSettingStatus || printer.status === "paused"}
                    className={`py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                      printer.status === "paused"
                        ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                        : "bg-secondary hover:bg-secondary/80 text-foreground"
                    }`}
                  >
                    En Pausa
                  </button>
                  <button
                    onClick={() => handleSetStatus("requires_clearance")}
                    disabled={isSettingStatus || printer.status === "requires_clearance"}
                    className={`py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                      printer.status === "requires_clearance"
                        ? "bg-purple-500/20 text-purple-400 border border-purple-500/30"
                        : "bg-secondary hover:bg-secondary/80 text-foreground"
                    }`}
                  >
                    Cama Ocupada
                  </button>
                </div>
                {printer.status === "requires_clearance" && (
                  <button
                    onClick={handleClearBed}
                    className="w-full mt-2 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-lg font-semibold shadow-lg shadow-purple-500/20 transition-all text-sm"
                  >
                    Vaciar Cama (Clear Bed)
                  </button>
                )}
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
          ) : printer.disconnected_while_printing ? (
            <div className="flex flex-col items-center justify-center h-48 space-y-3 text-center px-4">
              <div className="text-4xl">⚡</div>
              <p className="text-amber-400 font-semibold">
                Conexión perdida durante la impresión
              </p>
              <p className="text-sm text-muted-foreground">
                Posible corte de energía. Última lectura:{" "}
                {((printer.current_job_progress || 0) * 100).toFixed(1)}%
                {printer.current_filename ? ` · ${printer.current_filename}` : ""}
              </p>
              <p className="text-xs text-muted-foreground/60">
                Cuando vuelva la conexión, el estado se actualizará solo.
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-48 space-y-3 text-muted-foreground">
              <Box className="w-12 h-12 opacity-50" />
              <p>No hay ninguna impresión en curso</p>
            </div>
          )}
        </div>

        {/* Camera / G-code preview (with toggle when both available) */}
        {(printer.camera_url ||
          printer.status === "printing" ||
          printer.disconnected_while_printing) && (
          <div className="glass-card p-6 md:col-span-3">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              <Video className="w-5 h-5 text-primary" /> Cámara / Previsualización
            </h2>
            <PrinterMediaView printer={printer} heightClass="aspect-video w-full" />
          </div>
        )}

        {/* Bottom Span: Spoolman Details */}
        <div className="glass-card p-6 md:col-span-3">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Box className="w-5 h-5 text-primary" /> Filamento Cargado (Spoolman)
            </h2>
            <div className="flex items-center gap-2">
              {printer.current_spool_id && spoolInfo && (
                <button
                  onClick={handleUnassignSpool}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-red-400 hover:bg-red-500/10 border border-border hover:border-red-500/30 transition-all"
                >
                  <X className="w-3 h-3" />
                  Desasignar
                </button>
              )}
              <button
                onClick={handleOpenSpoolSelector}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                  showSpoolSelector
                    ? "bg-primary/20 text-primary border-primary/40"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary border-border"
                }`}
              >
                {showSpoolSelector ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                {printer.current_spool_id ? "Cambiar filamento" : "Asignar filamento"}
              </button>
            </div>
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

          {/* Spool Selector */}
          {showSpoolSelector && (
            <div className="mt-4 border border-border rounded-lg overflow-hidden">
              <div className="px-4 py-2 bg-secondary/60 border-b border-border flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Seleccionar spool
                </span>
                {isLoadingSpools && (
                  <RefreshCw className="w-3 h-3 text-muted-foreground animate-spin" />
                )}
              </div>
              {isLoadingSpools ? (
                <div className="p-4 text-sm text-muted-foreground animate-pulse">
                  Cargando spools de Spoolman...
                </div>
              ) : availableSpools.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">
                  No se encontraron spools en Spoolman.
                </div>
              ) : (
                <div className="divide-y divide-border max-h-72 overflow-y-auto">
                  {availableSpools.map((spool) => {
                    const isCurrent = spool.id === printer.current_spool_id;
                    return (
                      <button
                        key={spool.id}
                        onClick={() => !isCurrent && handleAssignSpool(spool.id)}
                        disabled={isAssigningSpool || isCurrent}
                        className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                          isCurrent
                            ? "bg-primary/10 cursor-default"
                            : "hover:bg-secondary/70 cursor-pointer"
                        } disabled:opacity-60`}
                      >
                        <div
                          className="w-6 h-6 rounded-full border border-white/20 shrink-0"
                          style={{ backgroundColor: `#${spool.filament?.color_hex || "888"}` }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm">
                              {spool.filament?.material || "?"} — {spool.filament?.name || "Sin nombre"}
                            </span>
                            {isCurrent && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary border border-primary/30">
                                Actual
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {spool.filament?.vendor?.name || "Sin marca"} · #{spool.id}
                            {spool.remaining_weight != null && (
                              <span className={spool.remaining_weight < 100 ? " text-amber-400" : ""}>
                                {" "}· {spool.remaining_weight.toFixed(0)}g restantes
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
