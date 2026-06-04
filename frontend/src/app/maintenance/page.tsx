"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Wrench,
  RotateCcw,
  AlertTriangle,
  CheckCircle,
  Clock,
  History,
  X,
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
  Pencil,
} from "lucide-react";
import { api } from "@/lib/api";
import { useWSContext } from "@/providers/websocket-provider";
import type { MaintenanceRecord, MaintenanceLog } from "@/lib/types";
import { formatHours } from "@/lib/utils";

const MAINTENANCE_LABELS: Record<
  string,
  { label: string; icon: string; description: string; bowdenOnly?: boolean }
> = {
  nozzle_change: {
    label: "Cambio de Boquilla",
    icon: "🔧",
    description: "Reemplazar la boquilla del hotend",
  },
  belt_tension: {
    label: "Tensión de Correas",
    icon: "⚙️",
    description: "Verificar y ajustar tensión de correas X/Y",
  },
  lubrication: {
    label: "Lubricación de Ejes",
    icon: "🛢️",
    description: "Lubricar ejes y varillas lineales",
  },
  bed_leveling: {
    label: "Nivelación de Cama",
    icon: "📐",
    description: "Verificar y ajustar nivelación de la cama de impresión",
  },
  bed_cleaning: {
    label: "Limpieza de Cama",
    icon: "🧹",
    description: "Limpiar la superficie de impresión (vidrio, PEI, etc.)",
  },
  ptfe_tube: {
    label: "Tubo PTFE/Bowden",
    icon: "🪈",
    description: "Inspeccionar y reemplazar el tubo de teflón Bowden",
    bowdenOnly: true,
  },
  extruder_gears: {
    label: "Engranajes del Extrusor",
    icon: "⚙️",
    description: "Limpiar y revisar los engranajes del extrusor",
  },
  hotend_cleaning: {
    label: "Limpieza de Hotend",
    icon: "🔥",
    description: "Cold pull y limpieza interna del hotend",
  },
  z_screw_lube: {
    label: "Lubricación Husillo Z",
    icon: "🪛",
    description: "Lubricar el husillo trapezoidal del eje Z",
  },
  firmware_check: {
    label: "Revisión de Firmware",
    icon: "💾",
    description: "Verificar y actualizar el firmware de la impresora",
  },
  general: {
    label: "Mantenimiento General",
    icon: "🔩",
    description: "Revisión general de la impresora",
  },
};

