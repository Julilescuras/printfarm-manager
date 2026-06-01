"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Package, AlertCircle, Wifi, WifiOff, Search, X, Filter } from "lucide-react";
import { api } from "@/lib/api";
import { useWSContext } from "@/providers/websocket-provider";

interface SpoolData {
  id: number;
  filament?: {
    id?: number;
    name?: string;
    material?: string;
    color_hex?: string;
    diameter?: number;
    vendor?: { id?: number; name?: string };
  };
  remaining_weight?: number;
  used_weight?: number;
  first_used?: string;
  last_used?: string;
}

const LOW_STOCK_THRESHOLD_G = 100;

export default function FilamentPage() {
  const [spools, setSpools] = useState<SpoolData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [spoolmanConnected, setSpoolmanConnected] = useState(false);
  const [assigningSpoolId, setAssigningSpoolId] = useState<number | null>(null);
  const [searchText, setSearchText] = useState("");
  const [filterMaterial, setFilterMaterial] = useState("all");
  const [filterAvailability, setFilterAvailability] = useState<"all" | "available" | "assigned">("all");
  const { printers, refreshState } = useWSContext();

  const fetchSpools = useCallback(async () => {
    try {
      const health = await api.getSpoolmanHealth();
      setSpoolmanConnected(health.connected);
      if (health.connected) {
        const data = await api.getSpools();
        setSpools(data);
      }
    } catch (error) {
      console.error("Error fetching spools:", error);
      setSpoolmanConnected(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSpools();
  }, [fetchSpools]);

  const handleAssignSpool = async (printerId: number, spoolId: number) => {
    try {
      await api.assignSpool(printerId, spoolId);
      await refreshState();
      setAssigningSpoolId(null);
    } catch (error) {
      console.error("Error assigning spool:", error);
    }
  };

  const handleUnassignSpool = async (spoolId: number) => {
    // Find the printer that has this spool
    const assignedPrinter = printers.find((p) => p.current_spool_id === spoolId);
    if (!assignedPrinter) return;
    try {
      await api.assignSpool(assignedPrinter.id, null);
      await refreshState();
    } catch (error) {
      console.error("Error unassigning spool:", error);
    }
  };

  // Build list of unique materials for the filter
  const materials = useMemo(() => {
    const set = new Set<string>();
    spools.forEach((s) => {
      const mat = s.filament?.material;
      if (mat) set.add(mat);
    });
    return Array.from(set).sort();
  }, [spools]);

  // Map of printerId -> spool assignment (for quick lookup)
  const spoolAssignments = useMemo(() => {
    const map = new Map<number, number>(); // spoolId -> printerId
    printers.forEach((p) => {
      if (p.current_spool_id) map.set(p.current_spool_id, p.id);
    });
    return map;
  }, [printers]);

  // Printers that don't have any spool assigned
  const availablePrinters = useMemo(
    () => printers.filter((p) => !p.current_spool_id),
    [printers]
  );

  // Filtered + sorted spools
  const filteredSpools = useMemo(() => {
    return spools.filter((spool) => {
      const filament = spool.filament || {};
      const isAssigned = spoolAssignments.has(spool.id);

      // Availability filter
      if (filterAvailability === "available" && isAssigned) return false;
      if (filterAvailability === "assigned" && !isAssigned) return false;

      // Material filter
      if (filterMaterial !== "all" && filament.material !== filterMaterial) return false;

      // Text search
      if (searchText) {
        const q = searchText.toLowerCase();
        const name = (filament.name || "").toLowerCase();
        const material = (filament.material || "").toLowerCase();
        const vendor = (filament.vendor?.name || "").toLowerCase();
        if (!name.includes(q) && !material.includes(q) && !vendor.includes(q)) return false;
      }

      return true;
    });
  }, [spools, searchText, filterMaterial, filterAvailability, spoolAssignments]);

  // Separate into sections
  const assignedSpools = filteredSpools.filter((s) => spoolAssignments.has(s.id));
  const availableSpools = filteredSpools.filter((s) => !spoolAssignments.has(s.id));

  const renderSpool = (spool: SpoolData) => {
    const filament = spool.filament || {};
    const colorHex = filament.color_hex ? `#${filament.color_hex.replace("#", "")}` : "#888888";
    const material = filament.material || "Unknown";
    const vendor = filament.vendor?.name || "Unknown";
    const remaining = spool.remaining_weight;
    const used = spool.used_weight || 0;
    const total = remaining != null ? remaining + used : null;
    const usagePercent = total && total > 0 ? ((total - used) / total) * 100 : 100;
    const assignedPrinter = printers.find((p) => p.current_spool_id === spool.id);
    const isLowStock = remaining != null && remaining < LOW_STOCK_THRESHOLD_G;
    const isAssigning = assigningSpoolId === spool.id;

    return (
      <div key={spool.id} className={`glass-card-hover p-5 space-y-3 ${isLowStock ? "border-amber-500/30" : ""}`}>
        <div className="flex items-start gap-3">
          {/* Color swatch */}
          <div
            className="w-12 h-12 rounded-xl border-2 border-white/10 shrink-0"
            style={{
              backgroundColor: colorHex,
              boxShadow: `0 4px 12px ${colorHex}40`,
            }}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold truncate">
                {filament.name || `Spool #${spool.id}`}
              </h3>
              {isLowStock && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 shrink-0">
                  ⚠️ Stock bajo
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {material} · {vendor}
            </p>
          </div>
          <span className="text-xs font-mono text-muted-foreground shrink-0">
            #{spool.id}
          </span>
        </div>

        {/* Weight bar */}
        {remaining != null && (
          <div>
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>Restante</span>
              <span className={`font-mono ${isLowStock ? "text-amber-400" : ""}`}>
                {remaining.toFixed(0)}g
                {total ? ` / ${total.toFixed(0)}g` : ""}
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-secondary overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${usagePercent}%`,
                  backgroundColor: isLowStock ? "#f59e0b" : colorHex,
                }}
              />
            </div>
          </div>
        )}

        {/* Assigned printer badge */}
        {assignedPrinter && (
          <div className="flex items-center justify-between gap-2 bg-primary/10 text-primary px-3 py-2 rounded-lg">
            <div className="flex items-center gap-2 text-xs">
              <Package className="w-3 h-3" />
              Asignado a: <span className="font-semibold">{assignedPrinter.name}</span>
            </div>
            <button
              onClick={() => handleUnassignSpool(spool.id)}
              className="text-xs text-muted-foreground hover:text-red-400 transition-colors flex items-center gap-1"
              title="Desasignar"
            >
              <X className="w-3 h-3" />
              Desasignar
            </button>
          </div>
        )}

        {/* Assign to printer */}
        {!assignedPrinter && (
          <div>
            {isAssigning ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Seleccioná la impresora:</p>
                <div className="space-y-1">
                  {availablePrinters.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic px-2">
                      Todas las impresoras ya tienen un filamento asignado
                    </p>
                  ) : (
                    availablePrinters.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => handleAssignSpool(p.id, spool.id)}
                        className="w-full text-left px-3 py-2 rounded-lg bg-secondary hover:bg-secondary/80 text-sm transition-colors"
                      >
                        <span className="font-medium">{p.name}</span>
                        <span className="text-xs text-muted-foreground ml-2">{p.model}</span>
                      </button>
                    ))
                  )}
                </div>
                <button
                  onClick={() => setAssigningSpoolId(null)}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <button
                onClick={() => setAssigningSpoolId(spool.id)}
                disabled={availablePrinters.length === 0}
                className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-sm hover:bg-secondary/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {availablePrinters.length === 0
                  ? "Todas las impresoras asignadas"
                  : "Asignar a impresora..."}
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gradient">Inventario de Filamento</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Gestión de spools vía Spoolman · {spools.length} bobinas en total
          </p>
        </div>
        <div className="flex items-center gap-2">
          {spoolmanConnected ? (
            <span className="flex items-center gap-1.5 text-xs text-primary">
              <Wifi className="w-3.5 h-3.5" />
              Spoolman conectado
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs text-status-error">
              <WifiOff className="w-3.5 h-3.5" />
              Spoolman desconectado
            </span>
          )}
        </div>
      </div>

      {!spoolmanConnected && (
        <div className="glass-card p-6 border-amber-500/30">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-amber-400">Spoolman no disponible</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Verificá que el contenedor de Spoolman esté corriendo en{" "}
                <code className="text-xs bg-secondary px-1.5 py-0.5 rounded">
                  {typeof window !== 'undefined' ? `http://${window.location.hostname}:7912` : 'http://tu-servidor:7912'}
                </code>
              </p>
            </div>
          </div>
        </div>
      )}

      {spoolmanConnected && spools.length > 0 && (
        <>
          {/* Search + Filters */}
          <div className="glass-card p-4 flex flex-col sm:flex-row gap-3">
            {/* Search */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Buscar por nombre, material, fabricante..."
                className="w-full pl-9 pr-9 py-2 rounded-lg bg-secondary border border-border focus:border-primary outline-none text-sm"
              />
              {searchText && (
                <button
                  onClick={() => setSearchText("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Material filter */}
            <div className="flex items-center gap-2 shrink-0">
              <Filter className="w-4 h-4 text-muted-foreground" />
              <select
                value={filterMaterial}
                onChange={(e) => setFilterMaterial(e.target.value)}
                className="px-3 py-2 rounded-lg bg-secondary border border-border text-sm outline-none focus:border-primary"
              >
                <option value="all">Todo material</option>
                {materials.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            {/* Availability filter */}
            <div className="flex rounded-lg overflow-hidden border border-border shrink-0">
              {(["all", "available", "assigned"] as const).map((opt) => (
                <button
                  key={opt}
                  onClick={() => setFilterAvailability(opt)}
                  className={`px-3 py-2 text-xs font-medium transition-colors ${
                    filterAvailability === opt
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {opt === "all" ? "Todos" : opt === "available" ? "Disponibles" : "Asignados"}
                </button>
              ))}
            </div>
          </div>

          {/* Results summary */}
          {(searchText || filterMaterial !== "all" || filterAvailability !== "all") && (
            <p className="text-sm text-muted-foreground">
              Mostrando {filteredSpools.length} de {spools.length} bobinas
              {searchText && <span> · búsqueda: "<span className="text-foreground">{searchText}</span>"</span>}
            </p>
          )}

          {/* Assigned spools section */}
          {assignedSpools.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                🖨️ Asignados a impresora ({assignedSpools.length})
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {assignedSpools.map(renderSpool)}
              </div>
            </div>
          )}

          {/* Available spools section */}
          {availableSpools.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                📦 Disponibles ({availableSpools.length})
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {availableSpools.map(renderSpool)}
              </div>
            </div>
          )}

          {filteredSpools.length === 0 && (
            <div className="glass-card p-12 text-center">
              <Search className="w-12 h-12 mx-auto text-muted-foreground mb-4 opacity-50" />
              <h3 className="text-lg font-semibold mb-2">Sin resultados</h3>
              <p className="text-sm text-muted-foreground">
                No hay bobinas que coincidan con los filtros aplicados.
              </p>
              <button
                onClick={() => {
                  setSearchText("");
                  setFilterMaterial("all");
                  setFilterAvailability("all");
                }}
                className="mt-4 px-4 py-2 rounded-lg bg-secondary text-sm hover:bg-secondary/80 transition-colors"
              >
                Limpiar filtros
              </button>
            </div>
          )}
        </>
      )}

      {spools.length === 0 && spoolmanConnected && (
        <div className="glass-card p-12 text-center">
          <div className="text-5xl mb-4">🧵</div>
          <h3 className="text-lg font-semibold mb-2">No hay spools registrados</h3>
          <p className="text-sm text-muted-foreground">
            Agregá tus rollos de filamento en la interfaz de Spoolman (puerto 7912)
          </p>
        </div>
      )}
    </div>
  );
}
