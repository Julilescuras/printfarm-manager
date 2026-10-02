"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Library, Search, Upload, Loader2, Play, Check, X, AlertTriangle, Trash2, Clock, Weight, Plus,
} from "lucide-react";
import { api } from "@/lib/api";
import type { LibraryEntry, LibraryStatus } from "@/lib/types";
import { cn, formatDuration } from "@/lib/utils";

const STATUS_META: Record<LibraryStatus, { label: string; emoji: string; className: string }> = {
  draft: { label: "Borrador", emoji: "📝", className: "text-muted-foreground border-border bg-secondary/60" },
  testing: { label: "En prueba", emoji: "🧪", className: "text-amber-400 border-amber-500/30 bg-amber-500/10" },
  approved: { label: "Aprobado", emoji: "✅", className: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" },
  rejected: { label: "Rechazado", emoji: "❌", className: "text-red-400 border-red-500/30 bg-red-500/10" },
  review: { label: "Revisar", emoji: "⚠️", className: "text-orange-400 border-orange-500/30 bg-orange-500/10" },
};

const STATUS_ORDER: LibraryStatus[] = ["draft", "testing", "approved", "rejected", "review"];

function sizeSort(a: string, b: string) {
  const na = parseFloat(a);
  const nb = parseFloat(b);
  if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
  return a.localeCompare(b);
}

export default function LibraryPage() {
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [printers, setPrinters] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [modelFilter, setModelFilter] = useState<string>("");
  const [showUpload, setShowUpload] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.getLibrary();
      setEntries(data);
      setError(null);
    } catch (e: any) {
      setError(e?.message || "No se pudo cargar la biblioteca");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    api.getPrinters().then(setPrinters).catch(() => {});
  }, [load]);

  const models = useMemo(() => {
    const set = new Set<string>();
    printers.forEach((p) => p.model && set.add(p.model));
    entries.forEach((e) => e.printer_model && set.add(e.printer_model));
    return Array.from(set).sort();
  }, [printers, entries]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (statusFilter && e.status !== statusFilter) return false;
      if (modelFilter && e.printer_model !== modelFilter) return false;
      if (q) {
        const hay = `${e.product_name} ${e.product_key} ${e.original_name} ${e.size} ${e.notes || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [entries, search, statusFilter, modelFilter]);

  // producto -> talle -> entradas
  const grouped = useMemo(() => {
    const products = new Map<string, { name: string; sizes: Map<string, LibraryEntry[]> }>();
    for (const e of filtered) {
      let p = products.get(e.product_key);
      if (!p) {
        p = { name: e.product_name || e.product_key, sizes: new Map() };
        products.set(e.product_key, p);
      }
      const list = p.sizes.get(e.size) ?? [];
      list.push(e);
      p.sizes.set(e.size, list);
    }
    return Array.from(products.entries()).sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [filtered]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Library className="w-6 h-6 text-primary" />
            Biblioteca
          </h1>
          <p className="text-sm text-muted-foreground">
            G-codes por producto y talle. Un G-code se prueba una vez y después se aprueba para producir.
          </p>
        </div>
        <button
          onClick={() => setShowUpload(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Subir G-code
        </button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[12rem]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar producto, talle, archivo o nota..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-secondary border border-border outline-none text-sm focus:border-primary"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 rounded-lg bg-secondary border border-border text-sm outline-none"
          aria-label="Filtrar por estado"
        >
          <option value="">Todos los estados</option>
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {STATUS_META[s].emoji} {STATUS_META[s].label}
            </option>
          ))}
        </select>
        <select
          value={modelFilter}
          onChange={(e) => setModelFilter(e.target.value)}
          className="px-3 py-2 rounded-lg bg-secondary border border-border text-sm outline-none"
          aria-label="Filtrar por impresora"
        >
          <option value="">Todas las impresoras</option>
          {models.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {loading ? (
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      ) : grouped.length === 0 ? (
        <div className="glass-card p-10 text-center text-muted-foreground">
          {entries.length === 0
            ? "Todavía no hay G-codes en la biblioteca. Subí el primero."
            : "Ningún G-code coincide con los filtros."}
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map(([key, product]) => (
            <section key={key} className="glass-card p-5 space-y-4">
              <h2 className="text-lg font-semibold">
                {product.name}{" "}
                <span className="text-xs font-mono text-muted-foreground">{key}</span>
              </h2>
              {Array.from(product.sizes.entries())
                .sort((a, b) => sizeSort(a[0], b[0]))
                .map(([size, list]) => (
                  <div key={size} className="space-y-2">
                    <h3 className="text-sm font-semibold text-muted-foreground">Talle {size}</h3>
                    <div className="space-y-2">
                      {list.map((e) => (
                        <EntryRow key={e.id} entry={e} onChanged={load} />
                      ))}
                    </div>
                  </div>
                ))}
            </section>
          ))}
        </div>
      )}

      {showUpload && (
        <UploadDialog
          models={models}
          printers={printers}
          onClose={() => setShowUpload(false)}
          onUploaded={() => {
            setShowUpload(false);
            load();
          }}
        />
      )}
    </div>
  );
}

// ─── Fila de G-code ───
function EntryRow({ entry, onChanged }: { entry: LibraryEntry; onChanged: () => void }) {
  const meta = STATUS_META[entry.status] ?? STATUS_META.draft;
  const [mode, setMode] = useState<null | "enqueue" | "reject" | "delete">(null);
  const [copies, setCopies] = useState(1);
  const [orderRef, setOrderRef] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async (fn: () => Promise<any>, okText?: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      if (okText) setMsg({ ok: true, text: okText });
      setMode(null);
      onChanged();
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || "Error" });
    } finally {
      setBusy(false);
    }
  };

  const canEnqueue = entry.status === "draft" || entry.status === "testing" || entry.status === "approved";
  const isTestRun = entry.status === "draft" || entry.status === "testing";

  const btn = "px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors disabled:opacity-50";
  const neutral = "bg-secondary border-border hover:bg-secondary/80";

  return (
    <div className="rounded-lg border border-border bg-card/40 p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full border", meta.className)}>
          {meta.emoji} {meta.label}
        </span>
        <span className="text-sm font-medium">{entry.printer_model}</span>
        <span className="text-xs text-muted-foreground">🔧 {entry.nozzle}mm</span>
        <span className="text-xs text-muted-foreground">🧵 {entry.material}</span>
        <span className="text-xs text-muted-foreground">{entry.units_per_plate} u/placa</span>
        {entry.estimated_time_secs ? (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="w-3 h-3" /> {formatDuration(entry.estimated_time_secs)}
          </span>
        ) : null}
        {entry.estimated_weight_g ? (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Weight className="w-3 h-3" /> {entry.estimated_weight_g.toFixed(1)} g
          </span>
        ) : null}
        {!entry.file_exists && (
          <span className="text-xs text-red-400">Archivo faltante en disco</span>
        )}
      </div>
      <div className="text-xs font-mono text-muted-foreground truncate">{entry.original_name}</div>
      {entry.notes && <div className="text-xs text-muted-foreground">📝 {entry.notes}</div>}

      {/* Acciones */}
      {mode === null && (
        <div className="flex flex-wrap gap-1.5">
          {canEnqueue && entry.file_exists && (
            <button
              onClick={() => setMode("enqueue")}
              className={cn(btn, "bg-primary/20 text-primary border-primary/30 hover:bg-primary/30")}
            >
              <Play className="w-3 h-3 inline -mt-0.5 mr-1" />
              {isTestRun ? "Encolar prueba" : "Encolar"}
            </button>
          )}
          {entry.status !== "approved" && (
            <button
              disabled={busy}
              onClick={() => run(() => api.updateLibraryEntry(entry.id, { status: "approved" }))}
              className={cn(btn, "text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10")}
            >
              <Check className="w-3 h-3 inline -mt-0.5 mr-1" />
              Aprobar
            </button>
          )}
          {entry.status !== "rejected" && (
            <button
              disabled={busy}
              onClick={() => setMode("reject")}
              className={cn(btn, "text-red-400 border-red-500/30 hover:bg-red-500/10")}
            >
              <X className="w-3 h-3 inline -mt-0.5 mr-1" />
              Rechazar
            </button>
          )}
          {entry.status !== "review" && (
            <button
              disabled={busy}
              onClick={() => run(() => api.updateLibraryEntry(entry.id, { status: "review" }))}
              className={cn(btn, "text-orange-400 border-orange-500/30 hover:bg-orange-500/10")}
            >
              <AlertTriangle className="w-3 h-3 inline -mt-0.5 mr-1" />
              Marcar revisar
            </button>
          )}
          <button
            disabled={busy}
            onClick={() => setMode("delete")}
            className={cn(btn, "ml-auto text-muted-foreground border-transparent hover:text-red-400 hover:bg-red-500/10")}
            title="Borrar"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {mode === "enqueue" && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {isTestRun ? (
            <span className="text-xs text-amber-400">🧪 Se encola 1 placa de prueba.</span>
          ) : (
            <label className="flex items-center gap-1.5 text-xs">
              Copias
              <input
                type="number"
                min={1}
                max={100}
                value={copies}
                onChange={(e) => setCopies(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-16 px-2 py-1 rounded bg-secondary border border-border text-center outline-none focus:border-primary"
              />
            </label>
          )}
          <input
            value={orderRef}
            onChange={(e) => setOrderRef(e.target.value)}
            placeholder="Pedido (opcional)"
            className="px-2 py-1 rounded bg-secondary border border-border text-xs outline-none focus:border-primary"
          />
          <button
            disabled={busy}
            onClick={() =>
              run(
                () =>
                  api.enqueueLibraryEntry(entry.id, {
                    copies: isTestRun ? 1 : copies,
                    ...(orderRef.trim() ? { order_ref: orderRef.trim() } : {}),
                  }),
                "Agregado a la cola"
              )
            }
            className={cn(btn, "bg-primary/20 text-primary border-primary/30")}
          >
            {busy ? "Encolando..." : "Confirmar"}
          </button>
          <button onClick={() => setMode(null)} className={cn(btn, neutral)}>Cancelar</button>
        </div>
      )}

      {mode === "reject" && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Motivo (nota)"
            className="flex-1 min-w-[12rem] px-2 py-1 rounded bg-secondary border border-border text-xs outline-none focus:border-primary"
          />
          <button
            disabled={busy}
            onClick={() =>
              run(() =>
                api.updateLibraryEntry(entry.id, {
                  status: "rejected",
                  ...(note.trim() ? { notes: note.trim() } : {}),
                })
              )
            }
            className={cn(btn, "text-red-400 border-red-500/30 hover:bg-red-500/10")}
          >
            Rechazar
          </button>
          <button onClick={() => setMode(null)} className={cn(btn, neutral)}>Cancelar</button>
        </div>
      )}

      {mode === "delete" && (
        <div className="flex flex-wrap items-center gap-2 text-sm bg-red-500/10 border border-red-500/20 rounded-lg p-2">
          <span className="flex-1 min-w-[12rem] text-xs">
            Se borra la entrada y el archivo G-code. ¿Seguís?
          </span>
          <button
            disabled={busy}
            onClick={() => run(() => api.deleteLibraryEntry(entry.id))}
            className={cn(btn, "bg-red-600 text-white border-red-600 hover:bg-red-500")}
          >
            Sí, borrar
          </button>
          <button onClick={() => setMode(null)} className={cn(btn, neutral)}>Cancelar</button>
        </div>
      )}

      {msg && <p className={cn("text-xs", msg.ok ? "text-emerald-400" : "text-red-400")}>{msg.text}</p>}
    </div>
  );
}

// ─── Subir G-code ───
function UploadDialog({
  models,
  printers,
  onClose,
  onUploaded,
}: {
  models: string[];
  printers: any[];
  onClose: () => void;
  onUploaded: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [productKey, setProductKey] = useState("");
  const [productName, setProductName] = useState("");
  const [size, setSize] = useState("");
  const [model, setModel] = useState("");
  const [nozzle, setNozzle] = useState("0.4");
  const [material, setMaterial] = useState("PLA");
  const [units, setUnits] = useState(1);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const printerModels = useMemo(() => {
    const set = new Set<string>();
    printers.forEach((p) => p.model && set.add(p.model));
    return Array.from(set).sort();
  }, [printers]);
  const modelOptions = printerModels.length ? printerModels : models;

  useEffect(() => {
    if (!model && modelOptions.length) setModel(modelOptions[0]);
  }, [modelOptions, model]);

  // Boquilla sugerida según una impresora de ese modelo
  useEffect(() => {
    const p = printers.find((x) => x.model === model && x.nozzle_size);
    if (p) setNozzle(String(p.nozzle_size));
  }, [model, printers]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return setError("Elegí un archivo G-code.");
    if (!productKey.trim() || !productName.trim() || !size.trim() || !model) {
      return setError("Completá producto, nombre, talle e impresora.");
    }
    const nozzleNum = parseFloat(nozzle.trim().replace(",", "."));
    if (!isFinite(nozzleNum) || nozzleNum <= 0) return setError("Boquilla inválida.");
    const fd = new FormData();
    fd.append("gcode", file);
    fd.append("product_key", productKey.trim());
    fd.append("product_name", productName.trim());
    fd.append("size", size.trim());
    fd.append("printer_model", model);
    fd.append("nozzle", String(nozzleNum));
    fd.append("material", material.trim() || "PLA");
    fd.append("units_per_plate", String(units));
    if (notes.trim()) fd.append("notes", notes.trim());
    setBusy(true);
    setError(null);
    try {
      await api.uploadLibraryEntry(fd);
      onUploaded();
    } catch (err: any) {
      setError(err?.message || "No se pudo subir el archivo");
      setBusy(false);
    }
  };

  const input = "w-full px-3 py-2 rounded-lg bg-secondary border border-border outline-none text-sm focus:border-primary";
  const label = "text-xs text-muted-foreground space-y-1 block";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={() => !busy && onClose()}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="glass-card w-full max-w-lg max-h-[90vh] overflow-y-auto custom-scrollbar p-6 space-y-4"
      >
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Upload className="w-5 h-5 text-primary" />
          Subir G-code a la biblioteca
        </h2>

        <label className={label}>
          Archivo G-code
          <input ref={fileRef} type="file" accept=".gcode,.gco,.g" className={input} />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className={label}>
            Clave de producto
            <input value={productKey} onChange={(e) => setProductKey(e.target.value)} placeholder="ej. maceta-torre" className={input} />
          </label>
          <label className={label}>
            Nombre
            <input value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="ej. Maceta Torre" className={input} />
          </label>
          <label className={label}>
            Talle
            <input value={size} onChange={(e) => setSize(e.target.value)} placeholder="ej. 100" className={input} />
          </label>
          <label className={label}>
            Unidades por placa
            <input type="number" min={1} value={units} onChange={(e) => setUnits(Math.max(1, parseInt(e.target.value) || 1))} className={input} />
          </label>
          <label className={label}>
            Modelo de impresora
            <select value={model} onChange={(e) => setModel(e.target.value)} className={input}>
              {modelOptions.length === 0 && <option value="">Sin impresoras</option>}
              {modelOptions.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>
          <label className={label}>
            Boquilla (mm)
            <input value={nozzle} onChange={(e) => setNozzle(e.target.value)} inputMode="decimal" className={input} />
          </label>
          <label className={label}>
            Material
            <input value={material} onChange={(e) => setMaterial(e.target.value)} className={input} />
          </label>
          <label className={label}>
            Notas (opcional)
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className={input} />
          </label>
        </div>

        <p className="text-xs text-muted-foreground">
          Entra como borrador: la primera vez se imprime como prueba y, si sale bien, queda aprobado.
        </p>
        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 rounded-lg bg-secondary border border-border text-sm hover:bg-secondary/80 transition-colors"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={busy}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            Subir
          </button>
        </div>
      </form>
    </div>
  );
}
