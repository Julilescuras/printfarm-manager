"use client";

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  Plus,
  Upload,
  X,
  Printer,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  RotateCcw,
  Trash2,
  FileCode,
  Pencil,
  GripVertical,
  Clock,
  Weight,
  CheckCircle,
  XCircle,
  History,
  Copy,
  ChevronDown,
  Check,
  Search,
} from "lucide-react";
import { api } from "@/lib/api";
import type { PrintJob } from "@/lib/types";
import { useWSContext } from "@/providers/websocket-provider";

const STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente",
  printing: "Imprimiendo",
  completed: "Completado",
  cancelled: "Cancelado",
};

const NOZZLES = [0.2, 0.4, 0.6, 0.8];

// Sort options for the card-based tabs (Pendientes/En Impresión/etc.).
const CARD_SORT_OPTIONS: { key: string; label: string; dir: SortDir }[] = [
  { key: "priority", label: "Prioridad", dir: "desc" },
  { key: "name", label: "Nombre", dir: "asc" },
  { key: "duration", label: "Duración est.", dir: "desc" },
  { key: "weight", label: "Peso est.", dir: "desc" },
  { key: "material", label: "Material", dir: "asc" },
];
const CARD_ACCESSORS: Record<string, (j: PrintJob) => any> = {
  priority: (j) => j.priority,
  name: (j) => j.name,
  duration: (j) => (j as any).estimated_time_secs,
  weight: (j) => (j as any).estimated_weight_g,
  material: (j) => j.required_material,
};

function formatDuration(secs: number | null | undefined): string {
  if (!secs) return "-";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatWeight(g: number | null | undefined): string {
  if (!g) return "-";
  if (g >= 1000) return `${(g / 1000).toFixed(2)} kg`;
  return `${g.toFixed(0)}g`;
}

// ─── Sorting helpers ───
type SortDir = "asc" | "desc";

// Generic comparator: numbers numerically, ISO dates chronologically, strings
// alphabetically (locale-aware). Null/undefined always sink to the bottom,
// regardless of direction, so empty cells never crowd the top.
function compareValues(a: any, b: any, dir: SortDir): number {
  const aEmpty = a === null || a === undefined || a === "";
  const bEmpty = b === null || b === undefined || b === "";
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  let cmp: number;
  if (typeof a === "number" && typeof b === "number") {
    cmp = a - b;
  } else {
    cmp = String(a).localeCompare(String(b), "es", { numeric: true, sensitivity: "base" });
  }
  return dir === "asc" ? cmp : -cmp;
}

function useSort<T>(
  items: T[],
  accessors: Record<string, (item: T) => any>,
  initialKey: string | null = null,
  initialDir: SortDir = "desc",
) {
  const [sortKey, setSortKey] = useState<string | null>(initialKey);
  const [sortDir, setSortDir] = useState<SortDir>(initialDir);

  const toggle = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sorted = useMemo(() => {
    if (!sortKey || !accessors[sortKey]) return items;
    const acc = accessors[sortKey];
    return [...items].sort((a, b) => compareValues(acc(a), acc(b), sortDir));
  }, [items, sortKey, sortDir, accessors]);

  return { sorted, sortKey, sortDir, toggle };
}

// Clickable table header that shows the active sort direction.
function SortHeader({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: string;
  activeKey: string | null;
  dir: SortDir;
  onSort: (key: string) => void;
  align?: "left" | "center" | "right";
}) {
  const active = activeKey === sortKey;
  const justify =
    align === "center" ? "justify-center" : align === "right" ? "justify-end" : "justify-start";
  return (
    <th className="p-3 font-medium">
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`flex items-center gap-1 w-full ${justify} select-none hover:text-foreground transition-colors ${
          active ? "text-foreground" : ""
        }`}
      >
        {label}
        {active ? (
          dir === "asc" ? (
            <ArrowUp className="w-3 h-3" />
          ) : (
            <ArrowDown className="w-3 h-3" />
          )
        ) : (
          <ArrowUpDown className="w-3 h-3 opacity-30" />
        )}
      </button>
    </th>
  );
}

// Resolve a friendly filament name from the loaded Spoolman list, matching by id
// first (robust) and color+material second (legacy fallback).
function resolveFilamentName(
  filaments: any[],
  filamentId: number | null | undefined,
  color: string | null | undefined,
  material: string | null | undefined,
): string | null {
  const f =
    filamentId != null
      ? filaments.find((x) => x.id === filamentId)
      : filaments.find(
          (x) => `#${x.color_hex}` === color && x.material === material,
        );
  return f?.name || null;
}