// ── Reset Modal ────────────────────────────────────────────────────────────
function ResetModal({
  record,
  printerName,
  onConfirm,
  onClose,
}: {
  record: MaintenanceRecord;
  printerName: string;
  onConfirm: (note: string) => void;
  onClose: () => void;
}) {
  const [note, setNote] = useState("");
  const info = MAINTENANCE_LABELS[record.maintenance_type] || MAINTENANCE_LABELS.general;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass-card w-full max-w-md mx-4 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Confirmar Reset</h2>
          <button onClick={onClose} className="p-2 hover:bg-secondary rounded-lg transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="bg-secondary/50 rounded-lg p-4 space-y-1">
          <div className="text-sm font-medium">
            {info.icon} {info.label}
          </div>
          <div className="text-xs text-muted-foreground">
            {printerName} · {formatHours(record.accumulated_hours)} acumuladas
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">
            Nota (opcional)
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ej: Se cambió boquilla 0.4mm por 0.6mm, se usó lubricante XYZ..."
            rows={3}
            className="w-full px-3 py-2 rounded-lg bg-secondary border border-border focus:border-primary outline-none resize-none text-sm"
          />
        </div>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg bg-secondary text-sm font-medium hover:bg-secondary/80 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={() => onConfirm(note)}
            className="flex-1 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5 inline mr-1.5" />
            Resetear
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Edit Threshold Modal ───────────────────────────────────────────────────
function EditThresholdModal({
  record,
  onConfirm,
  onClose,
}: {
  record: MaintenanceRecord;
  onConfirm: (hours: number) => void;
  onClose: () => void;
}) {
  const [hours, setHours] = useState(record.threshold_hours.toString());
  const info = MAINTENANCE_LABELS[record.maintenance_type] || MAINTENANCE_LABELS.general;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass-card w-full max-w-sm mx-4 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Editar Umbral</h2>
          <button onClick={onClose} className="p-2 hover:bg-secondary rounded-lg transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-sm text-muted-foreground">{info.icon} {info.label}</p>
        <div>
          <label className="block text-sm font-medium mb-1.5">Umbral (horas)</label>
          <input
            type="number"
            min={1}
            step={10}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-secondary border border-border focus:border-primary outline-none text-sm"
            autoFocus
          />
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg bg-secondary text-sm font-medium hover:bg-secondary/80 transition-colors">
            Cancelar
          </button>
          <button
            onClick={() => { const v = parseFloat(hours); if (v > 0) onConfirm(v); }}
            className="flex-1 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Add Record Modal ───────────────────────────────────────────────────────
function AddRecordModal({
  printerId,
  existingTypes,
  onConfirm,
  onClose,
}: {
  printerId: number;
  existingTypes: string[];
  onConfirm: (type: string, threshold: number) => void;
  onClose: () => void;
}) {
  const available = Object.entries(MAINTENANCE_LABELS).filter(
    ([key]) => !existingTypes.includes(key)
  );
  const [type, setType] = useState(available[0]?.[0] || "general");
  const [threshold, setThreshold] = useState("200");

  if (available.length === 0) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="glass-card w-full max-w-sm mx-4 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">Nueva Tarea</h2>
            <button onClick={onClose} className="p-2 hover:bg-secondary rounded-lg transition-colors"><X className="w-4 h-4" /></button>
          </div>
          <p className="text-sm text-muted-foreground">Ya están configuradas todas las tareas de mantenimiento disponibles.</p>
          <button onClick={onClose} className="w-full py-2 rounded-lg bg-secondary text-sm font-medium">Cerrar</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass-card w-full max-w-md mx-4 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Nueva Tarea de Mantenimiento</h2>
          <button onClick={onClose} className="p-2 hover:bg-secondary rounded-lg transition-colors"><X className="w-4 h-4" /></button>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">Tipo de mantenimiento</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-secondary border border-border focus:border-primary outline-none text-sm"
          >
            {available.map(([key, val]) => (
              <option key={key} value={key}>{val.icon} {val.label}</option>
            ))}
          </select>
          {type && MAINTENANCE_LABELS[type] && (
            <p className="text-xs text-muted-foreground mt-1">{MAINTENANCE_LABELS[type].description}</p>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">Umbral de alerta (horas)</label>
          <input
            type="number"
            min={1}
            step={10}
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-secondary border border-border focus:border-primary outline-none text-sm"
          />
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg bg-secondary text-sm font-medium hover:bg-secondary/80 transition-colors">Cancelar</button>
          <button
            onClick={() => { const v = parseFloat(threshold); if (v > 0) onConfirm(type, v); }}
            className="flex-1 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-3.5 h-3.5 inline mr-1.5" />
            Agregar
          </button>
        </div>
      </div>
    </div>
  );
}

// ── History Modal ──────────────────────────────────────────────────────────
function HistoryModal({
  record,
  printerName,
  onClose,
}: {
  record: MaintenanceRecord;
  printerName: string;
  onClose: () => void;
}) {
  const [logs, setLogs] = useState<MaintenanceLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const info = MAINTENANCE_LABELS[record.maintenance_type] || MAINTENANCE_LABELS.general;

  useEffect(() => {
    api.getMaintenanceHistory(record.id)
      .then(setLogs)
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, [record.id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass-card w-full max-w-lg mx-4 p-6 space-y-4 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between shrink-0">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <History className="w-5 h-5 text-primary" />
            Historial de Mantenimiento
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-secondary rounded-lg transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="bg-secondary/50 rounded-lg px-4 py-3 shrink-0">
          <div className="text-sm font-medium">{info.icon} {info.label}</div>
          <div className="text-xs text-muted-foreground">{printerName}</div>
        </div>

        <div className="overflow-y-auto flex-1 space-y-2 pr-1">
          {isLoading ? (
            <div className="py-8 text-center text-muted-foreground text-sm animate-pulse">
              Cargando historial...
            </div>
          ) : logs.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              No hay registros aún. Los resets aparecerán aquí.
            </div>
          ) : (
            logs.map((log) => (
              <div key={log.id} className="rounded-lg border border-border bg-secondary/30 p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="w-3 h-3" />
                    {new Date(log.reset_at).toLocaleString("es-AR")}
                  </div>
                  <span className="text-xs font-mono text-primary">
                    {log.hours_at_reset.toFixed(1)}h al resetear
                  </span>
                </div>
                {log.note ? (
                  <p className="text-sm text-foreground">{log.note}</p>
                ) : (
                  <p className="text-xs text-muted-foreground italic">Sin nota</p>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────
export default function MaintenancePage() {
  const [records, setRecords] = useState<MaintenanceRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [resetTarget, setResetTarget] = useState<MaintenanceRecord | null>(null);
  const [historyTarget, setHistoryTarget] = useState<MaintenanceRecord | null>(null);
  const [editThresholdTarget, setEditThresholdTarget] = useState<MaintenanceRecord | null>(null);
  const [addingForPrinter, setAddingForPrinter] = useState<number | null>(null);
  const [expandedPrinters, setExpandedPrinters] = useState<Set<number>>(new Set());
  const { printers } = useWSContext();

  const fetchRecords = useCallback(async () => {
    try {
      const data = await api.getMaintenance();
      setRecords(data);
    } catch (error) {
      console.error("Error fetching maintenance:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  useEffect(() => {
    const handler = () => fetchRecords();
    window.addEventListener("maintenance-updated", handler);
    return () => window.removeEventListener("maintenance-updated", handler);
  }, [fetchRecords]);

  // Auto-expand printers with active alerts
  useEffect(() => {
    if (records.length === 0) return;
    const printerIdsWithAlerts = new Set(
      records.filter((r) => r.is_alert_active).map((r) => r.printer_id)
    );
    if (printerIdsWithAlerts.size > 0) {
      setExpandedPrinters(printerIdsWithAlerts);
    }
  }, [records]);

  const handleReset = async (record: MaintenanceRecord, note: string) => {
    try {
      await api.resetMaintenance(record.id, note || undefined);
      setResetTarget(null);
      fetchRecords();
    } catch (error) {
      console.error("Error resetting maintenance:", error);
    }
  };

  const handleEditThreshold = async (record: MaintenanceRecord, hours: number) => {
    try {
      await api.updateMaintenance(record.id, { threshold_hours: hours });
      setEditThresholdTarget(null);
      fetchRecords();
    } catch (error) {
      console.error("Error updating threshold:", error);
    }
  };

  const handleDelete = async (record: MaintenanceRecord) => {
    const info = MAINTENANCE_LABELS[record.maintenance_type] || MAINTENANCE_LABELS.general;
    if (!window.confirm(`¿Eliminar "${info.label}"? Se borrarán también todos sus registros históricos.`)) return;
    try {
      await api.deleteMaintenance(record.id);
      fetchRecords();
    } catch (error) {
      console.error("Error deleting record:", error);
    }
  };

  const handleAddRecord = async (printerId: number, type: string, threshold: number) => {
    try {
      await api.createMaintenance({ printer_id: printerId, maintenance_type: type, threshold_hours: threshold });
      setAddingForPrinter(null);
      fetchRecords();
    } catch (error) {
      console.error("Error creating maintenance record:", error);
    }
  };

  const togglePrinter = (printerId: number) => {
    setExpandedPrinters((prev) => {
      const next = new Set(prev);
      if (next.has(printerId)) next.delete(printerId);
      else next.add(printerId);
      return next;
    });
  };

  const groupedByPrinter = printers.map((printer) => ({
    printer,
    records: records.filter((r) => r.printer_id === printer.id),
  }));

  const alertCount = records.filter((r) => r.is_alert_active).length;
  const getPrinterName = (printerId: number) =>
    printers.find((p) => p.id === printerId)?.name || `Impresora #${printerId}`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gradient">Mantenimiento</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Contadores de uso y alertas de mantenimiento preventivo
          </p>
        </div>
        {alertCount > 0 && (
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500/20 border border-amber-500/30">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <span className="text-sm font-medium text-amber-400">
              {alertCount} alerta{alertCount !== 1 ? "s" : ""} activa{alertCount !== 1 ? "s" : ""}
            </span>
          </div>
        )}
      </div>

      {/* Printer cards */}
      <div className="space-y-4">
        {groupedByPrinter.map(({ printer, records: printerRecords }) => {
          const isExpanded = expandedPrinters.has(printer.id);
          const hasAlert = printerRecords.some((r) => r.is_alert_active);
          const lifetimeHours = printer.lifetime_print_seconds / 3600;

          return (
            <div key={printer.id} className="glass-card overflow-hidden">
              {/* Printer header */}
              <button
                onClick={() => togglePrinter(printer.id)}
                className="w-full px-5 py-4 border-b border-border flex items-center justify-between hover:bg-white/5 transition-colors"
              >
                <div className="flex items-center gap-3 text-left">
                  <div>
                    <h3 className="font-semibold">{printer.name}</h3>
                    <p className="text-xs text-muted-foreground">
                      {printer.model} ·{" "}
                      <span className={printer.extruder_type === "bowden" ? "text-amber-400" : "text-primary"}>
                        {printer.extruder_type === "bowden" ? "Bowden" : "Direct Drive"}
                      </span>
                      {" · "}
                      <span className="font-mono">{formatHours(lifetimeHours)}</span>
                      {" "}de vida total
                      {printerRecords.length > 0 && (
                        <span className="ml-2 text-muted-foreground/60">
                          · {printerRecords.length} tarea{printerRecords.length !== 1 ? "s" : ""}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {hasAlert ? (
                    <AlertTriangle className="w-5 h-5 text-amber-400" />
                  ) : (
                    <CheckCircle className="w-5 h-5 text-primary" />
                  )}
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
              </button>

              {/* Maintenance records */}
              {isExpanded && (
                <div className="divide-y divide-border">
                  {printerRecords.map((record) => {
                    const info = MAINTENANCE_LABELS[record.maintenance_type] || MAINTENANCE_LABELS.general;
                    const percentage = Math.min(
                      (record.accumulated_hours / record.threshold_hours) * 100,
                      100
                    );
                    const remaining = Math.max(record.threshold_hours - record.accumulated_hours, 0);
                    const isAlert = record.is_alert_active;

                    return (
                      <div
                        key={record.id}
                        className={`px-5 py-4 flex items-start gap-4 ${isAlert ? "bg-amber-500/5" : ""}`}
                      >
                        {/* Icon */}
                        <div className="text-2xl shrink-0 mt-0.5">{info.icon}</div>

                        {/* Info + Progress */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                            <h4 className="text-sm font-medium">{info.label}</h4>
                            {info.bowdenOnly && (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                Bowden
                              </span>
                            )}
                            {isAlert && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 font-medium">
                                ⚠️ Atención requerida
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mb-2">{info.description}</p>

                          {/* Progress bar */}
                          <div>
                            <div className="flex justify-between text-xs text-muted-foreground mb-1">
                              <span className="font-mono">
                                {formatHours(record.accumulated_hours)} / {formatHours(record.threshold_hours)}
                              </span>
                              <span className="font-mono">{percentage.toFixed(0)}%</span>
                            </div>
                            <div className="w-full h-2 rounded-full bg-secondary overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-500 ${
                                  isAlert ? "bg-amber-500" : percentage > 75 ? "bg-amber-400" : "bg-primary"
                                }`}
                                style={{ width: `${percentage}%` }}
                              />
                            </div>
                            {/* Remaining hours */}
                            <div className="mt-1 text-xs">
                              {isAlert ? (
                                <span className="text-amber-400 font-medium">Umbral superado — realizar mantenimiento</span>
                              ) : (
                                <span className={remaining < record.threshold_hours * 0.25 ? "text-amber-400" : "text-muted-foreground/70"}>
                                  Quedan {formatHours(remaining)}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Last reset */}
                          {record.last_reset_at && (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1.5">
                              <Clock className="w-3 h-3" />
                              Último reset:{" "}
                              {new Date(record.last_reset_at).toLocaleDateString("es-AR")}
                              {record.last_reset_note && (
                                <span className="ml-1 text-foreground/60 italic truncate max-w-[200px]">
                                  — {record.last_reset_note}
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex flex-col gap-1.5 shrink-0">
                          <button
                            onClick={() => setResetTarget(record)}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                              isAlert
                                ? "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 border border-amber-500/30"
                                : "bg-secondary text-muted-foreground hover:text-foreground hover:bg-secondary/80"
                            }`}
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            Reset
                          </button>
                          <button
                            onClick={() => setEditThresholdTarget(record)}
                            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-muted-foreground hover:text-foreground bg-secondary/50 hover:bg-secondary transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            Umbral
                          </button>
                          <button
                            onClick={() => setHistoryTarget(record)}
                            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-muted-foreground hover:text-foreground bg-secondary/50 hover:bg-secondary transition-colors"
                          >
                            <History className="w-3.5 h-3.5" />
                            Historial
                          </button>
                          <button
                            onClick={() => handleDelete(record)}
                            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-muted-foreground hover:text-red-400 bg-secondary/50 hover:bg-red-500/10 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Eliminar
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {/* Add record button */}
                  <div className="px-5 py-3">
                    <button
                      onClick={() => setAddingForPrinter(printer.id)}
                      className="flex items-center gap-2 text-xs text-muted-foreground hover:text-primary transition-colors py-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Agregar tarea de mantenimiento
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {!isLoading && printers.length === 0 && (
          <div className="glass-card p-12 text-center">
            <Wrench className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
            <p className="text-muted-foreground">No hay impresoras configuradas</p>
          </div>
        )}
      </div>

      {/* Modals */}
      {resetTarget && (
        <ResetModal
          record={resetTarget}
          printerName={getPrinterName(resetTarget.printer_id)}
          onConfirm={(note) => handleReset(resetTarget, note)}
          onClose={() => setResetTarget(null)}
        />
      )}
      {editThresholdTarget && (
        <EditThresholdModal
          record={editThresholdTarget}
          onConfirm={(hours) => handleEditThreshold(editThresholdTarget, hours)}
          onClose={() => setEditThresholdTarget(null)}
        />
      )}
      {historyTarget && (
        <HistoryModal
          record={historyTarget}
          printerName={getPrinterName(historyTarget.printer_id)}
          onClose={() => setHistoryTarget(null)}
        />
      )}
      {addingForPrinter !== null && (
        <AddRecordModal
          printerId={addingForPrinter}
          existingTypes={records.filter((r) => r.printer_id === addingForPrinter).map((r) => r.maintenance_type)}
          onConfirm={(type, threshold) => handleAddRecord(addingForPrinter, type, threshold)}
          onClose={() => setAddingForPrinter(null)}
        />
      )}
    </div>
  );
}
