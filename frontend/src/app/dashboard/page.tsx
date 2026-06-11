"use client";

import React from "react";
import { useWSContext } from "@/providers/websocket-provider";
import { PrinterCard } from "@/components/dashboard/printer-card";
import { Activity, AlertTriangle, CheckCircle, Printer } from "lucide-react";
import Link from "next/link";

function PrinterSkeleton() {
  return (
    <div className="glass-card p-5 animate-pulse space-y-3">
      <div className="flex items-center justify-between">
        <div className="h-5 w-32 bg-white/10 rounded" />
        <div className="h-5 w-20 bg-white/10 rounded-full" />
      </div>
      <div className="h-3 w-48 bg-white/10 rounded" />
      <div className="h-2 w-full bg-white/10 rounded-full" />
      <div className="flex gap-2 pt-1">
        <div className="h-8 flex-1 bg-white/10 rounded" />
        <div className="h-8 flex-1 bg-white/10 rounded" />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { printers, activeAlerts, isInitialized, refreshState } = useWSContext();

  const stats = {
    total: printers.length,
    printing: printers.filter((p) => p.status === "printing").length,
    available: printers.filter((p) => p.status === "available" || p.status === "standby").length,
    clearance: printers.filter((p) => p.status === "requires_clearance").length,
    error: printers.filter((p) => p.status === "error").length,
    offline: printers.filter((p) => p.status === "offline").length,
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gradient">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Estado en tiempo real de la granja de impresión
          </p>
        </div>
        <button
          onClick={refreshState}
          className="px-4 py-2 text-sm rounded-lg bg-secondary hover:bg-secondary/80 transition-colors self-start sm:self-auto shrink-0"
        >
          ↻ Actualizar
        </button>
      </div>

      {/* Quick Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
        <div className="glass-card p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
            <Activity className="w-5 h-5 text-primary" />
          </div>
          <div>
            <div className="text-2xl font-bold">{isInitialized ? stats.printing : <span className="text-muted-foreground/40 animate-pulse">–</span>}</div>
            <div className="text-xs text-muted-foreground">Imprimiendo</div>
          </div>
        </div>

        <div className="glass-card p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
            <CheckCircle className="w-5 h-5 text-green-400" />
          </div>
          <div>
            <div className="text-2xl font-bold">{isInitialized ? stats.available : <span className="text-muted-foreground/40 animate-pulse">–</span>}</div>
            <div className="text-xs text-muted-foreground">Disponibles</div>
          </div>
        </div>

        <div className="glass-card p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
            <Printer className="w-5 h-5 text-purple-400" />
          </div>
          <div>
            <div className="text-2xl font-bold">{isInitialized ? stats.clearance : <span className="text-muted-foreground/40 animate-pulse">–</span>}</div>
            <div className="text-xs text-muted-foreground">Cama Ocupada</div>
          </div>
        </div>

        <div className="glass-card p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-red-500/20 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <div className="text-2xl font-bold">
              {isInitialized ? stats.error + stats.offline : <span className="text-muted-foreground/40 animate-pulse">–</span>}
            </div>
            <div className="text-xs text-muted-foreground">Error/Offline</div>
          </div>
        </div>

        {activeAlerts.length > 0 && (
          <div className="glass-card p-4 flex items-center gap-3 border-amber-500/30">
            <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <div className="text-2xl font-bold text-amber-400">
                {activeAlerts.length}
              </div>
              <div className="text-xs text-muted-foreground">Alertas Mant.</div>
            </div>
          </div>
        )}
      </div>

      {/* Printer Grid */}
      {!isInitialized ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <PrinterSkeleton key={i} />)}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {printers.map((printer) => (
              <Link key={printer.id} href={`/printer/${printer.id}`} className="block transition-transform hover:scale-[1.01]">
                <PrinterCard
                  printer={printer}
                  onUpdate={refreshState}
                />
              </Link>
            ))}
          </div>

          {printers.length === 0 && (
            <div className="glass-card p-12 text-center">
              <div className="text-5xl mb-4">🖨️</div>
              <h3 className="text-lg font-semibold mb-2">
                No hay impresoras configuradas
              </h3>
              <p className="text-sm text-muted-foreground">
                Añade impresoras desde la sección "Impresoras" en el menú lateral.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
