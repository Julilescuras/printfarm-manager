"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Wrench,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  Loader2,
  AlertCircle,
  Zap,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { api } from "@/lib/api";
import type { AssistantTool, MaterialTemps, CustomToolItem } from "@/lib/types";

// ── Toggle ─────────────────────────────────────────────────────────────────────
function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className="relative w-12 min-w-[3rem] h-6 rounded-full transition-colors duration-300 focus:outline-none shrink-0"
      style={{ backgroundColor: value ? "hsl(var(--primary))" : "hsl(var(--muted))" }}
    >
      <span
        className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-md transition-transform duration-300"
        style={{ transform: value ? "translateX(24px)" : "translateX(0px)" }}
      />
    </button>
  );
}

// ── Material Temps subsection ──────────────────────────────────────────────────
function MaterialTempsSection() {
  const [temps, setTemps] = useState<Record<string, { hotend: number; bed: number }>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [newMat, setNewMat] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await api.getMaterialTemps();
      setTemps(data);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    setStatus("idle");
    try {
      await api.updateMaterialTemps(temps);
      setStatus("success");
      setTimeout(() => setStatus("idle"), 2500);
    } catch {
      setStatus("error");
      setTimeout(() => setStatus("idle"), 2500);
    } finally {
      setSaving(false);
    }
  };

  const addMaterial = () => {
    const mat = newMat.trim().toUpperCase();
    if (!mat || temps[mat]) return;
    setTemps((prev) => ({ ...prev, [mat]: { hotend: 200, bed: 60 } }));
    setNewMat("");
  };

  const removeMaterial = (mat: string) => {
    setTemps((prev) => {
      const next = { ...prev };
      delete next[mat];
      return next;
    });
  };

  if (loading) return <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted-foreground text-xs">
              <th className="text-left pb-2 pr-4">Material</th>
              <th className="text-left pb-2 pr-4">Hotend (°C)</th>
              <th className="text-left pb-2 pr-4">Cama (°C)</th>
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {Object.entries(temps).map(([mat, t]) => (
              <tr key={mat}>
                <td className="py-2 pr-4 font-mono font-medium">{mat}</td>
                <td className="py-2 pr-4">
                  <input
                    type="number"
                    value={t.hotend}
                    min={0}
                    max={400}
                    onChange={(e) =>
                      setTemps((prev) => ({
                        ...prev,
                        [mat]: { ...prev[mat], hotend: Number(e.target.value) },
                      }))
                    }
                    className="w-20 px-2 py-1 rounded bg-secondary border border-border text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                  />
                </td>
                <td className="py-2 pr-4">
                  <input
                    type="number"
                    value={t.bed}
                    min={0}
                    max={150}
                    onChange={(e) =>
                      setTemps((prev) => ({
                        ...prev,
                        [mat]: { ...prev[mat], bed: Number(e.target.value) },
                      }))
                    }
                    className="w-20 px-2 py-1 rounded bg-secondary border border-border text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                  />
                </td>
                <td className="py-2 text-right">
                  <button
                    onClick={() => removeMaterial(mat)}
                    className="text-muted-foreground hover:text-red-400 transition-colors p-1"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={newMat}
          onChange={(e) => setNewMat(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addMaterial()}
          placeholder="Nuevo material (ej. FLEX)"
          className="flex-1 px-3 py-1.5 rounded bg-secondary border border-border text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none"
        />
        <button
          onClick={addMaterial}
          disabled={!newMat.trim()}
          className="flex items-center gap-1 px-3 py-1.5 rounded bg-secondary border border-border text-sm hover:bg-secondary/80 disabled:opacity-50 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Agregar
        </button>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {status === "success" ? "¡Guardado!" : "Guardar temperaturas"}
        </button>
        {status === "error" && (
          <span className="text-sm text-red-400 flex items-center gap-1">
            <AlertCircle className="w-4 h-4" />
            Error al guardar
          </span>
        )}
      </div>
    </div>
  );
}

// ── Tools list subsection ──────────────────────────────────────────────────────
function ToolsListSection() {
  const [tools, setTools] = useState<AssistantTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.getAssistantTools();
      setTools(data);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = async (name: string, enabled: boolean) => {
    setToggling(name);
    try {
      await api.setToolEnabled(name, enabled);
      setTools((prev) => prev.map((t) => (t.name === name ? { ...t, enabled } : t)));
    } catch {
      /* ignore */
    } finally {
      setToggling(null);
    }
  };

  if (loading) return <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;

  const builtins = tools.filter((t) => !t.is_custom);
  const customs = tools.filter((t) => t.is_custom);

  const ToolRow = ({ t }: { t: AssistantTool }) => (
    <div className="flex items-start gap-3 py-2.5 border-b border-border last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-sm font-medium">{t.name}</span>
          {t.is_action && (
            <span className="inline-flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/20">
              <Zap className="w-3 h-3" />
              acción
            </span>
          )}
          {t.is_custom && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400 border border-violet-500/20">
              personalizada
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{t.description}</p>
      </div>
      <div className="shrink-0 mt-0.5">
        {toggling === t.name ? (
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        ) : (
          <Toggle value={t.enabled} onChange={(v) => toggle(t.name, v)} />
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {builtins.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Integradas</p>
          <div>
            {builtins.map((t) => <ToolRow key={t.name} t={t} />)}
          </div>
        </div>
      )}
      {customs.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Personalizadas</p>
          <div>
            {customs.map((t) => <ToolRow key={t.name} t={t} />)}
          </div>
        </div>
      )}
      {tools.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">No hay herramientas registradas.</p>
      )}
    </div>
  );
}

// ── Custom tools subsection ────────────────────────────────────────────────────
const EMPTY_FORM = { name: "", description: "", gcode: "", is_action: true, requires_printer: true };

function CustomToolsSection() {
  const [tools, setTools] = useState<CustomToolItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<CustomToolItem | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.getCustomTools();
      setTools(data);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const startEdit = (t: CustomToolItem) => {
    setEditing(t);
    setForm({ name: t.name, description: t.description, gcode: t.gcode, is_action: t.is_action, requires_printer: t.requires_printer });
    setShowForm(true);
    setError(null);
  };

  const cancelForm = () => {
    setShowForm(false);
    setEditing(null);
    setForm(EMPTY_FORM);
    setError(null);
  };

  const submit = async () => {
    if (!form.name.trim() || !form.description.trim()) {
      setError("El nombre y la descripción son obligatorios.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Custom macros always run G-code on a printer: they're always actions
      // (need authorization) and always require a printer. Forced here too so
      // the UI never sends weaker flags.
      const payload = { ...form, is_action: true, requires_printer: true };
      if (editing) {
        await api.updateCustomTool(editing.id, payload);
      } else {
        await api.createCustomTool(payload);
      }
      cancelForm();
      await load();
    } catch (err: any) {
      setError(err.message || "Error al guardar.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    if (!window.confirm("¿Eliminar esta herramienta personalizada?")) return;
    setDeleting(id);
    try {
      await api.deleteCustomTool(id);
      setTools((prev) => prev.filter((t) => t.id !== id));
    } catch {
      /* ignore */
    } finally {
      setDeleting(null);
    }
  };

  if (loading) return <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      {tools.length > 0 && (
        <div className="space-y-2">
          {tools.map((t) => (
            <div key={t.id} className="flex items-start gap-3 p-3 rounded-lg bg-secondary/50 border border-border">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-sm font-medium">{t.name}</span>
                  {t.is_action && (
                    <span className="inline-flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/20">
                      <Zap className="w-3 h-3" />
                      acción
                    </span>
                  )}
                  {!t.enabled && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
                      deshabilitada
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{t.description}</p>
                {t.gcode && (
                  <pre className="mt-1 text-xs font-mono bg-black/30 rounded px-2 py-1 text-muted-foreground overflow-x-auto max-h-16">
                    {t.gcode}
                  </pre>
                )}
              </div>
              <div className="flex gap-1 shrink-0">
                <button
                  onClick={() => startEdit(t)}
                  className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => remove(t.id)}
                  disabled={deleting === t.id}
                  className="p-1.5 rounded text-muted-foreground hover:text-red-400 hover:bg-secondary transition-colors disabled:opacity-50"
                >
                  {deleting === t.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!showForm && (
        <button
          onClick={() => { setShowForm(true); setEditing(null); setForm(EMPTY_FORM); }}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary border border-border text-sm font-medium hover:bg-secondary/80 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Nueva herramienta
        </button>
      )}

      {showForm && (
        <div className="p-4 rounded-lg bg-secondary/50 border border-border space-y-3">
          <h4 className="font-medium text-sm">{editing ? "Editar herramienta" : "Nueva herramienta personalizada"}</h4>

          <div>
            <label className="block text-xs font-medium mb-1">Nombre (snake_case)</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="ej. calibrar_cama"
              className="w-full px-3 py-1.5 rounded bg-secondary border border-border text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Descripción (la ve el bot)</label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="ej. Inicia la calibración automática de la cama de una impresora."
              className="w-full px-3 py-1.5 rounded bg-secondary border border-border text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">G-code a ejecutar</label>
            <textarea
              value={form.gcode}
              onChange={(e) => setForm((f) => ({ ...f, gcode: e.target.value }))}
              placeholder={"BED_MESH_CALIBRATE\nSAVE_CONFIG"}
              rows={4}
              className="w-full px-3 py-2 rounded bg-secondary border border-border text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none font-mono resize-y"
            />
            <p className="text-xs text-muted-foreground mt-1">
              El G-code se ejecuta exactamente como está en la impresora elegida.
            </p>
          </div>

          <div className="flex items-start gap-2 text-xs text-muted-foreground bg-secondary/60 border border-border rounded-lg p-2.5">
            <Zap className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
            <span>
              Toda macro es una <span className="font-medium">acción</span>: requiere autorización
              (y PIN si está activado) y que se indique la impresora. Acepta grupos
              («las enders», «todas»).
            </span>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-2.5">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={submit}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {editing ? "Guardar cambios" : "Crear herramienta"}
            </button>
            <button
              onClick={cancelForm}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary border border-border font-medium text-sm hover:bg-secondary/80 transition-colors"
            >
              <X className="w-4 h-4" />
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────────
export function AssistantToolsPanel() {
  const [openSection, setOpenSection] = useState<"temps" | "tools" | "custom" | null>(null);

  const Section = ({
    id,
    title,
    children,
  }: {
    id: "temps" | "tools" | "custom";
    title: string;
    children: React.ReactNode;
  }) => {
    const open = openSection === id;
    return (
      <div className="border border-border rounded-lg overflow-hidden">
        <button
          onClick={() => setOpenSection(open ? null : id)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-secondary/50 transition-colors text-left"
        >
          {title}
          {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>
        {open && <div className="px-4 pb-4 pt-2 border-t border-border">{children}</div>}
      </div>
    );
  };

  return (
    <div className="glass-card p-6 space-y-4">
      <h2 className="text-lg font-semibold flex items-center gap-2">
        <Wrench className="w-5 h-5 text-teal-400" />
        Herramientas del bot
      </h2>
      <p className="text-sm text-muted-foreground -mt-2">
        Configurá qué puede hacer el asistente: ajustá temperaturas de precalentamiento, habilitá o
        deshabilitá herramientas existentes, y creá macros de G-code propias.
      </p>

      <Section id="temps" title="Temperaturas de precalentamiento">
        <MaterialTempsSection />
      </Section>

      <Section id="tools" title="Herramientas disponibles">
        <ToolsListSection />
      </Section>

      <Section id="custom" title="Herramientas personalizadas (macros G-code)">
        <CustomToolsSection />
      </Section>
    </div>
  );
}
