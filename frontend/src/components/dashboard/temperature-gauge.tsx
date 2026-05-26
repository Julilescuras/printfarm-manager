"use client";

import React from "react";
import { Flame, Square } from "lucide-react";

interface TemperatureGaugeProps {
  label: string;
  current: number;
  target: number;
  icon: "hotend" | "bed";
}

export function TemperatureGauge({ label, current, target, icon }: TemperatureGaugeProps) {
  const maxTemp = icon === "hotend" ? 300 : 120;
  const percentage = Math.min((current / maxTemp) * 100, 100);

  // Temperature color
  const getColor = () => {
    if (current >= maxTemp * 0.8) return "text-red-400";
    if (current >= maxTemp * 0.4) return "text-amber-400";
    if (current > 30) return "text-blue-400";
    return "text-muted-foreground";
  };

  return (
    <div className="flex items-center gap-2">
      {icon === "hotend" ? (
        <Flame className={`w-3.5 h-3.5 ${getColor()}`} />
      ) : (
        <Square className={`w-3.5 h-3.5 ${getColor()}`} />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-baseline mb-1">
          <span className="text-xs text-muted-foreground">{label}</span>
          <span className="text-xs font-mono tabular-nums">
            <span className={`font-semibold ${getColor()}`}>
              {current.toFixed(0)}°
            </span>
            {target > 0 && (
              <span className="text-muted-foreground">/{target.toFixed(0)}°</span>
            )}
          </span>
        </div>
        {/* Temperature bar */}
        <div className="w-full h-1 rounded-full bg-secondary overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500 ease-out temp-bar"
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>
    </div>
  );
}
