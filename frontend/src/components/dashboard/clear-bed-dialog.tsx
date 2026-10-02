"use client";

import { useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import type { BedOutcome, PrintHistoryEntry } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Diálogo único para vaciar la cama. Lo usan el dashboard y el detalle de impresora.
 * Mira la última fila de historial de la impresora sin veredicto: si era una prueba
 * (is_test) pregunta "¿Salió bien?"; si no, vacía normal con opción discreta "Salió mal".
 */
export function ClearBedDialog({
  printerId,
  printerName,
  onClose,
  onDone,
}: {
  printerId: number;
  printerName: string;
  onClose: () => void;
  onDone?: () => void;
}) {
  const [last, setLast] = useState<PrintHistoryEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [choice, setChoice] = useState<BedOutcome | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .getHistory(50)
      .then((rows) => {
        if (!alive) return;
        const mine = rows
          .filter((r) => r.printer_id === printerId && !r.outcome)
          .sort((a, b) => b.id - a.id);
        setLast(mine[0] ?? null);
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [printerId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const isTest = !!last?.is_test;

  const submit = async (outcome?: BedOutcome) => {
    setBusy(true);
    setError(null);
    try {
      await api.clearBed(printerId, {
        ...(outcome ? { outcome } : {}),
        ...(outcome === "bad" && note.trim() ? { note: note.trim() } : {}),
      });
      onDone?.();
      onClose();
    } catch (e: any) {
      setError(e?.message || "Error al vaciar la cama");
      setBusy(false);
    }
  };

  const noteBox = (
    <textarea
      value={note}
      onChange={(e) => setNote(e.target.value)}
      rows={2}
      placeholder="¿Qué salió mal? (opcional)"
      className="w-full px-3 py-2 rounded-lg bg-secondary border border-border outline-none text-sm"
    />
  );

  const spinner = busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => {
        e.stopPropagation();
        if (!busy) onClose();
      }}
    >
      <div className="glass-card w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold">🧹 Vaciar cama · {printerName}</h2>

        {loading ? (
          <Loader2 className="w-5 h-5 animate-spin text-primary" />
        ) : isTest ? (
          <>
            <p className="text-sm">
              🧪 Esto era una <b>prueba</b>
              {last?.job_name ? <> ({last.job_name})</> : null}. ¿Salió bien?
            </p>
            <div className="grid grid-cols-2 gap-2">
              {(["ok", "bad"] as BedOutcome[]).map((o) => (
                <button
                  key={o}
                  onClick={() => setChoice(o)}
                  className={cn(
                    "py-2 rounded-lg border text-sm font-semibold transition-colors",
                    choice === o
                      ? o === "ok"
                        ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400"
                        : "bg-red-500/20 border-red-500/40 text-red-400"
                      : "bg-secondary border-border hover:bg-secondary/80"
                  )}
                >
                  {o === "ok" ? "✅ Salió bien" : "❌ Salió mal"}
                </button>
              ))}
            </div>
            {choice === "bad" && noteBox}
            <button
              onClick={() => choice && submit(choice)}
              disabled={!choice || busy}
              className="btn-clear-bed flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {spinner}
              Vaciar y guardar veredicto
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Confirmá que la cama está libre para seguir con la cola.
            </p>
            {choice === "bad" && noteBox}
            <button
              onClick={() => submit(choice === "bad" ? "bad" : undefined)}
              disabled={busy}
              className="btn-clear-bed flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {spinner}
              {choice === "bad" ? "Vaciar y marcar que salió mal" : "Vaciar Cama y Continuar"}
            </button>
            <button
              onClick={() => setChoice(choice === "bad" ? null : "bad")}
              className="block mx-auto text-xs text-muted-foreground hover:text-foreground underline"
            >
              {choice === "bad" ? "No, salió bien" : "Salió mal"}
            </button>
          </>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          onClick={onClose}
          disabled={busy}
          className="w-full py-2 rounded-lg bg-secondary border border-border text-sm hover:bg-secondary/80 transition-colors"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
