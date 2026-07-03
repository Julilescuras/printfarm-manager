"use client";

import { useEffect, useState } from "react";
import {
  X, Download, Clock, Weight, Printer, Palette, Ruler, Calendar,
  CheckCircle, XCircle, AlertTriangle, Loader2,
} from "lucide-react";
import { api } from "@/lib/api";
import type { PrintHistoryEntry, PrintResult } from "@/lib/types";
import { cn, formatDuration, formatDateTime } from "@/lib/utils";
import { GcodeThumbnail } from "@/components/files/gcode-thumbnail";
import { EstimateVsActualBar } from "@/components/files/estimate-vs-actual-bar";

const RESULT_META: Record<PrintResult, { label: string; className: string; Icon: typeof CheckCircle }> = {
  success: {
    label: "Completado",
    className: "text-status-printing border-status-printing/30 bg-status-printing/10",
    Icon: CheckCircle,
  },
  failed: {
    label: "Fallido",
    className: "text-status-error border-status-error/30 bg-status-error/10",
    Icon: XCircle,
  },
  cancelled: {
    label: "Cancelado",
    className: "text-muted-foreground border-border bg-secondary/60",
    Icon: AlertTriangle,
  },
};

export function JobDetailModal({
  entry,
  onClose,
}: {
  entry: PrintHistoryEntry;
  onClose: () => void;
}) {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const result = RESULT_META[entry.result] ?? RESULT_META.cancelled;

  async function handleDownload() {
    setDownloading(true);
    setDownloadError(null);
    try {
      const res = await fetch(api.historyDownloadUrl(entry.id));
      if (!res.ok) {
        setDownloadError("El archivo ya no está en disco.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = entry.gcode_filename || `${entry.job_name}.gcode`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setDownloadError("No se pudo descargar el archivo.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="glass-card w-full max-w-2xl max-h-[90vh] overflow-y-auto custom-scrollbar p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-5">
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-foreground truncate">{entry.job_name}</h2>
            <p className="font-mono text-xs text-muted-foreground truncate mt-0.5">
              {entry.gcode_filename}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid gap-6 sm:grid-cols-[minmax(0,220px)_1fr]">
          {/* Left: the piece as hero + download */}
          <div className="space-y-3">
            <GcodeThumbnail
              src={api.historyThumbnailUrl(entry.id)}
              className="aspect-square w-full rounded-xl border border-border"
              iconClassName="w-14 h-14"
            />
            <span
              className={cn(
                "flex items-center justify-center gap-1.5 text-xs font-medium px-2 py-1 rounded-lg border",
                result.className
              )}
            >
              <result.Icon className="w-3.5 h-3.5" />
              {result.label}
            </span>
            <button
              onClick={handleDownload}
              disabled={downloading}
              className={cn(
                "w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-semibold",
                "bg-primary/90 text-primary-foreground hover:bg-primary transition-colors disabled:opacity-60"
              )}
            >
              {downloading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              Descargar G-code
            </button>
            {downloadError && (
              <p className="text-xs text-status-error text-center">{downloadError}</p>
            )}
          </div>

          {/* Right: data cards + estimate vs actual */}
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-2">
              <DataCard icon={<Printer className="w-3.5 h-3.5" />} label="Impresora" value={entry.printer_name || "—"} />
              <DataCard icon={<Palette className="w-3.5 h-3.5" />} label="Material" value={entry.material || "—"} />
              <DataCard icon={<Palette className="w-3.5 h-3.5" />} label="Color" value={entry.required_color || "—"} />
              <DataCard icon={<Ruler className="w-3.5 h-3.5" />} label="Boquilla" value={entry.required_nozzle ? `${entry.required_nozzle} mm` : "—"} mono />
              <DataCard icon={<Calendar className="w-3.5 h-3.5" />} label="Iniciado" value={formatDateTime(entry.started_at)} mono />
              <DataCard icon={<Calendar className="w-3.5 h-3.5" />} label="Completado" value={formatDateTime(entry.completed_at)} mono />
            </div>

            <div className="glass-card p-4 space-y-4 bg-secondary/30">
              <EstimateVsActualBar
                label="Tiempo"
                icon={<Clock className="w-4 h-4 text-muted-foreground" />}
                estimated={entry.estimated_time_secs}
                actual={entry.duration_secs}
                format={(v) => formatDuration(v)}
              />
              <EstimateVsActualBar
                label="Filamento"
                icon={<Weight className="w-4 h-4 text-muted-foreground" />}
                estimated={entry.estimated_weight_g}
                actual={entry.actual_weight_g}
                format={(v) => `${v.toFixed(1)} g`}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DataCard({
  icon,
  label,
  value,
  mono,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card/40 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className={cn("mt-0.5 text-sm text-foreground truncate", mono && "font-mono")}>
        {value}
      </div>
    </div>
  );
}
