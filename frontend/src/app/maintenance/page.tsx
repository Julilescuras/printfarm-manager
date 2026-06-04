"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  RotateCcw, AlertTriangle, CheckCircle, Clock, History,
  X, ChevronDown, ChevronUp, Plus, Trash2, Pencil, Wrench,
} from "lucide-react";
import { api } from "@/lib/api";
import { useWSContext } from "@/providers/websocket-provider";
import type { MaintenanceRecord, MaintenanceLog } from "@/lib/types";
import { formatHours } from "@/lib/utils";

// ── Predefined types ──────────────────────────────────────────────────────
const PREDEFINED: Record<string, { label: string; icon: string; description: string; bowdenOnly?: boolean }> = {
  nozzle_change:   { label: "Cambio de Boquilla",       icon: "🔧", description: "Reemplazar la boquilla del hotend" },
  belt_tension:    { label: "Tensión de Correas",        icon: "⚙️", description: "Verificar y ajustar tensión de correas X/Y" },
  lubrication:     { label: "Lubricación de Ejes",       icon: "🛢️", description: "Lubricar ejes y varillas lineales" },
  bed_leveling:    { label: "Nivelación de Cama",        icon: "📐", description: "Verificar y ajustar nivelación de la cama de impresión" },
  bed_cleaning:    { label: "Limpieza de Cama",          icon: "🧹", description: "Limpiar la superficie de impresión (vidrio, PEI, etc.)" },
  ptfe_tube:       { label: "Tubo PTFE/Bowden",          icon: "🪈", description: "Inspeccionar y reemplazar el tubo de teflón Bowden", bowdenOnly: true },
  extruder_gears:  { label: "Engranajes del Extrusor",   icon: "⚙️", description: "Limpiar y revisar los engranajes del extrusor" },
  hotend_cleaning: { label: "Limpieza de Hotend",        icon: "🔥", description: "Cold pull y limpieza interna del hotend" },
  z_screw_lube:    { label: "Lubricación Husillo Z",     icon: "🪛", description: "Lubricar el husillo trapezoidal del eje Z" },
  firmware_check:  { label: "Revisión de Firmware",      icon: "💾", description: "Verificar y actualizar el firmware de la impresora" },
  general:         { label: "Mantenimiento General",     icon: "🔩", description: "Revisión general de la impresora" },
};

// Resolves display values: custom fields override predefined, "custom" type uses custom exclusively
function getDisplay(record: MaintenanceRecord) {
  const pre = PREDEFINED[record.maintenance_type];
  return {
    label:       record.custom_label       || pre?.label       || record.maintenance_type,
    icon:        record.custom_icon        || pre?.icon        || "🔧",
    description: record.custom_description || pre?.description || "",
    bowdenOnly:  !record.custom_label && !!pre?.bowdenOnly,
  };
}

