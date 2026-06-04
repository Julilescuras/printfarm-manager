"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  RotateCcw, AlertTriangle, CheckCircle, Clock, History,
  X, Plus, Trash2, Pencil, Wrench,
} from "lucide-react";
import { api } from "@/lib/api";
import { useWSContext } from "@/providers/websocket-provider";
import type { MaintenanceRecord, MaintenanceLog } from "@/lib/types";
import { formatHours } from "@/lib/utils";

// ── Predefined types ───────────────────────────────────────────────────────
const PREDEFINED: Record<string, { label: string; icon: string; description: string; bowdenOnly?: boolean }> = {
  nozzle_change:   { label: "Cambio de Boquilla",      icon: "🔧", description: "Reemplazar la boquilla del hotend" },
  belt_tension:    { label: "Tensión de Correas",       icon: "⚙️", description: "Verificar y ajustar tensión de correas X/Y" },
  lubrication:     { label: "Lubricación de Ejes",      icon: "🛢️", description: "Lubricar ejes y varillas lineales" },
  bed_leveling:    { label: "Nivelación de Cama",       icon: "📐", description: "Verificar y ajustar nivelación de la cama" },
  bed_cleaning:    { label: "Limpieza de Cama",         icon: "🧹", description: "Limpiar la superficie de impresión" },
  ptfe_tube:       { label: "Tubo PTFE/Bowden",         icon: "🪈", description: "Inspeccionar y reemplazar el tubo Bowden", bowdenOnly: true },
  extruder_gears:  { label: "Engranajes del Extrusor",  icon: "⚙️", description: "Limpiar y revisar los engranajes" },
  hotend_cleaning: { label: "Limpieza de Hotend",       icon: "🔥", description: "Cold pull y limpieza interna del hotend" },
  z_screw_lube:    { label: "Lubricación Husillo Z",    icon: "🪛", description: "Lubricar el husillo trapezoidal del eje Z" },
  firmware_check:  { label: "Revisión de Firmware",     icon: "💾", description: "Verificar y actualizar el firmware" },
  general:         { label: "Mantenimiento General",    icon: "🔩", description: "Revisión general de la impresora" },
};

function getDisplay(record: MaintenanceRecord) {
  const pre = PREDEFINED[record.maintenance_type];
  return {
    label:       record.custom_label       || pre?.label       || record.maintenance_type,
    icon:        record.custom_icon        || pre?.icon        || "🔧",
    description: record.custom_description || pre?.description || "",
    bowdenOnly:  !record.custom_label && !!pre?.bowdenOnly,
  };
}

