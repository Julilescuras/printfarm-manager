/**
 * API Client — Base fetch wrapper for backend API calls.
 */

let API_BASE = process.env.NEXT_PUBLIC_API_URL || "";
if (typeof window !== "undefined") {
  if (API_BASE.includes("localhost") && window.location.hostname !== "localhost") {
    API_BASE = API_BASE.replace("localhost", window.location.hostname);
  } else if (!API_BASE) {
    API_BASE = `http://${window.location.hostname}:8000`;
  }
}

// Default request timeout (ms). File uploads (FormData) are exempt because
// they can legitimately take much longer than a normal API call.
const DEFAULT_TIMEOUT_MS = 20_000;

/** Absolute URL to a backend path — for use in <img src> and similar, where the
 *  browser must hit the backend directly (not the Next.js origin). */
export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${path}`;

  // Abort the request if it hangs, so the UI never waits forever on an
  // unreachable backend. Skip for FormData (large uploads) and when the
  // caller already provided its own signal.
  const isUpload = typeof FormData !== "undefined" && options.body instanceof FormData;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let signal = options.signal ?? undefined;
  if (!signal && !isUpload && typeof AbortController !== "undefined") {
    const controller = new AbortController();
    signal = controller.signal;
    timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      signal,
      headers: { ...options.headers },
    });
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new Error("La solicitud tardó demasiado y fue cancelada.");
    }
    throw err;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

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

// ── Spool cache ────────────────────────────────────────────────────────────
// The dashboard renders one card per printer and each used to fetch its spool
// independently, causing N parallel/duplicate requests. This caches results for
// a short TTL and de-dupes concurrent fetches of the same spool id.
const SPOOL_CACHE_TTL_MS = 30_000;
const spoolCache = new Map<number, { ts: number; data: any }>();
const spoolInflight = new Map<number, Promise<any>>();

export function invalidateSpoolCache(id?: number) {
  if (id === undefined) spoolCache.clear();
  else spoolCache.delete(id);
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
    }).then((res) => {
      // Spool assignment changed — drop any stale cached spool data.
      if (spoolId != null) invalidateSpoolCache(spoolId);
      else invalidateSpoolCache();
      return res;
    }),
  triggerDispatch: (printerId: number) =>
    apiFetch<any>(`/api/printers/${printerId}/dispatch`, { method: "POST" }),
  cancelPrint: (printerId: number) =>
    apiFetch<any>(`/api/printers/${printerId}/cancel-print`, { method: "POST" }),
  setStatus: (printerId: number, status: string) =>
    apiFetch<any>(`/api/printers/${printerId}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
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
  pauseJob: (id: number) =>
    apiFetch<any>(`/api/queue/${id}/pause`, { method: "POST" }),
  resumeJob: (id: number) =>
    apiFetch<any>(`/api/queue/${id}/resume`, { method: "POST" }),
  reorderQueue: (items: { id: number; priority: number }[]) =>
    apiFetch<any>("/api/queue/reorder", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(items),
    }),
  cloneFromHistory: (historyId: number, copies: number = 1) =>
    apiFetch<any>(`/api/queue/history/${historyId}/clone?copies=${copies}`, {
      method: "POST",
    }),
  cloneJob: (id: number, copies: number = 1) =>
    apiFetch<any>(`/api/queue/${id}/clone?copies=${copies}`, {
      method: "POST",
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
  deleteMaintenance: (id: number) =>
    apiFetch<void>(`/api/maintenance/${id}`, { method: "DELETE" }),
  resetAllMaintenance: () =>
    apiFetch<any>("/api/maintenance/reset-all", { method: "POST" }),

  // Danger zone
  purgeGcodes: () =>
    apiFetch<any>("/api/queue/gcodes/purge", { method: "POST" }),

  // Spoolman
  getSpoolmanHealth: () => apiFetch<any>("/api/spoolman/health"),
  getSpools: () => apiFetch<any[]>("/api/spoolman/spools"),
  getSpool: (id: number) => apiFetch<any>(`/api/spoolman/spools/${id}`),
  // Cached + de-duped variant — use in UI that renders many cards at once.
  getSpoolCached: (id: number): Promise<any> => {
    const cached = spoolCache.get(id);
    if (cached && Date.now() - cached.ts < SPOOL_CACHE_TTL_MS) {
      return Promise.resolve(cached.data);
    }
    const inflight = spoolInflight.get(id);
    if (inflight) return inflight;

    const promise = apiFetch<any>(`/api/spoolman/spools/${id}`)
      .then((data) => {
        spoolCache.set(id, { ts: Date.now(), data });
        return data;
      })
      .finally(() => {
        spoolInflight.delete(id);
      });
    spoolInflight.set(id, promise);
    return promise;
  },
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

  // Assistant (conversational agent)
  getAssistantProviders: () =>
    apiFetch<{ providers: { id: string; label: string; default_model: string; paid: boolean }[] }>(
      "/api/settings/assistant/providers"
    ),
  testAssistant: () =>
    apiFetch<any>("/api/settings/assistant/test", { method: "POST" }),

  // System updates
  checkUpdate: () => apiFetch<any>("/api/settings/update-check"),
  applyUpdate: () => apiFetch<any>("/api/settings/update-apply", { method: "POST" }),
  getUpdateStatus: () => apiFetch<any>("/api/settings/update-status"),

  // System
  getSystemStatus: () => apiFetch<any>("/api/status"),
};
