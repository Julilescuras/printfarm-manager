"use client";

import React, { useState, useEffect } from "react";
import { Trash2, Clock, FileCode, Box } from "lucide-react";
import type { PrinterState } from "@/lib/types";
import { getStatusInfo, formatDuration } from "@/lib/utils";
import { api } from "@/lib/api";
import { ProgressRing } from "./progress-ring";
import { TemperatureGauge } from "./temperature-gauge";

interface PrinterCardProps {
  printer: PrinterState;
  onUpdate?: () => void;
}

export const PrinterCard = React.memo(function PrinterCard({ printer, onUpdate }: PrinterCardProps) {
  const [isClearing, setIsClearing] = useState(false);
  const [spoolInfo, setSpoolInfo] = useState<any>(null);
  const statusInfo = getStatusInfo(printer.status);

  useEffect(() => {
    if (printer.current_spool_id && (!spoolInfo || spoolInfo.id !== printer.current_spool_id)) {
      api.getSpool(printer.current_spool_id)
        .then(setSpoolInfo)
        .catch(console.error);
    } else if (!printer.current_spool_id) {
      setSpoolInfo(null);
    }
  }, [printer.current_spool_id]);

  const handleClearBed = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsClearing(true);
    try {
      await api.clearBed(printer.id);
      onUpdate?.();
    } catch (error) {
      console.error("Error clearing bed:", error);
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <div className="glass-card-hover p-5 space-y-4">
      {/* Header: Name + Status */}
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-base truncate">{printer.name}</h3>
          <p className="text-xs text-muted-foreground">{printer.model}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          <span className={`status-dot ${statusInfo.dotClass}`} />
          <span
            className={`text-xs font-medium px-2 py-0.5 rounded-full border ${statusInfo.badgeClass}`}
          >
            {statusInfo.label}
          </span>
        </div>
      </div>

      {/* Print Progress (shown when printing or requires_clearance) */}
      {(printer.status === "printing" ||
        printer.status === "requires_clearance") && (
        <div className="flex items-center gap-4">
          <ProgressRing progress={printer.current_job_progress} size={72} />
          <div className="flex-1 min-w-0 space-y-1">
            {printer.current_filename && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <FileCode className="w-3 h-3 shrink-0" />
                <span className="truncate">{printer.current_filename}</span>
              </div>
            )}
            {printer.eta_seconds && printer.eta_seconds > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="w-3 h-3 shrink-0" />
                <span>ETA: {formatDuration(printer.eta_seconds)}</span>
              </div>
            )}
            {/* Thumbnail */}
            {printer.thumbnail_url && (
              <div className="mt-1 w-full h-16 rounded-md overflow-hidden bg-secondary">
                <img
                  src={printer.thumbnail_url}
                  alt="Print preview"
                  className="w-full h-full object-contain"
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Temperatures */}
      {printer.status !== "offline" && (
        <div className="space-y-2">
          <TemperatureGauge
            label="Hotend"
            current={printer.hotend_temp}
            target={printer.hotend_target}
            icon="hotend"
          />
          <TemperatureGauge
            label="Cama"
            current={printer.bed_temp}
            target={printer.bed_target}
            icon="bed"
          />
        </div>
      )}

      {/* Spool info */}
      {printer.current_spool_id && spoolInfo ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-secondary/30 p-2 rounded-md">
          <div 
            className="w-3 h-3 rounded-full border border-white/20" 
            style={{ backgroundColor: `#${spoolInfo.filament?.color_hex || 'FFF'}` }}
          />
          <span className="truncate">
            {spoolInfo.filament?.material} {spoolInfo.filament?.name}
          </span>
        </div>
      ) : printer.current_spool_id ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-secondary/30 p-2 rounded-md">
          <Box className="w-3 h-3" />
          <span>Spool #{printer.current_spool_id}</span>
        </div>
      ) : null}

      {/* Nozzle + elapsed time when printing */}
      <div className="text-xs text-muted-foreground">
        Boquilla: {printer.nozzle_size}mm
        {printer.status === "printing" && printer.total_print_time_secs > 0 && (
          <> • Transcurrido: {formatDuration(printer.total_print_time_secs)}</>
        )}
        {printer.status !== "printing" && printer.lifetime_print_seconds > 0 && (
          <> • Total: {formatDuration(printer.lifetime_print_seconds)}</>
        )}
      </div>

      {/* 🧹 CLEAR BED BUTTON — Only visible when requires_clearance */}
      {printer.status === "requires_clearance" && (
        <button
          onClick={handleClearBed}
          disabled={isClearing}
          className="btn-clear-bed flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          id={`clear-bed-${printer.id}`}
        >
          <Trash2 className="w-4 h-4" />
          {isClearing ? "Vaciando..." : "🧹 Vaciar Cama y Continuar"}
        </button>
      )}

      {/* Offline message */}
      {printer.status === "offline" && (
        <div className="text-center py-4">
          <div className="text-3xl mb-2">📡</div>
          <p className="text-sm text-muted-foreground">
            Sin conexión a Moonraker
          </p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            {printer.moonraker_url}
          </p>
        </div>
      )}
    </div>
  );
});
