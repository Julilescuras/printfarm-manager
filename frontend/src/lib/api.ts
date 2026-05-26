/**
 * API Client — Base fetch wrapper for backend API calls.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }));
    console.error("API Error Response:", JSON.stringify(error));
    throw new Error(typeof error.detail === 'string' ? error.detail : JSON.stringify(error.detail));
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

export const api = {
  // Printers
  getPrinters: () => apiFetch<any[]>("/api/printers"),
  getPrinter: (id: number) => apiFetch<any>(`/api/printers/${id}`),
  createPrinter: (data: any) =>
    apiFetch<any>("/api/printers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  updatePrinter: (id: number, data: any) =>
    apiFetch<any>(`/api/printers/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  deletePrinter: (id: number) =>
    apiFetch<void>(`/api/printers/${id}`, { method: "DELETE" }),
  clearBed: (id: number) =>
    apiFetch<any>(`/api/printers/${id}/clear-bed`, { method: "POST" }),
  assignSpool: (printerId: number, spoolId: number | null) =>
    apiFetch<any>(`/api/printers/${printerId}/spool`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spool_id: spoolId }),
    }),

  // Queue
  getQueue: (status?: string) =>
    apiFetch<any[]>(`/api/queue${status ? `?status=${status}` : ""}`),
  getHistory: (limit: number = 100) =>
    apiFetch<any[]>(`/api/queue/history?limit=${limit}`),
  addJob: (formData: FormData) =>
    apiFetch<any>("/api/queue", {
      method: "POST",
      body: formData,
    }),
  updateJob: (id: number, data: any) =>
    apiFetch<any>(`/api/queue/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  cancelJob: (id: number) =>
    apiFetch<void>(`/api/queue/${id}`, { method: "DELETE" }),
  requeueJob: (id: number) =>
    apiFetch<any>(`/api/queue/${id}/requeue`, { method: "POST" }),
  reorderQueue: (items: { id: number; priority: number }[]) =>
    apiFetch<any>("/api/queue/reorder", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(items),
    }),

  // Maintenance
  getMaintenance: () => apiFetch<any[]>("/api/maintenance"),
  getAlerts: () => apiFetch<any[]>("/api/maintenance/alerts"),
  getPrinterMaintenance: (printerId: number) =>
    apiFetch<any[]>(`/api/maintenance/printer/${printerId}`),
  createMaintenance: (data: any) =>
    apiFetch<any>("/api/maintenance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  resetMaintenance: (id: number, note?: string) =>
    apiFetch<any>(`/api/maintenance/${id}/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: note || null }),
    }),
  getMaintenanceHistory: (recordId: number) =>
    apiFetch<any[]>(`/api/maintenance/${recordId}/history`),
  getPrinterMaintenanceHistory: (printerId: number) =>
    apiFetch<any[]>(`/api/maintenance/printer/${printerId}/history`),
  updateMaintenance: (id: number, data: any) =>
    apiFetch<any>(`/api/maintenance/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  // Spoolman
  getSpoolmanHealth: () => apiFetch<any>("/api/spoolman/health"),
  getSpools: () => apiFetch<any[]>("/api/spoolman/spools"),
  getSpool: (id: number) => apiFetch<any>(`/api/spoolman/spools/${id}`),
  getFilaments: () => apiFetch<any[]>("/api/spoolman/filaments"),

  // Settings
  getSettings: () => apiFetch<Record<string, string>>("/api/settings"),
  updateSettings: (settings: Record<string, string>) =>
    apiFetch<any>("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings }),
    }),
  testTelegram: () =>
    apiFetch<any>("/api/settings/telegram/test", { method: "POST" }),

  // System
  getSystemStatus: () => apiFetch<any>("/api/status"),
};
