"use client";

import { Palette, Check, Sparkles, Square, Maximize2, RotateCcw, Zap } from "lucide-react";
import { useTheme, type RadiusOption, type DensityOption } from "@/providers/theme-provider";
import { cn } from "@/lib/utils";

const RADIUS_OPTIONS: { id: RadiusOption; label: string; sample: string }[] = [
  { id: "sharp", label: "Cuadrado", sample: "rounded-sm" },
  { id: "default", label: "Normal", sample: "rounded-lg" },
  { id: "round", label: "Redondeado", sample: "rounded-2xl" },
];

const DENSITY_OPTIONS: { id: DensityOption; label: string; desc: string }[] = [
  { id: "comfortable", label: "Cómoda", desc: "Más espacio" },
  { id: "compact", label: "Compacta", desc: "Más contenido" },
];

export function AppearancePanel() {
  const {
    config,
    presets,
    accents,
    setTheme,
    setAccent,
    setRadius,
    setDensity,
    setAnimations,
    resetAppearance,
  } = useTheme();

  return (
    <div className="glass-card p-6 space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Palette className="w-5 h-5 text-primary" />
          Apariencia
        </h2>
        <button
          onClick={resetAppearance}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Restablecer
        </button>
      </div>

      {/* ── Theme presets ─────────────────────────────────────────────── */}
      <div className="space-y-3">
        <p className="text-sm font-medium flex items-center gap-1.5">
          <Sparkles className="w-4 h-4 text-muted-foreground" />
          Tema
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {presets.map((preset) => {
            const selected = config.theme === preset.id;
            return (
              <button
                key={preset.id}
                onClick={() => setTheme(preset.id)}
                aria-pressed={selected}
                className={cn(
                  "relative text-left rounded-xl border p-3 transition-all",
                  selected
                    ? "border-primary ring-2 ring-primary/40"
                    : "border-border hover:border-primary/50"
                )}
              >
                {/* Mini preview */}
                <div
                  className="h-12 rounded-lg mb-2.5 flex items-end gap-1 p-1.5 overflow-hidden"
                  style={{ backgroundColor: preset.swatch.bg }}
                >
                  <span
                    className="h-3 flex-1 rounded-full"
                    style={{ backgroundColor: preset.swatch.primary }}
                  />
                  <span
                    className="h-3 w-3 rounded-full shrink-0"
                    style={{ backgroundColor: preset.swatch.accent }}
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-sm">{preset.label}</span>
                  {selected && (
                    <span className="shrink-0 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                      <Check className="w-3 h-3 text-primary-foreground" />
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                  {preset.description}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Accent color ──────────────────────────────────────────────── */}
      <div className="space-y-3">
        <p className="text-sm font-medium">Color de acento</p>
        <div className="flex flex-wrap gap-2.5">
          {accents.map((accent) => {
            const selected = config.accent === accent.id;
            const isDefault = accent.id === "default";
            return (
              <button
                key={accent.id}
                onClick={() => setAccent(accent.id)}
                title={accent.label}
                aria-label={accent.label}
                aria-pressed={selected}
                className={cn(
                  "relative w-9 h-9 rounded-full border-2 flex items-center justify-center transition-transform hover:scale-110",
                  selected ? "border-foreground" : "border-transparent"
                )}
                style={isDefault ? undefined : { backgroundColor: accent.hex }}
              >
                {isDefault ? (
                  <span className="w-full h-full rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-[10px] font-bold text-white">
                    Auto
                  </span>
                ) : selected ? (
                  <Check className="w-4 h-4 text-white drop-shadow" />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Border radius ─────────────────────────────────────────────── */}
      <div className="space-y-3">
        <p className="text-sm font-medium flex items-center gap-1.5">
          <Square className="w-4 h-4 text-muted-foreground" />
          Esquinas
        </p>
        <div className="grid grid-cols-3 gap-2">
          {RADIUS_OPTIONS.map((opt) => {
            const selected = config.radius === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => setRadius(opt.id)}
                aria-pressed={selected}
                className={cn(
                  "flex flex-col items-center gap-2 py-3 rounded-lg border text-xs font-medium transition-all",
                  selected
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:border-primary/50"
                )}
              >
                <span className={cn("w-8 h-8 border-2 border-current", opt.sample)} />
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Density ───────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <p className="text-sm font-medium flex items-center gap-1.5">
          <Maximize2 className="w-4 h-4 text-muted-foreground" />
          Densidad
        </p>
        <div className="grid grid-cols-2 gap-2">
          {DENSITY_OPTIONS.map((opt) => {
            const selected = config.density === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => setDensity(opt.id)}
                aria-pressed={selected}
                className={cn(
                  "flex flex-col items-start gap-0.5 px-4 py-3 rounded-lg border text-left transition-all",
                  selected
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-primary/50"
                )}
              >
                <span className="text-sm font-medium">{opt.label}</span>
                <span className="text-xs text-muted-foreground">{opt.desc}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Animations ────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-medium text-sm flex items-center gap-1.5">
            <Zap className="w-4 h-4 text-muted-foreground" />
            Animaciones
          </p>
          <p className="text-xs text-muted-foreground">
            Transiciones y efectos. Desactivalo para mejor rendimiento.
          </p>
        </div>
        <button
          onClick={() => setAnimations(!config.animations)}
          role="switch"
          aria-checked={config.animations}
          aria-label="Animaciones"
          className="relative w-14 min-w-[3.5rem] h-7 rounded-full transition-colors duration-300 focus:outline-none shrink-0"
          style={{
            backgroundColor: config.animations ? "hsl(var(--primary))" : "hsl(var(--muted))",
          }}
        >
          <span
            className="absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow-md transition-transform duration-300"
            style={{ transform: config.animations ? "translateX(28px)" : "translateX(0px)" }}
          />
        </button>
      </div>
    </div>
  );
}
