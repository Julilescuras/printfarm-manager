"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Plus, Settings, Trash2, Printer as PrinterIcon, X, ExternalLink } from "lucide-react";
import { api } from "@/lib/api";
import type { PrinterState } from "@/lib/types";

export default function PrintersPage() {
  const [printers, setPrinters] = useState<PrinterState[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingPrinter, setEditingPrinter] = useState<PrinterState | null>(null);

  const fetchPrinters = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await api.getPrinters();
      setPrinters(data);
    } catch (error) {
      console.error("Error fetching printers:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPrinters();
  }, [fetchPrinters]);

  const handleDelete = async (id: number) => {
    if (!window.confirm("¿Seguro que querés eliminar esta impresora?")) return;
    try {
      await api.deletePrinter(id);
      fetchPrinters();
    } catch (error) {
      console.error("Error deleting printer:", error);
      alert("Error al eliminar la impresora");
    }
  };

  const handleEdit = (printer: PrinterState) => {
    setEditingPrinter(printer);
    setShowModal(true);
  };

  const handleAdd = () => {
    setEditingPrinter(null);
    setShowModal(true);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gradient">Gestión de Impresoras</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Agrega, edita o elimina impresoras de la granja
          </p>
        </div>
        <button
          onClick={handleAdd}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Nueva Impresora
        </button>
      </div>

      {/* Printer List */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {printers.map((printer) => (
          <div key={printer.id} className="glass-card p-5">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
                  <PrinterIcon className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-bold text-lg leading-tight">{printer.name}</h3>
                  <p className="text-xs text-muted-foreground">{printer.model}</p>
                </div>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => handleEdit(printer)}
                  className="p-2 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Settings className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDelete(printer.id)}
                  className="p-2 rounded-lg hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Extrusor:</span>
                <span className={`font-medium ${printer.extruder_type === "bowden" ? "text-amber-400" : "text-primary"}`}>
                  {printer.extruder_type === "bowden" ? "Bowden" : "Direct Drive"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Boquilla:</span>
                <span>{printer.nozzle_size} mm</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">URL Moonraker:</span>
                <span className="font-mono text-xs truncate max-w-[160px]">{printer.moonraker_url}</span>
              </div>
              {printer.fluidd_url && (
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Interfaz:</span>
                  <a
                    href={printer.fluidd_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    Abrir <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {printers.length === 0 && !isLoading && (
        <div className="glass-card p-12 text-center">
          <PrinterIcon className="w-12 h-12 mx-auto text-muted-foreground mb-4 opacity-50" />
          <h3 className="text-lg font-bold mb-1">Sin impresoras</h3>
          <p className="text-muted-foreground mb-4">
            No hay impresoras configuradas en la granja.
          </p>
          <button
            onClick={handleAdd}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90"
          >
            Agregar mi primera impresora
          </button>
        </div>
      )}

      {/* Modal Add/Edit */}
      {showModal && (
        <PrinterModal
          printer={editingPrinter}
          onClose={() => setShowModal(false)}
          onSuccess={() => {
            setShowModal(false);
            fetchPrinters();
          }}
        />
      )}
    </div>
  );
}

function PrinterModal({
  printer,
  onClose,
  onSuccess,
}: {
  printer: PrinterState | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState(printer?.name || "");
  const [model, setModel] = useState(printer?.model || "");
  const [url, setUrl] = useState(printer?.moonraker_url || "http://");
  const [nozzle, setNozzle] = useState(printer?.nozzle_size?.toString() || "0.4");
  const [extruderType, setExtruderType] = useState<"direct_drive" | "bowden">(
    printer?.extruder_type || "direct_drive"
  );
  const [fluiddUrl, setFluiddUrl] = useState(printer?.fluidd_url || "");
  const [cameraUrl, setCameraUrl] = useState(printer?.camera_url || "");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    const payload = {
      name,
      model,
      moonraker_url: url,
      nozzle_size: parseFloat(nozzle),
      extruder_type: extruderType,
      fluidd_url: fluiddUrl || null,
      camera_url: cameraUrl || null,
    };

    try {
      if (printer) {
        await api.updatePrinter(printer.id, payload);
      } else {
        await api.createPrinter(payload);
      }
      onSuccess();
    } catch (error) {
      console.error("Error saving printer:", error);
      alert("Error al guardar la impresora. Verificá que la URL sea única.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass-card w-full max-w-md mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold">
            {printer ? "Editar Impresora" : "Nueva Impresora"}
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-secondary rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1.5">Nombre (Ej: Ender3-01)</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-secondary border border-border focus:border-primary outline-none"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">Modelo (Ej: Ender 3 V2 Neo)</label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-secondary border border-border focus:border-primary outline-none"
              required
            />
          </div>

          {/* Extruder type selector */}
          <div>
            <label className="block text-sm font-medium mb-1.5">Tipo de Extrusor</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setExtruderType("direct_drive")}
                className={`py-3 px-4 rounded-lg border text-sm font-medium transition-all ${
                  extruderType === "direct_drive"
                    ? "bg-primary/20 border-primary text-primary"
                    : "bg-secondary border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                <div className="text-lg mb-1">⚡</div>
                Direct Drive
              </button>
              <button
                type="button"
                onClick={() => setExtruderType("bowden")}
                className={`py-3 px-4 rounded-lg border text-sm font-medium transition-all ${
                  extruderType === "bowden"
                    ? "bg-amber-500/20 border-amber-500/50 text-amber-400"
                    : "bg-secondary border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                <div className="text-lg mb-1">🪈</div>
                Bowden
              </button>
            </div>
            {extruderType === "bowden" && (
              <p className="text-xs text-amber-400/80 mt-1.5">
                ✓ Se agregarán tareas de mantenimiento del tubo PTFE
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">URL Moonraker</label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://192.168.1.100:7125"
              className="w-full px-3 py-2 rounded-lg bg-secondary border border-border focus:border-primary outline-none"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">
              URL de Interfaz Web (Fluidd / Sonic Pad)
              <span className="text-muted-foreground font-normal ml-1">(opcional)</span>
            </label>
            <input
              type="url"
              value={fluiddUrl}
              onChange={(e) => setFluiddUrl(e.target.value)}
              placeholder="http://192.168.1.100"
              className="w-full px-3 py-2 rounded-lg bg-secondary border border-border focus:border-primary outline-none"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Ej: la IP del Sonic Pad o la URL de Fluidd de la Elegoo
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">
              URL Cámara (stream MJPEG)
              <span className="text-muted-foreground font-normal ml-1">(opcional)</span>
            </label>
            <input
              type="url"
              value={cameraUrl}
              onChange={(e) => setCameraUrl(e.target.value)}
              placeholder="http://192.168.1.101:8080/stream"
              className="w-full px-3 py-2 rounded-lg bg-secondary border border-border focus:border-primary outline-none"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Ej: ESP32-CAM en la misma red local
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">Tamaño de Boquilla (mm)</label>
            <input
              type="number"
              step="0.1"
              min="0.1"
              value={nozzle}
              onChange={(e) => setNozzle(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-secondary border border-border focus:border-primary outline-none"
              required
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3 mt-2 rounded-lg bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {isSubmitting ? "Guardando..." : "Guardar Impresora"}
          </button>
        </form>
      </div>
    </div>
  );
}
