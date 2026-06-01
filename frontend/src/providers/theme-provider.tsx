"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";

/* ──────────────────────────────────────────────────────────────────────────
   Theme presets
   Each preset only needs an id + label + whether it's a dark theme (so the
   `.dark` class — used by Tailwind `dark:` variants and glass-card shadows —
   can be toggled). The actual color values live in globals.css under
   [data-theme="..."] blocks.
   ────────────────────────────────────────────────────────────────────────── */
export interface ThemePreset {
  id: string;
  label: string;
  description: string;
  isDark: boolean;
  /** Representative colors for the preview swatch in the UI. */
  swatch: { bg: string; primary: string; accent: string };
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "midnight",
    label: "Medianoche",
    description: "Oscuro clásico con verde esmeralda",
    isDark: true,
    swatch: { bg: "#0e1525", primary: "#22c55e", accent: "#8b5cf6" },
  },
  {
    id: "daylight",
    label: "Día",
    description: "Claro y nítido para ambientes luminosos",
    isDark: false,
    swatch: { bg: "#f1f4f8", primary: "#16a34a", accent: "#8b5cf6" },
  },
  {
    id: "cozy",
    label: "Cálido",
    description: "Beige acogedor y terracota (estilo Lumio)",
    isDark: false,
    swatch: { bg: "#fdf9f1", primary: "#d36c4a", accent: "#f4c430" },
  },
  {
    id: "nord",
    label: "Nórdico",
    description: "Ártico frío con azul escarcha",
    isDark: true,
    swatch: { bg: "#2e3440", primary: "#88c0d0", accent: "#b48ead" },
  },
  {
    id: "cyberpunk",
    label: "Cyberpunk",
    description: "Negro profundo con neón magenta y cian",
    isDark: true,
    swatch: { bg: "#0d0a14", primary: "#f72585", accent: "#00e5ff" },
  },
  {
    id: "forest",
    label: "Bosque",
    description: "Verde profundo con ámbar cálido",
    isDark: true,
    swatch: { bg: "#0f1a14", primary: "#34c759", accent: "#e8a23d" },
  },
];

/* ──────────────────────────────────────────────────────────────────────────
   Accent overrides — override the theme's --primary / --ring.
   ────────────────────────────────────────────────────────────────────────── */
export interface AccentOption {
  id: string;
  label: string;
  /** HSL triple for --primary. */
  primary: string;
  /** HSL triple for --primary-foreground (contrast). */
  foreground: string;
  /** CSS color for the UI swatch. */
  hex: string;
}

export const ACCENT_OPTIONS: AccentOption[] = [
  { id: "default", label: "Del tema", primary: "", foreground: "", hex: "" },
  { id: "emerald", label: "Esmeralda", primary: "142 71% 45%", foreground: "0 0% 100%", hex: "#22c55e" },
  { id: "blue", label: "Azul", primary: "217 91% 60%", foreground: "0 0% 100%", hex: "#3b82f6" },
  { id: "violet", label: "Violeta", primary: "262 83% 62%", foreground: "0 0% 100%", hex: "#8b5cf6" },
  { id: "rose", label: "Rosa", primary: "340 82% 58%", foreground: "0 0% 100%", hex: "#ec4899" },
  { id: "amber", label: "Ámbar", primary: "38 92% 50%", foreground: "30 25% 12%", hex: "#f59e0b" },
  { id: "cyan", label: "Cian", primary: "189 94% 43%", foreground: "200 50% 8%", hex: "#06b6d4" },
  { id: "terracotta", label: "Terracota", primary: "16 60% 56%", foreground: "0 0% 100%", hex: "#d36c4a" },
];

export type RadiusOption = "sharp" | "default" | "round";
export type DensityOption = "comfortable" | "compact";

export interface AppearanceConfig {
  theme: string;
  accent: string;
  radius: RadiusOption;
  density: DensityOption;
  animations: boolean;
}

const DEFAULT_CONFIG: AppearanceConfig = {
  theme: "midnight",
  accent: "default",
  radius: "default",
  density: "comfortable",
  animations: true,
};

const RADIUS_VALUES: Record<RadiusOption, string> = {
  sharp: "0.25rem",
  default: "0.75rem",
  round: "1.25rem",
};

