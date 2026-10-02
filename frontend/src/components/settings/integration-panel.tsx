"use client";

import React, { useEffect, useState } from "react";
import { Check, Copy, Eye, EyeOff, Link2, Loader2, RefreshCw } from "lucide-react";
import { api, apiUrl } from "@/lib/api";

// Tarjeta "Integración con Control Ventas": muestra, copia y regenera el token
// que Control Ventas usa para llamar a /api/integration/* (Authorization: Bearer).
export function IntegrationPanel() {
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");

  useEffect(() => {
    setUrl(apiUrl(""));
  }, []);

  useEffect(() => {
    api
      .getSettings()
      .then((d) => setToken(d.integration_token || ""))
      .catch(() => setError("No se pudo leer el token."))
      .finally(() => setLoading(false));
  }, []);

  const copy = async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
    } catch {
      // Fallback para contextos sin clipboard API (http en LAN).
      const ta = document.createElement("textarea");
      ta.value = token;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const regenerate = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.regenerateIntegrationToken();
      setToken(r.integration_token);
      setVisible(true);
      setConfirming(false);
    } catch (e: any) {
      setError(`No se pudo regenerar: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  const masked = token ? `${token.slice(0, 4)}${"•".repeat(24)}${token.slice(-4)}` : "";

  return (
    <div className="glass-card p-6 space-y-4">
      <h2 className="text-lg font-semibold flex items-center gap-2">
        <Link2 className="w-5 h-5 text-sky-400" />
        Integración con Control Ventas
      </h2>
      <p className="text-sm text-muted-foreground">
        Pegá este token en Control Ventas para que pueda consultar la granja y mandar
        trabajos. Viaja como <code className="bg-secondary px-1 rounded">Authorization: Bearer</code>.
      </p>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">URL de PrintFarm</label>
        <input
          readOnly
          value={url}
          onFocus={(e) => e.target.select()}
          className="w-full px-3 py-2 rounded-lg bg-secondary border border-border outline-none text-sm font-mono"
          aria-label="URL de PrintFarm"
        />
        <p className="text-xs text-muted-foreground">
          Pegá esta URL (con el puerto <code className="bg-secondary px-1 rounded">:8000</code>) y el token en
          Control Ventas → Configuración.
        </p>
      </div>

      {loading ? (
        <Loader2 className="w-5 h-5 animate-spin text-primary" />
      ) : (
        <div className="flex gap-2">
          <input
            readOnly
            value={visible ? token : masked}
            onFocus={(e) => visible && e.target.select()}
            className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-secondary border border-border outline-none text-sm font-mono"
            aria-label="Token de integración"
          />
          <button
            onClick={() => setVisible((v) => !v)}
            className="p-2 rounded-lg bg-secondary border border-border hover:bg-secondary/80 transition-colors"
            title={visible ? "Ocultar" : "Mostrar"}
          >
            {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
          <button
            onClick={copy}
            disabled={!token}
            className="p-2 rounded-lg bg-secondary border border-border hover:bg-secondary/80 transition-colors disabled:opacity-50"
            title="Copiar"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
      )}

      {confirming ? (
        <div className="flex flex-wrap items-center gap-2 text-sm bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
          <span className="flex-1 min-w-[12rem]">
            El token actual va a dejar de funcionar y vas a tener que pegar el nuevo en
            Control Ventas. ¿Seguís?
          </span>
          <button
            onClick={regenerate}
            disabled={busy}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-600 text-white font-medium hover:bg-amber-500 transition-colors disabled:opacity-50"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            Sí, regenerar
          </button>
          <button
            onClick={() => setConfirming(false)}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg bg-secondary border border-border hover:bg-secondary/80 transition-colors"
          >
            Cancelar
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary border border-border font-medium text-sm hover:bg-secondary/80 transition-colors disabled:opacity-50"
        >
          <RefreshCw className="w-4 h-4" />
          Regenerar token
        </button>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
      <p className="text-xs text-muted-foreground">
        La interfaz de PrintFarm no tiene login: cualquiera en la red local puede ver
        este token. No expongas el manager a Internet.
      </p>
    </div>
  );
}