// ── Edit / Add Modal ───────────────────────────────────────────────────────
function RecordFormModal({
  printerId,
  existingTypes,
  record,
  onConfirm,
  onClose,
}: {
  printerId: number;
  existingTypes: string[];
  record?: MaintenanceRecord; // if editing
  onConfirm: (data: {
    maintenance_type: string;
    threshold_hours: number;
    custom_label: string;
    custom_icon: string;
    custom_description: string;
  }) => void;
  onClose: () => void;
}) {
  const isEdit = !!record;
  const display = record ? getDisplay(record) : null;

  const availablePredefined = Object.entries(PREDEFINED).filter(
    ([key]) => !existingTypes.includes(key) || record?.maintenance_type === key
  );

  // mode: "predefined" | "custom"
  const [mode, setMode] = useState<"predefined" | "custom">(
    !isEdit || record?.maintenance_type === "custom" ? (record?.maintenance_type === "custom" ? "custom" : "predefined") : "predefined"
  );
  const [selectedType, setSelectedType] = useState(
    isEdit && record!.maintenance_type !== "custom" ? record!.maintenance_type : (availablePredefined[0]?.[0] || "general")
  );
  const [threshold, setThreshold] = useState(record?.threshold_hours.toString() || "200");
  const [customLabel, setCustomLabel] = useState(display?.label || "");
  const [customIcon, setCustomIcon] = useState(display?.icon || "🔧");
  const [customDesc, setCustomDesc] = useState(display?.description || "");

  const handleSubmit = () => {
    const hours = parseFloat(threshold);
    if (!hours || hours <= 0) return;
    if (mode === "custom" && !customLabel.trim()) return;

    onConfirm({
      maintenance_type: mode === "custom" ? "custom" : selectedType,
      threshold_hours: hours,
      custom_label: mode === "custom" ? customLabel.trim() : (isEdit && record!.custom_label ? customLabel.trim() : ""),
      custom_icon: mode === "custom" ? customIcon.trim() : (isEdit && record!.custom_icon ? customIcon.trim() : ""),
      custom_description: mode === "custom" ? customDesc.trim() : (isEdit && record!.custom_description ? customDesc.trim() : ""),
    });
  };

  const isCustomMode = mode === "custom" || (isEdit && record!.maintenance_type === "custom");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass-card w-full max-w-md mx-4 p-6 space-y-4 max-h-[90vh] overflow-y-auto custom-scrollbar">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">{isEdit ? "Editar tarea" : "Nueva tarea de mantenimiento"}</h2>
          <button onClick={onClose} className="p-2 hover:bg-secondary rounded-lg transition-colors"><X className="w-4 h-4" /></button>
        </div>

        {/* Mode toggle — only on add, not when editing a custom type */}
        {!isEdit && (
          <div className="flex gap-1 p-1 bg-secondary/50 rounded-lg">
            <button
              onClick={() => setMode("predefined")}
              className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-all ${mode === "predefined" ? "bg-card shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              Predefinida
            </button>
            <button
              onClick={() => setMode("custom")}
              className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-all ${mode === "custom" ? "bg-card shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              Personalizada
            </button>
          </div>
        )}

        {/* Predefined picker */}
        {!isCustomMode && !isEdit && (
          <div>
            <label className="block text-sm font-medium mb-1.5">Tipo de mantenimiento</label>
            {availablePredefined.length === 0 ? (
              <p className="text-xs text-muted-foreground">Ya están configuradas todas las tareas predefinidas.</p>
            ) : (
              <div className="space-y-1 max-h-48 overflow-y-auto custom-scrollbar pr-1">
                {availablePredefined.map(([key, val]) => (
                  <button
                    key={key}
                    onClick={() => setSelectedType(key)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left text-sm transition-all border ${
                      selectedType === key
                        ? "bg-primary/15 border-primary/40 text-foreground"
                        : "bg-secondary/40 border-transparent hover:bg-secondary text-muted-foreground hover:text-foreground"
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
            )}
          </div>
        )}

        {/* Predefined edit — only show personalization fields */}
        {!isCustomMode && isEdit && (
          <div className="bg-secondary/40 rounded-lg px-3 py-2 text-sm">
            <span className="text-lg mr-2">{display!.icon}</span>
            <span className="font-medium">{display!.label}</span>
            <p className="text-xs text-muted-foreground mt-0.5">{display!.description}</p>
          </div>
        )}

        {/* Custom fields */}
        {isCustomMode && (
          <div className="space-y-3">
            <div className="grid grid-cols-[60px_1fr] gap-2">
              <div>
                <label className="block text-xs font-medium mb-1">Ícono</label>
                <input
                  type="text"
                  value={customIcon}
                  onChange={(e) => setCustomIcon(e.target.value)}
                  maxLength={4}
                  placeholder="🔧"
                  className="w-full px-2 py-2 rounded-lg bg-secondary border border-border focus:border-primary outline-none text-center text-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Nombre *</label>
                <input
                  type="text"
                  value={customLabel}
                  onChange={(e) => setCustomLabel(e.target.value)}
                  placeholder="Ej: Limpieza extrusor"
                  className="w-full px-3 py-2 rounded-lg bg-secondary border border-border focus:border-primary outline-none text-sm"
                  autoFocus
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Descripción</label>
              <input
                type="text"
                value={customDesc}
                onChange={(e) => setCustomDesc(e.target.value)}
                placeholder="Descripción breve de la tarea..."
                className="w-full px-3 py-2 rounded-lg bg-secondary border border-border focus:border-primary outline-none text-sm"
              />
            </div>
          </div>
        )}

        {/* Threshold — always shown */}
        <div>
          <label className="block text-sm font-medium mb-1.5">Umbral de alerta (horas de impresión)</label>
          <input
            type="number"
            min={1}
            step={10}
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-secondary border border-border focus:border-primary outline-none text-sm"
          />
          <p className="text-xs text-muted-foreground mt-1">Se activará una alerta cuando el contador llegue a este valor.</p>
        </div>

        <div className="flex gap-3 pt-1">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg bg-secondary text-sm font-medium hover:bg-secondary/80 transition-colors">
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={isCustomMode && !customLabel.trim()}
            className="flex-1 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {isEdit ? "Guardar cambios" : "Agregar"}
          </button>
        </div>
      </div>
    </div>
  );
}

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
  const { label, icon } = getDisplay(record);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass-card w-full max-w-md mx-4 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Confirmar Reset</h2>
          <button onClick={onClose} className="p-2 hover:bg-secondary rounded-lg transition-colors"><X className="w-4 h-4" /></button>
        </div>
        <div className="bg-secondary/50 rounded-lg p-4 space-y-1">
          <div className="text-sm font-medium">{icon} {label}</div>
          <div className="text-xs text-muted-foreground">{printerName} · {formatHours(record.accumulated_hours)} acumuladas</div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">Nota (opcional)</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ej: Se cambió boquilla 0.4mm, lubricante XYZ..."
            rows={3}
            className="w-full px-3 py-2 rounded-lg bg-secondary border border-border focus:border-primary outline-none resize-none text-sm"
          />
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg bg-secondary text-sm font-medium hover:bg-secondary/80 transition-colors">Cancelar</button>
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
  const { label, icon } = getDisplay(record);

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
            Historial
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-secondary rounded-lg transition-colors"><X className="w-4 h-4" /></button>
        </div>
        <div className="bg-secondary/50 rounded-lg px-4 py-3 shrink-0">
          <div className="text-sm font-medium">{icon} {label}</div>
          <div className="text-xs text-muted-foreground">{printerName}</div>
        </div>
        <div className="overflow-y-auto flex-1 space-y-2 pr-1">
          {isLoading ? (
            <div className="py-8 text-center text-muted-foreground text-sm animate-pulse">Cargando...</div>
          ) : logs.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">No hay resets aún.</div>
          ) : (
            logs.map((log) => (
              <div key={log.id} className="rounded-lg border border-border bg-secondary/30 p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="w-3 h-3" />
                    {new Date(log.reset_at).toLocaleString("es-AR")}
                  </div>
                  <span className="text-xs font-mono text-primary">{log.hours_at_reset.toFixed(1)}h al resetear</span>
                </div>
                {log.note
                  ? <p className="text-sm">{log.note}</p>
                  : <p className="text-xs text-muted-foreground italic">Sin nota</p>
                }
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
  const [editTarget, setEditTarget] = useState<MaintenanceRecord | null>(null);
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

  useEffect(() => {
    if (records.length === 0) return;
    const withAlerts = new Set(records.filter((r) => r.is_alert_active).map((r) => r.printer_id));
    if (withAlerts.size > 0) setExpandedPrinters(withAlerts);
  }, [records]);

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
    if (!window.confirm(`¿Eliminar "${label}"? Se borrará también su historial.`)) return;
    await api.deleteMaintenance(record.id);
    fetchRecords();
  };

  const togglePrinter = (id: number) => {
    setExpandedPrinters((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const groupedByPrinter = printers.map((printer) => ({
    printer,
    records: records.filter((r) => r.printer_id === printer.id),
  }));

  const alertCount = records.filter((r) => r.is_alert_active).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gradient">Mantenimiento</h1>
          <p className="text-sm text-muted-foreground mt-1">Contadores de uso y alertas de mantenimiento preventivo</p>
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

      <div className="space-y-4">
        {groupedByPrinter.map(({ printer, records: printerRecords }) => {
          const isExpanded = expandedPrinters.has(printer.id);
          const hasAlert = printerRecords.some((r) => r.is_alert_active);
          const lifetimeHours = printer.lifetime_print_seconds / 3600;

          return (
            <div key={printer.id} className="glass-card overflow-hidden">
              <button
                onClick={() => togglePrinter(printer.id)}
                className="w-full px-5 py-4 border-b border-border flex items-center justify-between hover:bg-white/5 transition-colors"
              >
                <div className="text-left">
                  <h3 className="font-semibold">{printer.name}</h3>
                  <p className="text-xs text-muted-foreground">
                    {printer.model} ·{" "}
                    <span className={printer.extruder_type === "bowden" ? "text-amber-400" : "text-primary"}>
                      {printer.extruder_type === "bowden" ? "Bowden" : "Direct Drive"}
                    </span>
                    {" · "}
                    <span className="font-mono">{formatHours(lifetimeHours)}</span> de vida total
                    <span className="text-muted-foreground/60 ml-2">
                      · {printerRecords.length} tarea{printerRecords.length !== 1 ? "s" : ""}
                    </span>
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {hasAlert
                    ? <AlertTriangle className="w-5 h-5 text-amber-400" />
                    : <CheckCircle className="w-5 h-5 text-primary" />
                  }
                  {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                </div>
              </button>

              {isExpanded && (
                <div className="divide-y divide-border">
                  {printerRecords.map((record) => {
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
                              <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">Personalizado</span>
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
                            <div className="w-full h-2 rounded-full bg-secondary overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-500 ${isAlert ? "bg-amber-500" : pct > 75 ? "bg-amber-400" : "bg-primary"}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <div className="mt-1 text-xs">
                              {isAlert
                                ? <span className="text-amber-400 font-medium">Umbral superado — realizar mantenimiento</span>
                                : <span className={remaining < record.threshold_hours * 0.25 ? "text-amber-400" : "text-muted-foreground/70"}>
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
                                <span className="ml-1 text-foreground/60 italic truncate max-w-[200px]">— {record.last_reset_note}</span>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="flex flex-col gap-1.5 shrink-0">
                          <button
                            onClick={() => setResetTarget(record)}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                              isAlert
                                ? "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 border border-amber-500/30"
                                : "bg-secondary text-muted-foreground hover:text-foreground hover:bg-secondary/80"
                            }`}
                          >
                            <RotateCcw className="w-3.5 h-3.5" /> Reset
                          </button>
                          <button
                            onClick={() => setEditTarget(record)}
                            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-muted-foreground hover:text-foreground bg-secondary/50 hover:bg-secondary transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5" /> Editar
                          </button>
                          <button
                            onClick={() => setHistoryTarget(record)}
                            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-muted-foreground hover:text-foreground bg-secondary/50 hover:bg-secondary transition-colors"
                          >
                            <History className="w-3.5 h-3.5" /> Historial
                          </button>
                          <button
                            onClick={() => handleDelete(record)}
                            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-muted-foreground hover:text-red-400 bg-secondary/50 hover:bg-red-500/10 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" /> Eliminar
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  <div className="px-5 py-3">
                    <button
                      onClick={() => setAddingForPrinter(printer.id)}
                      className="flex items-center gap-2 text-xs text-muted-foreground hover:text-primary transition-colors py-1"
                    >
                      <Plus className="w-3.5 h-3.5" /> Agregar tarea de mantenimiento
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