const STORAGE_KEY = "printfarm-appearance";
const LEGACY_KEY = "printfarm-theme";

interface ThemeContextValue {
  config: AppearanceConfig;
  presets: ThemePreset[];
  accents: AccentOption[];
  setTheme: (id: string) => void;
  setAccent: (id: string) => void;
  setRadius: (r: RadiusOption) => void;
  setDensity: (d: DensityOption) => void;
  setAnimations: (on: boolean) => void;
  resetAppearance: () => void;
  /** Convenience for legacy callers: true when the active preset is dark. */
  isDark: boolean;
  /** Legacy helper kept for compatibility — flips between midnight/daylight. */
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  config: DEFAULT_CONFIG,
  presets: THEME_PRESETS,
  accents: ACCENT_OPTIONS,
  setTheme: () => {},
  setAccent: () => {},
  setRadius: () => {},
  setDensity: () => {},
  setAnimations: () => {},
  resetAppearance: () => {},
  isDark: true,
  toggleTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

function presetById(id: string): ThemePreset {
  return THEME_PRESETS.find((p) => p.id === id) ?? THEME_PRESETS[0];
}

/** Apply the whole config to <html> (data attributes, classes, inline vars). */
function applyConfig(cfg: AppearanceConfig) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const preset = presetById(cfg.theme);

  // Theme palette
  root.setAttribute("data-theme", preset.id);
  root.classList.toggle("dark", preset.isDark);

  // Accent override
  const accent = ACCENT_OPTIONS.find((a) => a.id === cfg.accent);
  if (accent && accent.id !== "default" && accent.primary) {
    root.style.setProperty("--primary", accent.primary);
    root.style.setProperty("--ring", accent.primary);
    root.style.setProperty("--primary-foreground", accent.foreground);
  } else {
    root.style.removeProperty("--primary");
    root.style.removeProperty("--ring");
    root.style.removeProperty("--primary-foreground");
  }

  // Border radius
  root.style.setProperty("--radius", RADIUS_VALUES[cfg.radius] ?? RADIUS_VALUES.default);

  // Density — scale the root font-size so rem-based spacing follows.
  root.style.fontSize = cfg.density === "compact" ? "14px" : "16px";

  // Motion
  root.classList.toggle("motion-reduced", !cfg.animations);
}

function loadConfig(): AppearanceConfig {
  if (typeof window === "undefined") return DEFAULT_CONFIG;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppearanceConfig>;
      return {
        ...DEFAULT_CONFIG,
        ...parsed,
        // Guard against unknown theme ids from older versions
        theme: presetById(parsed.theme ?? DEFAULT_CONFIG.theme).id,
      };
    }
    // Migrate legacy dark/light key
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy === "light") return { ...DEFAULT_CONFIG, theme: "daylight" };
  } catch {
    /* ignore corrupt storage */
  }
  return DEFAULT_CONFIG;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<AppearanceConfig>(DEFAULT_CONFIG);

  // Hydrate from storage on mount, then apply.
  useEffect(() => {
    const loaded = loadConfig();
    setConfig(loaded);
    applyConfig(loaded);
  }, []);

  const persist = useCallback((next: AppearanceConfig) => {
    setConfig(next);
    applyConfig(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const setTheme = useCallback((id: string) => persist({ ...config, theme: presetById(id).id }), [config, persist]);
  const setAccent = useCallback((id: string) => persist({ ...config, accent: id }), [config, persist]);
  const setRadius = useCallback((radius: RadiusOption) => persist({ ...config, radius }), [config, persist]);
  const setDensity = useCallback((density: DensityOption) => persist({ ...config, density }), [config, persist]);
  const setAnimations = useCallback((animations: boolean) => persist({ ...config, animations }), [config, persist]);
  const resetAppearance = useCallback(() => persist(DEFAULT_CONFIG), [persist]);
  const toggleTheme = useCallback(
    () => persist({ ...config, theme: presetById(config.theme).isDark ? "daylight" : "midnight" }),
    [config, persist]
  );

  const value: ThemeContextValue = {
    config,
    presets: THEME_PRESETS,
    accents: ACCENT_OPTIONS,
    setTheme,
    setAccent,
    setRadius,
    setDensity,
    setAnimations,
    resetAppearance,
    isDark: presetById(config.theme).isDark,
    toggleTheme,
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
