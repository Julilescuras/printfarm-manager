"use client";

import { cn } from "@/lib/utils";

/**
 * "Estimado vs real" comparison — two parallel tracks (a slicer estimate and
 * the real measured value) drawn as an extrusion-style dual meter, both scaled
 * to the larger of the two. Custom SVG/CSS, no chart dependency, so it themes
 * with the rest of the app.
 *
 * When `actual` is null (no real data — e.g. old history), only the estimate is
 * shown with a muted "sin dato" note on the real track.
 */
export function EstimateVsActualBar({
  label,
  icon,
  estimated,
  actual,
  format,
}: {
  label: string;
  icon?: React.ReactNode;
  estimated: number | null;
  actual: number | null;
  format: (v: number) => string;
}) {
  const est = estimated != null && estimated > 0 ? estimated : null;
  const act = actual != null && actual > 0 ? actual : null;
  const max = Math.max(est ?? 0, act ?? 0) || 1;

  const estPct = est != null ? Math.max(2, (est / max) * 100) : 0;
  const actPct = act != null ? Math.max(2, (act / max) * 100) : 0;

  // Deviation of real vs estimate, shown only when both are known.
  let deviation: { text: string; over: boolean } | null = null;
  if (est != null && act != null) {
    const pct = ((act - est) / est) * 100;
    const rounded = Math.round(pct);
    if (rounded !== 0) {
      deviation = { text: `${rounded > 0 ? "+" : ""}${rounded}%`, over: rounded > 0 };
    } else {
      deviation = { text: "en el estimado", over: false };
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          {icon}
          <span>{label}</span>
        </div>
        {deviation && (
          <span
            className={cn(
              "font-mono text-xs px-1.5 py-0.5 rounded border",
              deviation.over
                ? "text-status-clearance border-status-clearance/30 bg-status-clearance/10"
                : "text-status-printing border-status-printing/30 bg-status-printing/10"
            )}
          >
            {deviation.text}
          </span>
        )}
      </div>

      {/* Estimated track */}
      <Track
        tag="est."
        pct={estPct}
        value={est != null ? format(est) : "—"}
        barClass="bg-muted-foreground/40"
        present={est != null}
      />
      {/* Actual track */}
      <Track
        tag="real"
        pct={actPct}
        value={act != null ? format(act) : "sin dato"}
        barClass="bg-primary"
        present={act != null}
      />
    </div>
  );
}

function Track({
  tag,
  pct,
  value,
  barClass,
  present,
}: {
  tag: string;
  pct: number;
  value: string;
  barClass: string;
  present: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground w-7 shrink-0">
        {tag}
      </span>
      <div className="relative flex-1 h-5 rounded-md bg-secondary/60 overflow-hidden">
        <div
          className={cn("absolute inset-y-0 left-0 rounded-md transition-[width] duration-500", barClass)}
          style={{ width: present ? `${pct}%` : "0%" }}
        />
      </div>
      <span
        className={cn(
          "font-mono text-xs w-20 text-right shrink-0",
          present ? "text-foreground" : "text-muted-foreground/60 italic"
        )}
      >
        {value}
      </span>
    </div>
  );
}