// ── Record Form Modal (add / edit) ─────────────────────────────────────────
function RecordFormModal({
  printerId, existingTypes, record, onConfirm, onClose,
}: {
  printerId: number;
  existingTypes: string[];
  record?: MaintenanceRecord;
  onConfirm: (data: { maintenance_type: string; threshold_hours: number; custom_label: string; custom_icon: string; custom_description: string }) => void;
  onClose: () => void;
}) {
  const isEdit = !!record;
  const isCustomType = record?.maintenance_type === "custom";

  const availablePredefined = Object.entries(PREDEFINED).filter(
    ([key]) => !existingTypes.includes(key) || record?.maintenance_type === key
  );

  const [mode, setMode] = useState<"predefined" | "custom">(isCustomType ? "custom" : "predefined");
  const [selectedType, setSelectedType] = useState(
    isEdit && !isCustomType ? record!.maintenance_type : (availablePredefined[0]?.[0] || "general")
  );
  const [threshold, setThreshold] = useState(record?.threshold_hours.toString() || "200");
  const display = record ? getDisplay(record) : null;
  const [customLabel, setCustomLabel] = useState(display?.label || "");
  const [customIcon, setCustomIcon] = useState(display?.icon || "🔧");
  const [customDesc, setCustomDesc] = useState(display?.description || "");

  const isCustomMode = mode === "custom";

  const handleSubmit = () => {
    const hours = parseFloat(threshold);
    if (!hours || hours <= 0) return;
    if (isCustomMode && !customLabel.trim()) return;
    onConfirm({
      maintenance_type: isCustomMode ? "custom" : selectedType,
      threshold_hours: hours,
      custom_label: isCustomMode ? customLabel.trim() : (isEdit && record!.custom_label ? customLabel.trim() : ""),
      custom_icon: isCustomMode ? customIcon.trim() : (isEdit && record!.custom_icon ? customIcon.trim() : ""),
      custom_description: isCustomMode ? customDesc.trim() : (isEdit && record!.custom_description ? customDesc.trim() : ""),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass-card w-full max-w-md mx-4 p-6 space-y-4 max-h-[90vh] overflow-y-auto custom-scrollbar">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">{isEdit ? "Editar tarea" : "Nueva tarea de mantenimiento"}</h2>
          <button onClick={onClose} className="p-2 hover:bg-secondary rounded-lg transition-colors"><X className="w-4 h-4" /></button>
        </div>

        {!isEdit && (
          <div className="flex gap-1 p-1 bg-secondary/50 rounded-lg">
            {(["predefined", "custom"] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)}
                className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-all ${mode === m ? "bg-card shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {m === "predefined" ? "Predefinida" : "Personalizada"}
              </button>
            ))}
          </div>
        )}

        {!isCustomMode && !isEdit && availablePredefined.length > 0 && (
          <div>
            <label className="block text-sm font-medium mb-1.5">Tipo</label>
            <div className="space-y-1 max-h-48 overflow-y-auto custom-scrollbar pr-1">
              {availablePredefined.map(([key, val]) => (
                <button key={key} onClick={() => setSelectedType(key)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left text-sm border transition-all ${
                    selectedType === key ? "bg-primary/15 border-primary/40" : "bg-secondary/40 border-transparent hover:bg-secondary text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span className="text-lg shrink-0">{val.icon}</span>
                  <div>
                    <div className="font-medium text-xs">{val.label}</div>
                    <div className="text-xs opacity-70">{val.description}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {!isCustomMode && isEdit && (
          <div className="bg-secondary/40 rounded-lg px-3 py-2 text-sm">
            <span className="text-lg mr-2">{display!.icon}</span>
            <span className="font-medium">{display!.label}</span>
            <p className="text-xs text-muted-foreground mt-0.5">{display!.description}</p>
          </div>
        )}

        {isCustomMode && (
          <div className="space-y-3">
            <div className="grid grid-cols-[60px_1fr] gap-2">
              <div>
                <label className="block text-xs font-medium mb-1">Ícono</label>
                <input type="text" value={customIcon} onChange={(e) => setCustomIcon(e.target.value)} maxLength={4}
                  placeholder="🔧"
                  className="w-full px-2 py-2 rounded-lg bg-secondary border border-border focus:border-primary outline-none text-center text-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Nombre *</label>
                <input type="text" value={customLabel} onChange={(e) => setCustomLabel(e.target.value)}
                  placeholder="Ej: Limpieza extrusor"
                  className="w-full px-3 py-2 rounded-lg bg-secondary border border-border focus:border-primary outline-none text-sm"
                  autoFocus
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Descripción</label>
              <input type="text" value={customDesc} onChange={(e) => setCustomDesc(e.target.value)}
                placeholder="Descripción breve..."
                className="w-full px-3 py-2 rounded-lg bg-secondary border border-border focus:border-primary outline-none text-sm"
              />
            </div>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-1.5">Umbral de alerta (horas)</label>
          <input type="number" min={1} step={10} value={threshold} onChange={(e) => setThreshold(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-secondary border border-border focus:border-primary outline-none text-sm"
          />
          <p className="text-xs text-muted-foreground mt-1">Alerta cuando el contador llegue a este valor.</p>
        </div>

        <div className="flex gap-3 pt-1">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg bg-secondary text-sm font-medium hover:bg-secondary/80 transition-colors">Cancelar</button>
          <button onClick={handleSubmit} disabled={isCustomMode && !customLabel.trim()}
            className="flex-1 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {isEdit ? "Guardar" : "Agregar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Reset Modal ────────────────────────────────────────────────────────────
function ResetModal({ record, printerName, onConfirm, onClose }: {
  record: MaintenanceRecord; printerName: string;
  onConfirm: (note: string) => void; onClose: () => void;
}) {
  const [note, setNote] = useState("");
  const { label, icon } = getDisplay(record);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass-card w-full max-w-md mx-4 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Confirmar Reset</h2>
          <button onClick={onClose} className="p-2 hover:bg-secondary rounded-lg transition-colors"><X className="w-4 h-4" /></button>
        </div>
        <div className="bg-secondary/50 rounded-lg p-4">
          <div className="text-sm font-medium">{icon} {label}</div>
          <div className="text-xs text-muted-foreground">{printerName} · {formatHours(record.accumulated_hours)} acumuladas</div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">Nota (opcional)</label>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3}
            placeholder="Ej: Se cambió boquilla 0.4mm..."
            className="w-full px-3 py-2 rounded-lg bg-secondary border border-border focus:border-primary outline-none resize-none text-sm"
          />
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg bg-secondary text-sm font-medium">Cancelar</button>
          <button onClick={() => onConfirm(note)} className="flex-1 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold">
            <RotateCcw className="w-3.5 h-3.5 inline mr-1.5" /> Resetear
          </button>
        </div>
      </div>
    </div>
  );
}

// ── History Modal ──────────────────────────────────────────────────────────
function HistoryModal({ record, printerName, onClose }: {
  record: MaintenanceRecord; printerName: string; onClose: () => void;
}) {
  const [logs, setLogs] = useState<MaintenanceLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { label, icon } = getDisplay(record);

  useEffect(() => {
    api.getMaintenanceHistory(record.id).then(setLogs).catch(console.error).finally(() => setIsLoading(false));
  }, [record.id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass-card w-full max-w-lg mx-4 p-6 space-y-4 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between shrink-0">
          <h2 className="text-lg font-bold flex items-center gap-2"><History className="w-5 h-5 text-primary" /> Historial</h2>
          <button onClick={onClose} className="p-2 hover:bg-secondary rounded-lg transition-colors"><X className="w-4 h-4" /></button>
        </div>
        <div className="bg-secondary/50 rounded-lg px-4 py-3 shrink-0">
          <div className="text-sm font-medium">{icon} {label}</div>
          <div className="text-xs text-muted-foreground">{printerName}</div>
        </div>
        <div className="overflow-y-auto flex-1 space-y-2 pr-1 custom-scrollbar">
          {isLoading ? (
            <div className="py-8 text-center text-muted-foreground text-sm animate-pulse">Cargando...</div>
          ) : logs.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">Sin resets aún.</div>
          ) : logs.map((log) => (
            <div key={log.id} className="rounded-lg border border-border bg-secondary/30 p-3 space-y-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock className="w-3 h-3" /> {new Date(log.reset_at).toLocaleString("es-AR")}
                </div>
                <span className="text-xs font-mono text-primary">{log.hours_at_reset.toFixed(1)}h al resetear</span>
              </div>
              {log.note ? <p className="text-sm">{log.note}</p> : <p className="text-xs text-muted-foreground italic">Sin nota</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────
export default function MaintenancePage() {
  const [records, setRecords] = useState<MaintenanceRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedPrinterId, setSelectedPrinterId] = useState<number | null>(null);
  const [resetTarget, setResetTarget] = useState<MaintenanceRecord | null>(null);
  const [historyTarget, setHistoryTarget] = useState<MaintenanceRecord | null>(null);
  const [editTarget, setEditTarget] = useState<MaintenanceRecord | null>(null);
  const [addingForPrinter, setAddingForPrinter] = useState<number | null>(null);
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

  // Auto-select first printer with alerts, or first printer
  useEffect(() => {
    if (printers.length === 0 || selectedPrinterId !== null) return;
    const withAlert = printers.find((p) =>
      records.some((r) => r.printer_id === p.id && r.is_alert_active)
    );
    setSelectedPrinterId(withAlert?.id ?? printers[0]?.id ?? null);
  }, [printers, records, selectedPrinterId]);

  const handleReset = async (record: MaintenanceRecord, note: string) => {
    await api.resetMaintenance(record.id, note || undefined);
    setResetTarget(null);
    fetchRecords();
  };

  const handleEdit = async (record: MaintenanceRecord, data: any) => {
    await api.updateMaintenance(record.id, data);
    setEditTarget(null);
    fetchRecords();
  };

  const handleAdd = async (printerId: number, data: any) => {
    await api.createMaintenance({ printer_id: printerId, ...data });
    setAddingForPrinter(null);
    fetchRecords();
  };

  const handleDelete = async (record: MaintenanceRecord) => {
    const { label } = getDisplay(record);
    if (!window.confirm(`¿Eliminar "${label}"? Se borrará su historial también.`)) return;
    await api.deleteMaintenance(record.id);
    fetchRecords();
  };

  const alertCount = records.filter((r) => r.is_alert_active).length;
  const selectedPrinter = printers.find((p) => p.id === selectedPrinterId);
  const selectedRecords = records.filter((r) => r.printer_id === selectedPrinterId);
  const selectedAlerts = selectedRecords.filter((r) => r.is_alert_active).length;

  return (
    <div className="space-y-4 h-full">
      {/* Page header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gradient">Mantenimiento</h1>
          <p className="text-sm text-muted-foreground mt-1">Contadores de uso y alertas preventivas</p>
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

      {/* Two-column layout */}
      <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4 items-start">

        {/* ── Left: printer list ── */}
        <div className="space-y-2">
          {printers.map((printer) => {
            const printerRecords = records.filter((r) => r.printer_id === printer.id);
            const alerts = printerRecords.filter((r) => r.is_alert_active).length;
            const isSelected = printer.id === selectedPrinterId;
            const lifetimeH = printer.lifetime_print_seconds / 3600;

            return (
              <button
                key={printer.id}
                onClick={() => setSelectedPrinterId(printer.id)}
                className={`w-full text-left p-4 rounded-xl border transition-all ${
                  isSelected
                    ? "bg-primary/10 border-primary/40 shadow-md"
                    : "bg-card/60 border-border hover:bg-card hover:border-border/80"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className={`font-semibold text-sm truncate ${isSelected ? "text-primary" : ""}`}>
                      {printer.name}
                    </h3>
                    <p className="text-xs text-muted-foreground truncate">{printer.model}</p>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <span className={`text-xs font-medium ${printer.extruder_type === "bowden" ? "text-amber-400" : "text-primary/80"}`}>
                        {printer.extruder_type === "bowden" ? "Bowden" : "Direct Drive"}
                      </span>
                      <span className="text-xs text-muted-foreground font-mono">{formatHours(lifetimeH)}</span>
                    </div>
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-1">
                    {alerts > 0 ? (
                      <span className="flex items-center gap-1 text-xs font-medium text-amber-400 bg-amber-500/15 px-2 py-0.5 rounded-full border border-amber-500/30">
                        <AlertTriangle className="w-3 h-3" /> {alerts}
                      </span>
                    ) : (
                      <CheckCircle className="w-4 h-4 text-primary/60" />
                    )}
                    <span className="text-xs text-muted-foreground">{printerRecords.length} tareas</span>
                  </div>
                </div>

                {/* Mini progress bars — top 3 most urgent */}
                {printerRecords.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {printerRecords
                      .sort((a, b) => (b.accumulated_hours / b.threshold_hours) - (a.accumulated_hours / a.threshold_hours))
                      .slice(0, 3)
                      .map((r) => {
                        const pct = Math.min((r.accumulated_hours / r.threshold_hours) * 100, 100);
                        const { icon } = getDisplay(r);
                        return (
                          <div key={r.id} className="flex items-center gap-1.5">
                            <span className="text-xs">{icon}</span>
                            <div className="flex-1 h-1 rounded-full bg-secondary overflow-hidden">
                              <div
                                className={`h-full rounded-full ${r.is_alert_active ? "bg-amber-500" : pct > 75 ? "bg-amber-400" : "bg-primary"}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="text-xs font-mono text-muted-foreground w-7 text-right">{pct.toFixed(0)}%</span>
                          </div>
                        );
                      })}
                  </div>
                )}
              </button>
            );
          })}

          {!isLoading && printers.length === 0 && (
            <div className="glass-card p-8 text-center">
              <Wrench className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">Sin impresoras</p>
            </div>
          )}
        </div>

        {/* ── Right: task detail panel ── */}
        <div className="glass-card overflow-hidden">
          {!selectedPrinter ? (
            <div className="p-16 text-center text-muted-foreground">
              <Wrench className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Seleccioná una impresora</p>
            </div>
          ) : (
            <>
              {/* Panel header */}
              <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                <div>
                  <h2 className="font-semibold">{selectedPrinter.name}</h2>
                  <p className="text-xs text-muted-foreground">
                    {selectedPrinter.model} · {formatHours(selectedPrinter.lifetime_print_seconds / 3600)} de vida total
                    {selectedAlerts > 0 && (
                      <span className="ml-2 text-amber-400 font-medium">· {selectedAlerts} alerta{selectedAlerts !== 1 ? "s" : ""}</span>
                    )}
                  </p>
                </div>
                <button
                  onClick={() => setAddingForPrinter(selectedPrinter.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/15 text-primary text-xs font-medium hover:bg-primary/25 transition-colors border border-primary/30"
                >
                  <Plus className="w-3.5 h-3.5" /> Agregar tarea
                </button>
              </div>

              {/* Task list */}
              {selectedRecords.length === 0 ? (
                <div className="p-12 text-center text-muted-foreground">
                  <p className="text-sm">Sin tareas de mantenimiento</p>
                  <button onClick={() => setAddingForPrinter(selectedPrinter.id)} className="mt-3 text-xs text-primary hover:underline">
                    + Agregar primera tarea
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {selectedRecords.map((record) => {
                    const { label, icon, description, bowdenOnly } = getDisplay(record);
                    const isAlert = record.is_alert_active;
                    const pct = Math.min((record.accumulated_hours / record.threshold_hours) * 100, 100);
                    const remaining = Math.max(record.threshold_hours - record.accumulated_hours, 0);

                    return (
                      <div key={record.id} className={`px-5 py-4 flex items-start gap-4 ${isAlert ? "bg-amber-500/5" : ""}`}>
                        <div className="text-2xl shrink-0 mt-0.5">{icon}</div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                            <h4 className="text-sm font-medium">{label}</h4>
                            {bowdenOnly && (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">Bowden</span>
                            )}
                            {record.maintenance_type === "custom" && (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">Custom</span>
                            )}
                            {isAlert && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 font-medium">⚠️ Atención</span>
                            )}
                          </div>
                          {description && <p className="text-xs text-muted-foreground mb-2">{description}</p>}

                          <div>
                            <div className="flex justify-between text-xs text-muted-foreground mb-1">
                              <span className="font-mono">{formatHours(record.accumulated_hours)} / {formatHours(record.threshold_hours)}</span>
                              <span className="font-mono">{pct.toFixed(0)}%</span>
                            </div>
                            <div className="w-full h-1.5 rounded-full bg-secondary overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-500 ${isAlert ? "bg-amber-500" : pct > 75 ? "bg-amber-400" : "bg-primary"}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <div className="mt-1 text-xs">
                              {isAlert
                                ? <span className="text-amber-400 font-medium">Umbral superado — realizar mantenimiento</span>
                                : <span className={remaining < record.threshold_hours * 0.25 ? "text-amber-400" : "text-muted-foreground/60"}>
                                    Quedan {formatHours(remaining)}
                                  </span>
                              }
                            </div>
                          </div>

                          {record.last_reset_at && (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1.5">
                              <Clock className="w-3 h-3" />
                              Último reset: {new Date(record.last_reset_at).toLocaleDateString("es-AR")}
                              {record.last_reset_note && (
                                <span className="ml-1 italic truncate max-w-[240px] opacity-70">— {record.last_reset_note}</span>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex gap-1.5 shrink-0 flex-wrap justify-end">
                          <button
                            onClick={() => setResetTarget(record)}
                            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                              isAlert
                                ? "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 border border-amber-500/30"
                                : "bg-secondary text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            <RotateCcw className="w-3 h-3" /> Reset
                          </button>
                          <button onClick={() => setEditTarget(record)}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <Pencil className="w-3 h-3" /> Editar
                          </button>
                          <button onClick={() => setHistoryTarget(record)}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <History className="w-3 h-3" /> Historial
                          </button>
                          <button onClick={() => handleDelete(record)}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-secondary text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Modals */}
      {resetTarget && (
        <ResetModal
          record={resetTarget}
          printerName={printers.find((p) => p.id === resetTarget.printer_id)?.name || ""}
          onConfirm={(note) => handleReset(resetTarget, note)}
          onClose={() => setResetTarget(null)}
        />
      )}
      {editTarget && (
        <RecordFormModal
          printerId={editTarget.printer_id}
          existingTypes={records.filter((r) => r.printer_id === editTarget.printer_id).map((r) => r.maintenance_type)}
          record={editTarget}
          onConfirm={(data) => handleEdit(editTarget, data)}
          onClose={() => setEditTarget(null)}
        />
      )}
      {addingForPrinter !== null && (
        <RecordFormModal
          printerId={addingForPrinter}
          existingTypes={records.filter((r) => r.printer_id === addingForPrinter).map((r) => r.maintenance_type)}
          onConfirm={(data) => handleAdd(addingForPrinter, data)}
          onClose={() => setAddingForPrinter(null)}
        />
      )}
      {historyTarget && (
        <HistoryModal
          record={historyTarget}
          printerName={printers.find((p) => p.id === historyTarget.printer_id)?.name || ""}
          onClose={() => setHistoryTarget(null)}
        />
      )}
    </div>
  );
}
