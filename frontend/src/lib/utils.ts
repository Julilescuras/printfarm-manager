import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format seconds into human-readable duration
 */
export function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "0m";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/**
 * Format hours for maintenance display
 */
export function formatHours(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  return `${hours.toFixed(1)}h`;
}

/**
 * Format a byte count into a human-readable size (KB/MB/GB).
 */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`;
}

/**
 * Format an ISO timestamp into a short local date-time (dd/mm/yy HH:MM).
 */
export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Get status display info
 */
export function getStatusInfo(status: string): {
  label: string;
  dotClass: string;
  badgeClass: string;
} {
  switch (status) {
    case "printing":
      return {
        label: "Imprimiendo",
        dotClass: "status-dot-printing",
        badgeClass: "bg-status-printing/20 text-status-printing border-status-printing/30",
      };
    // 'standby' (idle reportado por Klipper) y 'available' (confirmado tras
    // vaciar cama) se muestran como un único estado "Disponible": para el
    // operador significan lo mismo (lista para el próximo trabajo). El backend
    // garantiza que una impresora con pieza en la cama nunca esté en estos
    // estados (cae a "Cama Ocupada"), así que esta unificación es honesta.
    case "standby":
    case "available":
      return {
        label: "Disponible",
        dotClass: "status-dot-available",
        badgeClass: "bg-status-available/20 text-status-available border-status-available/30",
      };
    case "requires_clearance":
      return {
        label: "Cama Ocupada",
        dotClass: "status-dot-clearance",
        badgeClass: "bg-status-clearance/20 text-status-clearance border-status-clearance/30",
      };
    case "paused":
      return {
        label: "En Pausa",
        dotClass: "status-dot-paused",
        badgeClass: "bg-status-paused/20 text-status-paused border-status-paused/30",
      };
    case "error":
      return {
        label: "Error",
        dotClass: "status-dot-error",
        badgeClass: "bg-status-error/20 text-status-error border-status-error/30",
      };
    case "offline":
    default:
      return {
        label: "Desconectada",
        dotClass: "status-dot-offline",
        badgeClass: "bg-status-offline/20 text-status-offline border-status-offline/30",
      };
  }
}
