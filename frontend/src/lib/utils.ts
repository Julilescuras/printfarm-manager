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
    case "standby":
      return {
        label: "En Espera",
        dotClass: "status-dot-standby",
        badgeClass: "bg-status-standby/20 text-status-standby border-status-standby/30",
      };
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