export default function QueuePage() {
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<string>("pending");
  const [showForm, setShowForm] = useState(false);
  const [editingJob, setEditingJob] = useState<PrintJob | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [filaments, setFilaments] = useState<any[]>([]);
  const [printerModels, setPrinterModels] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [cardSort, setCardSort] = useState<string>("priority");
  const { printers } = useWSContext();

  const fetchJobs = useCallback(async () => {
    try {
      if (activeTab === "history") {
        const data = await api.getHistory(100);
        setHistory(data);
      } else {
        const data = await api.getQueue(activeTab !== "all" ? activeTab : undefined);
        setJobs(data);
      }
    } catch (error) {
      console.error("Error fetching queue:", error);
    } finally {
      setIsLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    api.getFilaments()
      .then((data) => setFilaments(data))
      .catch((err) => console.error("Error fetching filaments:", err));
  }, []);

  // Derive unique printer models from real printers
  useEffect(() => {
    if (printers.length > 0) {
      const models = [...new Set(printers.map((p) => p.model))];
      setPrinterModels(models);
    }
  }, [printers]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  // Listen for WebSocket queue updates — debounced so a burst of events
  // (e.g. several jobs dispatched at once) triggers a single refetch.
  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const handler = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => fetchJobs(), 300);
    };
    window.addEventListener("queue-updated", handler);
    return () => {
      clearTimeout(debounce);
      window.removeEventListener("queue-updated", handler);
    };
  }, [fetchJobs]);

  const handleCancel = async (id: number) => {
    if (!window.confirm("¿Eliminar este trabajo de la cola? No queda registrado como cancelado.")) return;
    try {
      await api.cancelJob(id);
      fetchJobs();
    } catch (error) {
      console.error("Error cancelling job:", error);
    }
  };

  const handleRequeue = async (id: number) => {
    try {
      await api.requeueJob(id);
      fetchJobs();
    } catch (error) {
      console.error("Error requeueing job:", error);
    }
  };

  const handleReorder = async (reorderedJobs: PrintJob[]) => {
    // Assign descending priorities based on visual order
    const items = reorderedJobs.map((job, index) => ({
      id: job.id,
      priority: reorderedJobs.length - index,
    }));
    try {
      await api.reorderQueue(items);
    } catch (error) {
      console.error("Error reordering queue:", error);
    }
  };

  const handleClone = async (id: number) => {
    try {
      await api.cloneJob(id, 1);
      // Jump to the pending tab so the new copy is visible
      if (activeTab === "pending") {
        fetchJobs();
      } else {
        setActiveTab("pending");
      }
    } catch (error: any) {
      alert(`Error al duplicar: ${error.message || error}`);
      console.error("Error cloning job:", error);
    }
  };

  const handleCloneFromHistory = async (historyId: number, copies: number) => {
    try {
      await api.cloneFromHistory(historyId, copies);
      fetchJobs();
      // Switch to pending tab to show the new job
      setActiveTab("pending");
    } catch (error: any) {
      alert(`Error al clonar: ${error.message || error}`);
      console.error("Error cloning from history:", error);
    }
  };

  // Filter (search) the card-tab jobs by name, gcode, material or filament.
  const searchedJobs = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return jobs;
    return jobs.filter((j) => {
      const fname =
        resolveFilamentName(filaments, j.required_filament_id, j.required_color, j.required_material) || "";
      return `${j.name} ${j.gcode_original_name} ${j.required_material} ${fname}`
        .toLowerCase()
        .includes(q);
    });
  }, [jobs, search, filaments]);

  // Sort the card-tab jobs. Pendientes keeps its manual drag order untouched.
  const visibleJobs = useMemo(() => {
    if (activeTab === "pending") return searchedJobs;
    const acc = CARD_ACCESSORS[cardSort];
    if (!acc) return searchedJobs;
    const dir = CARD_SORT_OPTIONS.find((o) => o.key === cardSort)?.dir ?? "desc";
    return [...searchedJobs].sort((a, b) => compareValues(acc(a), acc(b), dir));
  }, [searchedJobs, activeTab, cardSort]);

  const tabs = [
    { key: "pending", label: "Pendientes" },
    { key: "printing", label: "En Impresión" },
    { key: "completed", label: "Completados" },
    { key: "cancelled", label: "Cancelados" },
    { key: "history", label: "Historial", icon: History },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gradient">Cola de Impresión</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Gestiona los trabajos de impresión pendientes
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors self-start sm:self-auto shrink-0"
        >
          <Plus className="w-4 h-4" />
          Nuevo Trabajo
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-secondary/50 rounded-lg w-full sm:w-fit overflow-x-auto custom-scrollbar">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-all whitespace-nowrap shrink-0 ${
              activeTab === tab.key
                ? "bg-card text-foreground shadow-md"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.icon && <tab.icon className="w-3.5 h-3.5" />}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Toolbar: search (all tabs) + sort selector (card tabs only) */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, archivo, material o filamento…"
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-secondary border border-border focus:border-primary outline-none text-sm"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
              title="Limpiar"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        {activeTab !== "history" && activeTab !== "pending" && (
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-muted-foreground">Ordenar:</span>
            <select
              value={cardSort}
              onChange={(e) => setCardSort(e.target.value)}
              className="px-3 py-2 rounded-lg bg-secondary border border-border focus:border-primary outline-none text-sm"
            >
              {CARD_SORT_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* History Tab */}
      {activeTab === "history" ? (
        <HistoryTable history={history} filaments={filaments} search={search} onClone={handleCloneFromHistory} />
      ) : (
        /* Job List */
        <div className="space-y-3">
          {activeTab === "pending" ? (
            <DragDropJobList
              jobs={visibleJobs}
              filaments={filaments}
              onEdit={(job) => setEditingJob(job)}
              onCancel={handleCancel}
              onRequeue={handleRequeue}
              onReorder={handleReorder}
              onClone={handleClone}
            />
          ) : (
            visibleJobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                filaments={filaments}
                onEdit={() => setEditingJob(job)}
                onCancel={handleCancel}
                onRequeue={handleRequeue}
                onClone={handleClone}
              />
            ))
          )}
          {visibleJobs.length === 0 && !isLoading && activeTab !== "history" && (
            <div className="glass-card p-12 text-center">
              <div className="text-4xl mb-3">📋</div>
              <p className="text-muted-foreground">
                {search
                  ? "Ningún trabajo coincide con la búsqueda"
                  : `No hay trabajos ${activeTab === "pending" ? "pendientes" : `con estado "${activeTab}"`}`}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Add Job Modal */}
      {showForm && (
        <AddJobModal 
          filaments={filaments}
          printerModels={printerModels}
          onClose={() => setShowForm(false)} 
          onAdded={fetchJobs} 
        />
      )}

      {/* Edit Job Modal */}
      {editingJob && (
        <EditJobModal
          job={editingJob}
          filaments={filaments}
          printerModels={printerModels}
          onClose={() => setEditingJob(null)}
          onUpdated={() => {
            setEditingJob(null);
            fetchJobs();
          }}
        />
      )}
    </div>
  );
}

// ─── History Table ───
function HistoryTable({
  history,
  filaments,
  search,
  onClone,
}: {
  history: any[];
  filaments: any[];
  search: string;
  onClone: (historyId: number, copies: number) => void;
}) {
  const [cloningId, setCloningId] = useState<number | null>(null);
  const [cloneCopies, setCloneCopies] = useState(1);

  // Filter by the shared search box (job, printer, material, filament).
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return history;
    return history.filter((e) => {
      const fname =
        resolveFilamentName(filaments, e.required_filament_id, e.required_color, e.material) || "";
      return `${e.job_name || ""} ${e.gcode_filename || ""} ${e.printer_name || ""} ${e.material || ""} ${fname}`
        .toLowerCase()
        .includes(q);
    });
  }, [history, search, filaments]);

  const accessors: Record<string, (e: any) => any> = {
    job: (e) => e.job_name || e.gcode_filename,
    printer: (e) => e.printer_name || `#${e.printer_id}`,
    material: (e) => e.material,
    nozzle: (e) => e.required_nozzle,
    filament: (e) => resolveFilamentName(filaments, e.required_filament_id, e.required_color, e.material) || e.required_color,
    duration: (e) => e.duration_secs,
    started: (e) => e.started_at,
    completed: (e) => e.completed_at,
    result: (e) => e.result,
  };
  const { sorted, sortKey, sortDir, toggle } = useSort(filtered, accessors, "completed", "desc");

  if (history.length === 0) {
    return (
      <div className="glass-card p-12 text-center">
        <div className="text-4xl mb-3">📊</div>
        <p className="text-muted-foreground">
          No hay registros de impresiones anteriores
        </p>
      </div>
    );
  }

  const handleClone = (historyId: number) => {
    onClone(historyId, cloneCopies);
    setCloningId(null);
    setCloneCopies(1);
  };

  return (
    <div className="glass-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <SortHeader label="Trabajo" sortKey="job" activeKey={sortKey} dir={sortDir} onSort={toggle} />
              <SortHeader label="Impresora" sortKey="printer" activeKey={sortKey} dir={sortDir} onSort={toggle} />
              <SortHeader label="Material" sortKey="material" activeKey={sortKey} dir={sortDir} onSort={toggle} />
              <SortHeader label="Boquilla" sortKey="nozzle" activeKey={sortKey} dir={sortDir} onSort={toggle} />
              <SortHeader label="Filamento" sortKey="filament" activeKey={sortKey} dir={sortDir} onSort={toggle} />
              <SortHeader label="Duración" sortKey="duration" activeKey={sortKey} dir={sortDir} onSort={toggle} />
              <SortHeader label="Iniciado" sortKey="started" activeKey={sortKey} dir={sortDir} onSort={toggle} />
              <SortHeader label="Completado" sortKey="completed" activeKey={sortKey} dir={sortDir} onSort={toggle} />
              <SortHeader label="Resultado" sortKey="result" activeKey={sortKey} dir={sortDir} onSort={toggle} />
              <th className="p-3 font-medium text-center">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={10} className="p-8 text-center text-muted-foreground">
                  Ningún registro coincide con la búsqueda
                </td>
              </tr>
            )}
            {sorted.map((entry) => {
              const filName = resolveFilamentName(
                filaments,
                entry.required_filament_id,
                entry.required_color,
                entry.material,
              );
              return (
              <tr key={entry.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                <td className="p-3 font-medium">{entry.job_name || entry.gcode_filename}</td>
                <td className="p-3 text-muted-foreground">{entry.printer_name || `#${entry.printer_id}`}</td>
                <td className="p-3 text-muted-foreground">{entry.material || "-"}</td>
                <td className="p-3 text-muted-foreground">
                  {entry.required_nozzle != null ? `${entry.required_nozzle}mm` : "-"}
                </td>
                <td className="p-3 text-muted-foreground">
                  {filName || entry.required_color ? (
                    <span className="inline-flex items-center gap-1.5">
                      {entry.required_color && (
                        <span
                          className="w-3 h-3 rounded-full border border-white/20 shrink-0"
                          style={{ backgroundColor: entry.required_color }}
                        />
                      )}
                      <span className="truncate">{filName || entry.required_color}</span>
                    </span>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="p-3 text-muted-foreground">{formatDuration(entry.duration_secs)}</td>
                <td className="p-3 text-muted-foreground">
                  {entry.started_at
                    ? new Date(entry.started_at).toLocaleDateString("es-AR", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "-"}
                </td>
                <td className="p-3 text-muted-foreground">
                  {entry.completed_at
                    ? new Date(entry.completed_at).toLocaleDateString("es-AR", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "-"}
                </td>
                <td className="p-3">
                  {entry.result === "success" ? (
                    <span className="inline-flex items-center gap-1 text-green-400">
                      <CheckCircle className="w-3.5 h-3.5" /> Éxito
                    </span>
                  ) : entry.result === "failed" ? (
                    <span className="inline-flex items-center gap-1 text-red-400">
                      <XCircle className="w-3.5 h-3.5" /> Fallido
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{entry.result}</span>
                  )}
                </td>
                <td className="p-3">
                  <div className="flex items-center justify-center gap-1">
                    {cloningId === entry.id ? (
                      <div className="flex items-center gap-2 animate-in fade-in">
                        <input
                          type="number"
                          min={1}
                          max={100}
                          value={cloneCopies}
                          onChange={(e) => setCloneCopies(parseInt(e.target.value) || 1)}
                          className="w-14 px-2 py-1 rounded bg-secondary border border-border text-xs text-center focus:border-primary outline-none"
                          title="Cantidad de copias"
                        />
                        <button
                          onClick={() => handleClone(entry.id)}
                          className="px-2 py-1 rounded bg-primary/20 text-primary text-xs font-medium hover:bg-primary/30 transition-colors border border-primary/30"
                          title="Confirmar"
                        >
                          Agregar
                        </button>
                        <button
                          onClick={() => { setCloningId(null); setCloneCopies(1); }}
                          className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                          title="Cancelar"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setCloningId(entry.id)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-primary hover:bg-primary/10 border border-transparent hover:border-primary/30 transition-all"
                        title="Agregar tarea igual a la cola"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        Repetir
                      </button>
                    )}
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}


// ─── Drag & Drop Job List ───
function DragDropJobList({
  jobs,
  filaments,
  onEdit,
  onCancel,
  onRequeue,
  onReorder,
  onClone,
}: {
  jobs: PrintJob[];
  filaments: any[];
  onEdit: (job: PrintJob) => void;
  onCancel: (id: number) => void;
  onRequeue: (id: number) => void;
  onReorder: (jobs: PrintJob[]) => void;
  onClone: (id: number) => void;
}) {
  const [localJobs, setLocalJobs] = useState(jobs);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  useEffect(() => {
    setLocalJobs(jobs);
  }, [jobs]);

  const handleDragStart = (index: number) => {
    setDragIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setOverIndex(index);
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === dropIndex) {
      setDragIndex(null);
      setOverIndex(null);
      return;
    }

    const reordered = [...localJobs];
    const [moved] = reordered.splice(dragIndex, 1);
    reordered.splice(dropIndex, 0, moved);
    setLocalJobs(reordered);
    setDragIndex(null);
    setOverIndex(null);
    onReorder(reordered);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setOverIndex(null);
  };

  if (localJobs.length === 0) return null;

  return (
    <div className="space-y-1">
      {localJobs.map((job, index) => (
        <div
          key={job.id}
          draggable
          onDragStart={() => handleDragStart(index)}
          onDragOver={(e) => handleDragOver(e, index)}
          onDrop={(e) => handleDrop(e, index)}
          onDragEnd={handleDragEnd}
          className={`transition-all duration-150 ${
            dragIndex === index ? "opacity-40 scale-[0.98]" : ""
          } ${
            overIndex === index && dragIndex !== index
              ? "border-t-2 border-primary"
              : ""
          }`}
        >
          <JobCard
            job={job}
            filaments={filaments}
            onEdit={() => onEdit(job)}
            onCancel={onCancel}
            onRequeue={onRequeue}
            onClone={onClone}
            showGrip
          />
        </div>
      ))}
    </div>
  );
}


// ─── Job Card ───
function JobCard({
  job,
  filaments,
  onEdit,
  onCancel,
  onRequeue,
  onClone,
  showGrip = false,
}: {
  job: PrintJob;
  filaments: any[];
  onEdit: () => void;
  onCancel: (id: number) => void;
  onRequeue: (id: number) => void;
  onClone: (id: number) => void;
  showGrip?: boolean;
}) {
  let models: string[] = [];
  try {
    models = JSON.parse(job.compatible_models);
  } catch {}

  const statusColors: Record<string, string> = {
    pending: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    printing: "bg-green-500/20 text-green-400 border-green-500/30",
    completed: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    cancelled: "bg-red-500/20 text-red-400 border-red-500/30",
  };

  const filamentName = (
    job.required_filament_id != null
      ? filaments.find((f) => f.id === job.required_filament_id)
      : filaments.find(
          (f) => `#${f.color_hex}` === job.required_color && f.material === job.required_material
        )
  )?.name;

  return (
    <div className="glass-card p-4 flex items-center gap-4">
      {/* Drag grip */}
      {showGrip && (
        <div className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground transition-colors">
          <GripVertical className="w-5 h-5" />
        </div>
      )}

      {/* Priority indicator */}
      <div className="flex flex-col items-center gap-1 text-xs text-muted-foreground">
        <ArrowUp className="w-3 h-3" />
        <span className="font-mono font-bold text-foreground">{job.priority}</span>
        <ArrowDown className="w-3 h-3" />
      </div>

      {/* Job info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <h4 className="font-semibold truncate">{job.name}</h4>
          <span
            className={`text-xs px-2 py-0.5 rounded-full border ${
              statusColors[job.status] || statusColors.pending
            }`}
          >
            {STATUS_LABELS[job.status] || job.status}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <FileCode className="w-3 h-3" />
            {job.gcode_original_name}
          </span>
          <span>🔧 {job.required_nozzle}mm</span>
          <span>🧵 {job.required_material}</span>
          {job.required_color && (
            <span className="flex items-center gap-1" title={filamentName || job.required_color}>
              <span
                className="w-3 h-3 rounded-full border border-white/20"
                style={{ backgroundColor: job.required_color }}
              />
              {filamentName || job.required_color}
            </span>
          )}
          {job.copies > 1 && (
            <span>
              📄 {job.copies_completed}/{job.copies} copias
            </span>
          )}
          {models.length > 0 && (
            <span className="flex items-center gap-1">
              <Printer className="w-3 h-3" />
              {models.join(", ")}
            </span>
          )}
          {/* Estimated time */}
          {(job as any).estimated_time_secs && (
            <span className="flex items-center gap-1 text-blue-400">
              <Clock className="w-3 h-3" />
              ~{formatDuration((job as any).estimated_time_secs)}
            </span>
          )}
          {/* Estimated weight */}
          {(job as any).estimated_weight_g && (
            <span className="flex items-center gap-1 text-amber-400">
              <Weight className="w-3 h-3" />
              ~{formatWeight((job as any).estimated_weight_g)}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 shrink-0">
        {job.status === "pending" && (
          <button
            onClick={onEdit}
            className="p-2 rounded-lg hover:bg-primary/20 text-muted-foreground hover:text-primary transition-colors"
            title="Editar"
          >
            <Pencil className="w-4 h-4" />
          </button>
        )}
        {/* Duplicar — disponible en todos los estados */}
        <button
          onClick={() => onClone(job.id)}
          className="p-2 rounded-lg hover:bg-primary/20 text-muted-foreground hover:text-primary transition-colors"
          title="Duplicar tarea"
        >
          <Copy className="w-4 h-4" />
        </button>
        {job.status === "pending" && (
          <button
            onClick={() => onCancel(job.id)}
            className="p-2 rounded-lg hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors"
            title="Eliminar de la cola"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
        {(job.status === "completed" || job.status === "cancelled") && (
          <button
            onClick={() => onRequeue(job.id)}
            className="p-2 rounded-lg hover:bg-blue-500/20 text-muted-foreground hover:text-blue-400 transition-colors"
            title="Re-encolar"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Filament Picker (searchable) ───
// Replaces the old separate Material + Color selectors. The user picks ONE
// Spoolman filament; material and color are derived from it. The job stores the
// filament id, which is exactly what the dispatcher matches against.
function filamentLabel(f: any): string {
  const base = f?.name || f?.material || "Filamento";
  const vendor = f?.vendor?.name;
  return vendor ? `${base} · ${vendor}` : base;
}

function FilamentPicker({
  filaments,
  selectedId,
  onSelect,
}: {
  filaments: any[];
  selectedId: number | null;
  onSelect: (filament: any | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const selected = filaments.find((f) => f.id === selectedId) || null;

  const filtered = filaments.filter((f) => {
    const q = query.toLowerCase().trim();
    if (!q) return true;
    const hay = `${f.name || ""} ${f.material || ""} ${f.vendor?.name || ""}`.toLowerCase();
    return hay.includes(q);
  });

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary border border-border focus:border-primary outline-none text-sm text-left"
      >
        {selected ? (
          <>
            <span
              className="w-4 h-4 rounded-full border border-white/20 shrink-0"
              style={{ backgroundColor: selected.color_hex ? `#${selected.color_hex}` : "transparent" }}
            />
            <span className="flex-1 truncate">{filamentLabel(selected)}</span>
          </>
        ) : (
          <span className="flex-1 text-muted-foreground">Selecciona un filamento…</span>
        )}
        <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-lg bg-card border border-border shadow-xl overflow-hidden">
          <div className="p-2 border-b border-border bg-card">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar por nombre, material o marca…"
                className="w-full pl-8 pr-3 py-1.5 rounded-md bg-secondary border border-border focus:border-primary outline-none text-sm"
              />
            </div>
          </div>
          <div className="max-h-60 overflow-y-auto custom-scrollbar">
            {filtered.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  onSelect(f);
                  setOpen(false);
                  setQuery("");
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-secondary/60 transition-colors text-left"
              >
                <span
                  className="w-4 h-4 rounded-full border border-white/20 shrink-0"
                  style={{ backgroundColor: f.color_hex ? `#${f.color_hex}` : "transparent" }}
                />
                <span className="flex-1 truncate">
                  {f.name || f.material}
                  <span className="text-xs text-muted-foreground">
                    {" · "}{f.material}{f.vendor?.name ? ` · ${f.vendor.name}` : ""}
                  </span>
                </span>
                {f.id === selectedId && <Check className="w-4 h-4 text-primary shrink-0" />}
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="p-4 text-sm text-muted-foreground text-center">
                Sin resultados
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AddJobModal({
  filaments,
  printerModels,
  onClose,
  onAdded,
}: {
  filaments: any[];
  printerModels: string[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const [name, setName] = useState("");
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [nozzle, setNozzle] = useState(0.4);
  const [material, setMaterial] = useState("PLA");
  const [color, setColor] = useState("");
  const [filamentId, setFilamentId] = useState<number | null>(null);
  const [copies, setCopies] = useState(1);
  const [priority, setPriority] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Default to the first filament so the field is never empty.
  useEffect(() => {
    if (filaments.length > 0 && filamentId === null) {
      const f = filaments[0];
      setFilamentId(f.id);
      setMaterial(f.material);
      setColor(f.color_hex ? `#${f.color_hex}` : "");
    }
  }, [filaments, filamentId]);

  const handleSelectFilament = (f: any | null) => {
    if (f) {
      setFilamentId(f.id);
      setMaterial(f.material);
      setColor(f.color_hex ? `#${f.color_hex}` : "");
    } else {
      setFilamentId(null);
    }
  };

  const toggleModel = (model: string) => {
    setSelectedModels((prev) =>
      prev.includes(model)
        ? prev.filter((m) => m !== model)
        : [...prev, model]
    );
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.[0]) {
      setFile(e.dataTransfer.files[0]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !name || selectedModels.length === 0) return;

    setIsSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("name", name);
      formData.append("compatible_models", JSON.stringify(selectedModels));
      formData.append("required_nozzle", nozzle.toString());
      formData.append("required_material", material);
      if (color) formData.append("required_color", color);
      if (filamentId != null) formData.append("required_filament_id", String(filamentId));
      formData.append("copies", copies.toString());
      formData.append("priority", priority.toString());
      formData.append("gcode", file);

      await api.addJob(formData);
      onAdded();
      onClose();
    } catch (error) {
      console.error("Error adding job:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass-card w-full max-w-lg max-h-[90vh] overflow-y-auto custom-scrollbar mx-4 p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold">Nuevo Trabajo de Impresión</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-secondary rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium mb-1.5">
              Nombre del trabajo
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-secondary border border-border focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all text-sm"
              placeholder="Ej: Carcasa sensor v2"
              required
            />
          </div>

          {/* G-code Upload */}
          <div>
            <label className="block text-sm font-medium mb-1.5">
              Archivo G-code
            </label>
            <div
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-all ${
                dragActive
                  ? "border-primary bg-primary/10"
                  : file
                  ? "border-green-500/50 bg-green-500/10"
                  : "border-border hover:border-muted-foreground"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".gcode,.g,.gco"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="hidden"
              />
              {file ? (
                <div className="flex items-center justify-center gap-2 text-green-400">
                  <FileCode className="w-5 h-5" />
                  <span className="text-sm font-medium">{file.name}</span>
                </div>
              ) : (
                <>
                  <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Arrastrá el archivo G-code aquí o hacé click para seleccionar
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Compatible Models */}
          <div>
            <label className="block text-sm font-medium mb-1.5">
              Impresoras compatibles
            </label>
            <div className="flex flex-wrap gap-2">
              {printerModels.map((model) => (
                <button
                  key={model}
                  type="button"
                  onClick={() => toggleModel(model)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                    selectedModels.includes(model)
                      ? "bg-primary/20 border-primary/50 text-primary"
                      : "bg-secondary border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {model}
                </button>
              ))}
            </div>
          </div>

          {/* Filament (single searchable selector — replaces Material + Color) */}
          <div>
            <label className="block text-sm font-medium mb-1.5">Filamento</label>
            <FilamentPicker
              filaments={filaments}
              selectedId={filamentId}
              onSelect={handleSelectFilament}
            />
            <p className="text-xs text-muted-foreground mt-1">
              El material y el color salen del filamento elegido. El despacho exige
              exactamente este filamento cargado.
            </p>
          </div>

          {/* Nozzle + Copies + Priority */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1.5">Boquilla</label>
              <select
                value={nozzle}
                onChange={(e) => setNozzle(parseFloat(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-secondary border border-border focus:border-primary outline-none text-sm"
              >
                {NOZZLES.map((n) => (
                  <option key={n} value={n}>
                    {n}mm
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Copias</label>
              <input
                type="number"
                min={1}
                max={100}
                value={copies}
                onChange={(e) => setCopies(parseInt(e.target.value) || 1)}
                className="w-full px-3 py-2 rounded-lg bg-secondary border border-border focus:border-primary outline-none text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Prioridad</label>
              <input
                type="number"
                min={0}
                max={99}
                value={priority}
                onChange={(e) => setPriority(parseInt(e.target.value) || 0)}
                className="w-full px-3 py-2 rounded-lg bg-secondary border border-border focus:border-primary outline-none text-sm"
              />
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={isSubmitting || !file || !name || selectedModels.length === 0}
            className="w-full py-3 rounded-lg bg-primary text-primary-foreground font-semibold transition-all hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? "Agregando..." : "Agregar a la Cola"}
          </button>
        </form>
      </div>
    </div>
  );
}

function EditJobModal({
  job,
  filaments,
  printerModels,
  onClose,
  onUpdated,
}: {
  job: PrintJob;
  filaments: any[];
  printerModels: string[];
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [name, setName] = useState(job.name);
  const [selectedModels, setSelectedModels] = useState<string[]>(() => {
    try {
      return JSON.parse(job.compatible_models);
    } catch {
      return [];
    }
  });
  const [nozzle, setNozzle] = useState(job.required_nozzle);
  const [material, setMaterial] = useState(job.required_material);
  const [color, setColor] = useState(job.required_color || "");
  const [filamentId, setFilamentId] = useState<number | null>(
    job.required_filament_id ?? null
  );
  const [priority, setPriority] = useState(job.priority);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSelectFilament = (f: any | null) => {
    if (f) {
      setFilamentId(f.id);
      setMaterial(f.material);
      setColor(f.color_hex ? `#${f.color_hex}` : "");
    } else {
      setFilamentId(null);
    }
  };

  const toggleModel = (model: string) => {
    setSelectedModels((prev) =>
      prev.includes(model)
        ? prev.filter((m) => m !== model)
        : [...prev, model]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || selectedModels.length === 0) return;

    setIsSubmitting(true);
    try {
      await api.updateJob(job.id, {
        name,
        compatible_models: selectedModels,
        required_nozzle: nozzle,
        required_material: material,
        required_color: color || null,
        required_filament_id: filamentId,
        priority,
      });
      onUpdated();
    } catch (error) {
      console.error("Error updating job:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass-card w-full max-w-lg max-h-[90vh] overflow-y-auto custom-scrollbar mx-4 p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold">Editar Trabajo</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-secondary rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium mb-1.5">
              Nombre del trabajo
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-secondary border border-border focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all text-sm"
              required
            />
          </div>

          {/* Compatible Models */}
          <div>
            <label className="block text-sm font-medium mb-1.5">
              Impresoras compatibles
            </label>
            <div className="flex flex-wrap gap-2">
              {printerModels.map((model) => (
                <button
                  key={model}
                  type="button"
                  onClick={() => toggleModel(model)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                    selectedModels.includes(model)
                      ? "bg-primary/20 border-primary/50 text-primary"
                      : "bg-secondary border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {model}
                </button>
              ))}
            </div>
          </div>

          {/* Filament (single searchable selector — replaces Material + Color) */}
          <div>
            <label className="block text-sm font-medium mb-1.5">Filamento</label>
            <FilamentPicker
              filaments={filaments}
              selectedId={filamentId}
              onSelect={handleSelectFilament}
            />
          </div>

          {/* Nozzle + Priority */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1.5">Boquilla</label>
              <select
                value={nozzle}
                onChange={(e) => setNozzle(parseFloat(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-secondary border border-border focus:border-primary outline-none text-sm"
              >
                {NOZZLES.map((n) => (
                  <option key={n} value={n}>
                    {n}mm
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Prioridad</label>
              <input
                type="number"
                min={0}
                max={99}
                value={priority}
                onChange={(e) => setPriority(parseInt(e.target.value) || 0)}
                className="w-full px-3 py-2 rounded-lg bg-secondary border border-border focus:border-primary outline-none text-sm"
              />
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={isSubmitting || !name || selectedModels.length === 0}
            className="w-full py-3 rounded-lg bg-primary text-primary-foreground font-semibold transition-all hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? "Guardando..." : "Guardar Cambios"}
          </button>
        </form>
      </div>
    </div>
  );
}
