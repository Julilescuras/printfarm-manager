"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ListOrdered,
  Palette,
  Wrench,
  Printer,
  Settings,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useWSContext } from "@/providers/websocket-provider";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/queue", label: "Cola de Impresión", icon: ListOrdered },
  { href: "/printers", label: "Impresoras", icon: Printer },
  { href: "/filament", label: "Filamento", icon: Palette },
  { href: "/maintenance", label: "Mantenimiento", icon: Wrench },
  { href: "/settings", label: "Configuración", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const { printers, activeAlerts, isConnected } = useWSContext();

  const printingCount = printers.filter((p) => p.status === "printing").length;
  const clearanceCount = printers.filter(
    (p) => p.status === "requires_clearance"
  ).length;

  return (
    <aside className="w-64 h-screen flex flex-col bg-card/50 border-r border-border backdrop-blur-sm">
      {/* Logo */}
      <div className="p-6 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
            <Printer className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gradient">PrintFarm</h1>
            <p className="text-xs text-muted-foreground">Manager v1.2.0</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={isActive ? "sidebar-link-active" : "sidebar-link"}
            >
              <Icon className="w-5 h-5" />
              <span>{item.label}</span>
              {/* Badge for queue alerts */}
              {item.href === "/dashboard" && clearanceCount > 0 && (
                <span className="ml-auto bg-status-clearance/20 text-status-clearance text-xs font-bold px-2 py-0.5 rounded-full border border-status-clearance/30">
                  {clearanceCount}
                </span>
              )}
              {item.href === "/maintenance" && activeAlerts.length > 0 && (
                <span className="ml-auto bg-status-error/20 text-status-error text-xs font-bold px-2 py-0.5 rounded-full border border-status-error/30">
                  {activeAlerts.length}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Status footer */}
      <div className="p-4 border-t border-border space-y-3">
        {/* Quick stats */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="glass-card p-2 text-center">
            <div className="text-lg font-bold text-primary">{printingCount}</div>
            <div className="text-muted-foreground">Imprimiendo</div>
          </div>
          <div className="glass-card p-2 text-center">
            <div className="text-lg font-bold text-foreground">{printers.length}</div>
            <div className="text-muted-foreground">Total</div>
          </div>
        </div>

        {/* Connection status */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {isConnected ? (
            <>
              <Wifi className="w-3.5 h-3.5 text-primary" />
              <span>Conectado al backend</span>
            </>
          ) : (
            <>
              <WifiOff className="w-3.5 h-3.5 text-status-error" />
              <span>Desconectado</span>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
