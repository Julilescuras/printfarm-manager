"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Plus,
  Upload,
  X,
  Printer,
  ArrowUp,
  ArrowDown,
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

const MATERIALS = ["PLA", "PETG", "ABS", "TPU", "ASA", "Nylon"];
const NOZZLES = [0.2, 0.4, 0.6, 0.8];

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

export default function QueuePage() {
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<string>("pending");
  const [showForm, setShowForm] = useState(false);
  const [editingJob, setEditingJob] = useState<PrintJob | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [filaments, setFilaments] = useState<any[]>([]);
  const [printerModels, setPrinterModels] = useState<string[]>([]);
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

  // Listen for WebSocket queue updates
  useEffect(() => {
    const handler = () => fetchJobs();
    window.addEventListener("queue-updated", handler);
    return () => window.removeEventListener("queue-updated", handler);
  }, [fetchJobs]);

  const handleCancel = async (id: number) => {
    if (!window.confirm("¿Seguro que querés cancelar este trabajo?")) return;
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gradient">Cola de Impresión</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Gestiona los trabajos de impresión pendientes
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Nuevo Trabajo
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-secondary/50 rounded-lg w-fit">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-all ${
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

      {/* History Tab */}
      {activeTab === "history" ? (
        <HistoryTable history={history} />
      ) : (
        /* Job List */
        <div className="space-y-3">
          {activeTab === "pending" ? (
            <DragDropJobList
              jobs={jobs}
              filaments={filaments}
              onEdit={(job) => setEditingJob(job)}
              onCancel={handleCancel}
              onRequeue={handleRequeue}
              onReorder={handleReorder}
            />
          ) : (
            jobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                filaments={filaments}
                onEdit={() => setEditingJob(job)}
                onCancel={handleCancel}
                onRequeue={handleRequeue}
              />
            ))
          )}
          {jobs.length === 0 && !isLoading && activeTab !== "history" && (
            <div className="glass-card p-12 text-center">
              <div className="text-4xl mb-3">📋</div>
              <p className="text-muted-foreground">
                No hay trabajos{" "}
                {activeTab === "pending" ? "pendientes" : `con estado "${activeTab}"`}
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
function HistoryTable({ history }: { history: any[] }) {
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

  return (
    <div className="glass-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="p-3 font-medium">Trabajo</th>
              <th className="p-3 font-medium">Impresora</th>
              <th className="p-3 font-medium">Material</th>
              <th className="p-3 font-medium">Filamento</th>
              <th className="p-3 font-medium">Duración</th>
              <th className="p-3 font-medium">Fecha</th>
              <th className="p-3 font-medium">Resultado</th>
            </tr>
          </thead>
          <tbody>
            {history.map((entry) => (
              <tr key={entry.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                <td className="p-3 font-medium">{entry.job_name || entry.gcode_filename}</td>
                <td className="p-3 text-muted-foreground">{entry.printer_name || `#${entry.printer_id}`}</td>
                <td className="p-3 text-muted-foreground">{entry.material || "-"}</td>
                <td className="p-3 text-muted-foreground">{formatWeight(entry.estimated_weight_g)}</td>
                <td className="p-3 text-muted-foreground">{formatDuration(entry.duration_secs)}</td>
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
              </tr>
            ))}
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
}: {
  jobs: PrintJob[];
  filaments: any[];
  onEdit: (job: PrintJob) => void;
  onCancel: (id: number) => void;
  onRequeue: (id: number) => void;
  onReorder: (jobs: PrintJob[]) => void;
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
  showGrip = false,
}: {
  job: PrintJob;
  filaments: any[];
  onEdit: () => void;
  onCancel: (id: number) => void;
  onRequeue: (id: number) => void;
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

  const filamentName = filaments.find((f) => `#${f.color_hex}` === job.required_color && f.material === job.required_material)?.name;

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
          <span>
            📄 {job.copies_completed}/{job.copies} copias
          </span>
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
          <>
            <button
              onClick={onEdit}
              className="p-2 rounded-lg hover:bg-primary/20 text-muted-foreground hover:text-primary transition-colors"
              title="Editar"
            >
              <Pencil className="w-4 h-4" />
            </button>
            <button
              onClick={() => onCancel(job.id)}
              className="p-2 rounded-lg hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors"
              title="Cancelar"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </>
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
  const [copies, setCopies] = useState(1);
  const [priority, setPriority] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (filaments.length > 0 && !color) {
      setColor(`#${filaments[0].color_hex}`);
      setMaterial(filaments[0].material);
    }
  }, [filaments, color]);

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

          {/* Nozzle + Material row */}
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
              <label className="block text-sm font-medium mb-1.5">Material</label>
              <select
                value={material}
                onChange={(e) => setMaterial(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-secondary border border-border focus:border-primary outline-none text-sm"
              >
                {MATERIALS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Color + Copies + Priority */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1.5">Color (Spoolman)</label>
              <div className="relative">
                <select
                  value={color}
                  onChange={(e) => {
                    setColor(e.target.value);
                    const fil = filaments.find((f) => `#${f.color_hex}` === e.target.value);
                    if (fil) setMaterial(fil.material);
                  }}
                  className="w-full pl-10 pr-3 py-2 rounded-lg bg-secondary border border-border focus:border-primary outline-none text-sm appearance-none"
                >
                  <option value="">Selecciona un color...</option>
                  {filaments.map((f) => (
                    <option key={f.id} value={`#${f.color_hex}`}>
                      {f.name || f.material} - {f.vendor?.name || "N/A"}
                    </option>
                  ))}
                </select>
                <div 
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border border-white/20 pointer-events-none"
                  style={{ backgroundColor: color || 'transparent' }}
                />
              </div>
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
  const [copies, setCopies] = useState(job.copies);
  const [priority, setPriority] = useState(job.priority);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
        copies,
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

          {/* Nozzle + Material row */}
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
              <label className="block text-sm font-medium mb-1.5">Material</label>
              <select
                value={material}
                onChange={(e) => setMaterial(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-secondary border border-border focus:border-primary outline-none text-sm"
              >
                {MATERIALS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Color + Copies + Priority */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1.5">Color (Spoolman)</label>
              <div className="relative">
                <select
                  value={color}
                  onChange={(e) => {
                    setColor(e.target.value);
                    const fil = filaments.find((f) => `#${f.color_hex}` === e.target.value);
                    if (fil) setMaterial(fil.material);
                  }}
                  className="w-full pl-10 pr-3 py-2 rounded-lg bg-secondary border border-border focus:border-primary outline-none text-sm appearance-none"
                >
                  <option value="">Selecciona un color...</option>
                  {filaments.map((f) => (
                    <option key={f.id} value={`#${f.color_hex}`}>
                      {f.name || f.material} - {f.vendor?.name || "N/A"}
                    </option>
                  ))}
                </select>
                <div 
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border border-white/20 pointer-events-none"
                  style={{ backgroundColor: color || 'transparent' }}
                />
              </div>
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
