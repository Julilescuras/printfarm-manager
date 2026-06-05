"use client";

import React, { useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  Loader2,
  Trash2,
  RotateCcw,
  X,
} from "lucide-react";
import { api } from "@/lib/api";

// A destructive action gated behind a typed-word confirmation. The user must
// type the exact word before the action button enables — prevents accidental
// clicks on irreversible operations.
function ConfirmModal({
  title,
  description,
  confirmWord,
  actionLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  description: React.ReactNode;
  confirmWord: string;
  actionLabel: string;
  onConfirm: () => Promise<any>;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const matches = text.trim().toUpperCase() === confirmWord.toUpperCase();

  const run = async () => {
    if (!matches || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await onConfirm();
      setResult({ ok: true, msg: r?.message || "Acción completada." });
    } catch (e: any) {
      setResult({ ok: false, msg: `Error: ${e?.message || e}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass-card w-full max-w-md mx-4 p-6 space-y-4 border-red-500/30">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold flex items-center gap-2 text-red-400">
            <AlertTriangle className="w-5 h-5" /> {title}
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-secondary rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="text-sm text-muted-foreground">{description}</div>

        {result ? (
          <div
            className={`text-sm p-3 rounded-lg border ${
              result.ok
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                : "bg-red-500/10 text-red-400 border-red-500/20"
            }`}
          >
            {result.msg}
          </div>
        ) : (
          <>
            <div>
              <label className="block text-xs text-muted-foreground mb-1.5">
                Escribí <span className="font-mono font-bold text-red-400">{confirmWord}</span>{" "}
                para confirmar
              </label>
              <input
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && run()}
                className="w-full px-3 py-2 rounded-lg bg-secondary border border-border focus:border-red-500 outline-none text-sm font-mono"
                placeholder={confirmWord}
              />
            </div>

            <button
              onClick={run}
              disabled={!matches || busy}
              className="w-full py-2.5 rounded-lg bg-red-600 text-white font-semibold text-sm hover:bg-red-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />}
              {busy ? "Ejecutando..." : actionLabel}
            </button>
          </>
        )}

        {result && (
          <button
            onClick={onClose}
            className="w-full py-2 rounded-lg bg-secondary hover:bg-secondary/80 text-sm font-medium transition-colors"
          >
            Cerrar
          </button>
        )}
      </div>
    </div>
  );
}

export function DangerZone() {
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState<null | "reset" | "purge">(null);

  return (
    <div className="glass-card p-6 space-y-4 border-red-500/20">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between text-left"
      >
        <h2 className="text-lg font-semibold flex items-center gap-2 text-red-400">
          <AlertTriangle className="w-5 h-5" />
          Zona peligrosa
        </h2>
        <ChevronDown
          className={`w-5 h-5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="space-y-4 pt-2">
          <p className="text-xs text-muted-foreground">
            Estas acciones son irreversibles. Cada una pide una confirmación
            escrita antes de ejecutarse.
          </p>

          {/* Reset maintenance */}
          <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-secondary/40 border border-border">
            <div className="min-w-0">
              <p className="text-sm font-medium">Reiniciar horas de mantenimiento</p>
              <p className="text-xs text-muted-foreground">
                Pone en cero los contadores de TODOS los mantenimientos de TODAS las impresoras.
              </p>
            </div>
            <button
              onClick={() => setModal("reset")}
              className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-red-400 border border-red-500/30 hover:bg-red-500/10 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Reiniciar
            </button>
          </div>

          {/* Purge gcodes */}
          <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-secondary/40 border border-border">
            <div className="min-w-0">
              <p className="text-sm font-medium">Vaciar G-codes del servidor</p>
              <p className="text-xs text-muted-foreground">
                Borra los archivos G-code almacenados para liberar espacio. Se
                conservan los de trabajos pendientes o en impresión.
              </p>
            </div>
            <button
              onClick={() => setModal("purge")}
              className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-red-400 border border-red-500/30 hover:bg-red-500/10 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" /> Vaciar
            </button>
          </div>
        </div>
      )}

      {modal === "reset" && (
        <ConfirmModal
          title="Reiniciar mantenimientos"
          description={
            <>
              Vas a poner en <strong>cero</strong> las horas acumuladas de todos
              los mantenimientos de todas las impresoras. El historial de reinicios
              se conserva. Esta acción no se puede deshacer.
            </>
          }
          confirmWord="REINICIAR"
          actionLabel="Reiniciar todos los contadores"
          onConfirm={() => api.resetAllMaintenance()}
          onClose={() => setModal(null)}
        />
      )}

      {modal === "purge" && (
        <ConfirmModal
          title="Vaciar G-codes"
          description={
            <>
              Vas a <strong>borrar del servidor</strong> los archivos G-code
              almacenados. Se conservan los de trabajos pendientes o en impresión
              para no romper la cola. Esta acción no se puede deshacer.
            </>
          }
          confirmWord="VACIAR"
          actionLabel="Vaciar G-codes ahora"
          onConfirm={() => api.purgeGcodes()}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
