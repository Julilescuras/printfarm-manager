"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  ListOrdered,
  Palette,
  Wrench,
  Printer,
  Settings,
  Wifi,
  WifiOff,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  ExternalLink,
  FolderOpen,
} from "lucide-react";
import { useWSContext } from "@/providers/websocket-provider";
import { api, SPOOLMAN_URL } from "@/lib/api";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/queue", label: "Cola de Impresión", icon: ListOrdered },
  { href: "/files", label: "Archivos", icon: FolderOpen },
  { href: "/printers", label: "Impresoras", icon: Printer },
  { href: "/filament", label: "Filamento", icon: Palette },
  { href: "/maintenance", label: "Mantenimiento", icon: Wrench },
  { href: "/settings", label: "Configuración", icon: Settings },
];

interface SidebarProps {
  /** Icon-only mode (desktop fold). */
  collapsed?: boolean;
  /** Called after navigating — used to close the mobile drawer. */
  onNavigate?: () => void;
  /** Desktop fold toggle. */
  onToggleCollapse?: () => void;
  /** Mobile drawer close. */
  onClose?: () => void;
}

export function Sidebar({ collapsed = false, onNavigate, onToggleCollapse, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { printers, activeAlerts, isConnected } = useWSContext();
  const [version, setVersion] = useState<string>("");

  useEffect(() => {
    api.getSystemStatus()
      .then((data) => { if (data?.version) setVersion(data.version); })
      .catch(() => {});
  }, []);

  const printingCount = printers.filter((p) => p.status === "printing").length;
  const clearanceCount = printers.filter(
    (p) => p.status === "requires_clearance"
  ).length;

  return (
    <aside
      className={cn(
        "h-screen flex flex-col bg-card/50 border-r border-border backdrop-blur-sm transition-[width] duration-300",
        collapsed ? "w-20" : "w-64"
      )}
    >
      {/* Logo + controls */}
      <div className={cn("border-b border-border", collapsed ? "p-3" : "p-6")}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 shrink-0 rounded-xl bg-primary/20 flex items-center justify-center">
            <Printer className="w-5 h-5 text-primary" />
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-bold text-gradient truncate">PrintFarm</h1>
              <p className="text-xs text-muted-foreground truncate">
                Manager {version ? `v${version}` : ""}
              </p>
            </div>
          )}
          {/* Mobile close button */}
          {onClose && (
            <button
              onClick={onClose}
              aria-label="Cerrar menú"
              className="ml-auto p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary lg:hidden"
            >
              <X className="w-5 h-5" />
            </button>
          )}
          {/* Desktop collapse toggle (only when expanded, sits top-right) */}
          {onToggleCollapse && !collapsed && (
            <button
              onClick={onToggleCollapse}
              aria-label="Plegar barra lateral"
              title="Plegar"
              className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary hidden lg:inline-flex"
            >
              <PanelLeftClose className="w-5 h-5" />
            </button>
          )}
        </div>
        {/* Desktop expand toggle when collapsed (centered below logo) */}
        {onToggleCollapse && collapsed && (
          <button
            onClick={onToggleCollapse}
            aria-label="Desplegar barra lateral"
            title="Desplegar"
            className="mt-3 w-full flex items-center justify-center p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary"
          >
            <PanelLeftOpen className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className={cn("flex-1 space-y-1 overflow-y-auto custom-scrollbar", collapsed ? "p-2" : "p-4")}>
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          const badgeCount =
            item.href === "/dashboard" ? clearanceCount :
            item.href === "/maintenance" ? activeAlerts.length : 0;
          const badgeClass =
            item.href === "/maintenance"
              ? "bg-status-error/20 text-status-error border-status-error/30"
              : "bg-status-clearance/20 text-status-clearance border-status-clearance/30";

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              title={collapsed ? item.label : undefined}
              className={cn(
                isActive ? "sidebar-link-active" : "sidebar-link",
                collapsed && "justify-center px-0 relative"
              )}
            >
              <Icon className="w-5 h-5 shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
              {badgeCount > 0 && (
                collapsed ? (
                  <span className={cn("absolute top-1 right-2 w-2.5 h-2.5 rounded-full border", badgeClass)} />
                ) : (
                  <span className={cn("ml-auto text-xs font-bold px-2 py-0.5 rounded-full border", badgeClass)}>
                    {badgeCount}
                  </span>
                )
              )}
            </Link>
          );
        })}
      </nav>

      {/* Spoolman link */}
      <div className={cn("border-t border-border", collapsed ? "p-2" : "p-4")}>
        <a
          href={SPOOLMAN_URL}
          target="_blank"
          rel="noopener noreferrer"
          title="Abrir Spoolman"
          className={cn(
            "sidebar-link w-full",
            collapsed && "justify-center px-0"
          )}
        >
          <Palette className="w-5 h-5 shrink-0" />
          {!collapsed && (
            <>
              <span className="truncate">Spoolman</span>
              <ExternalLink className="w-3.5 h-3.5 ml-auto text-muted-foreground" />
            </>
          )}
        </a>
      </div>

      {/* Status footer */}
      <div className={cn("border-t border-border space-y-3", collapsed ? "p-2" : "p-4")}>
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            <div className="glass-card w-full py-2 text-center">
              <div className="text-base font-bold text-primary leading-none">{printingCount}</div>
            </div>
            {isConnected ? (
              <Wifi className="w-4 h-4 text-primary" />
            ) : (
              <WifiOff className="w-4 h-4 text-status-error" />
            )}
          </div>
        ) : (
          <>
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
          </>
        )}
      </div>
    </aside>
  );
}
