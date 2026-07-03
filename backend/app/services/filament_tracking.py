"""
Pure filament-usage tracking logic, isolated from Moonraker/DB/Spoolman so it
can be unit-tested without any I/O.

Background
----------
Klipper's ``print_stats.filament_used`` is a running total of the *net* extruder
position (forward extrusion minus retraction). It is correct at the end of a
print, but it DIPS during every retraction: a 2 mm retract lowers the value by
2 mm until the matching un-retract brings it back.

A naive tracker that lowers its baseline on any decrease will then count that
retraction distance as fresh extrusion on the next forward move, systematically
over-deducting filament in Spoolman. Smaller nozzles (0.4 mm) retract far more
often than larger ones (0.6 mm), so the error is much worse there — which
matches the symptom we observed in production.

This module computes the per-update delta correctly: it ignores small dips
(retractions) and only treats a large drop / near-zero value as a genuine print
reset (new print or Klipper restart).
"""

import math
from typing import NamedTuple


# Typical filament densities (g/cm³) by material, used to convert an extruded
# length (mm) into a weight (g) for the history "estimado vs real" comparison.
# Values are approximate spool averages; good enough for a comparison bar.
FILAMENT_DENSITY_G_CM3 = {
    "PLA": 1.24,
    "PETG": 1.27,
    "ABS": 1.04,
    "ASA": 1.07,
    "TPU": 1.21,
    "PC": 1.20,
    "NYLON": 1.14,
    "PA": 1.14,
    "HIPS": 1.04,
    "PVA": 1.23,
    "PP": 0.90,
}
_DEFAULT_DENSITY_G_CM3 = 1.24  # fall back to PLA when the material is unknown


def filament_mm_to_grams(
    length_mm: float,
    material: str | None = None,
    diameter_mm: float = 1.75,
) -> float:
    """Convert an extruded filament length (mm) to a weight (g).

    Uses a per-material density table (falling back to PLA) and the filament
    diameter to compute the cross-section. Returns 0.0 for non-positive input.
    """
    if length_mm <= 0 or diameter_mm <= 0:
        return 0.0
    density = FILAMENT_DENSITY_G_CM3.get(
        (material or "").strip().upper(), _DEFAULT_DENSITY_G_CM3
    )
    cross_section_mm2 = math.pi * (diameter_mm / 2.0) ** 2
    volume_mm3 = length_mm * cross_section_mm2
    # 1 cm³ = 1000 mm³; density is g/cm³ → grams = mm³ * density / 1000
    return volume_mm3 * density / 1000.0


class FilamentTrackingState(NamedTuple):
    """Immutable snapshot of the filament tracker between Moonraker updates."""

    last_used: float          # last filament_used (mm) we treated as the baseline
    accumulated: float        # mm of new extrusion not yet synced to Spoolman
    initialized: bool         # have we seen at least one reading yet?
    flush_pending: bool       # caller should sync `accumulated` to Spoolman now


# A retraction is at most a handful of mm; a new print resets filament_used from
# hundreds/thousands of mm down to ~0. These thresholds separate the two. They
# assume no MMU / tool-change "long" retractions (true for our Ender 3 fleet).
RESET_FLOOR_MM = 2.0   # value at/below this => almost certainly a fresh print
RESET_DROP_MM = 50.0   # a single drop larger than this => print reset, not a retraction


def step_filament_tracking(
    state: FilamentTrackingState,
    current_used: float,
    *,
    reset_floor_mm: float = RESET_FLOOR_MM,
    reset_drop_mm: float = RESET_DROP_MM,
) -> FilamentTrackingState:
    """Advance the tracker by one ``filament_used`` reading.

    Returns the new state. ``flush_pending`` is True only on a detected reset,
    signalling the caller to push the still-pending ``accumulated`` mm to
    Spoolman before the new print's usage starts piling up.
    """
    # First reading ever: adopt it as the baseline, count nothing.
    if not state.initialized:
        return FilamentTrackingState(
            last_used=current_used,
            accumulated=state.accumulated,
            initialized=True,
            flush_pending=False,
        )

    if current_used < state.last_used:
        drop = state.last_used - current_used
        if current_used < reset_floor_mm or drop > reset_drop_mm:
            # Genuine reset (new print / Klipper restart). Re-baseline at the new
            # low value and ask the caller to flush whatever is still pending.
            return FilamentTrackingState(
                last_used=current_used,
                accumulated=state.accumulated,
                initialized=True,
                flush_pending=True,
            )
        # Retraction: keep the pre-retraction baseline so the matching un-retract
        # nets out to zero instead of being double-counted as new extrusion.
        return FilamentTrackingState(
            last_used=state.last_used,
            accumulated=state.accumulated,
            initialized=True,
            flush_pending=False,
        )

    # Forward extrusion: accumulate the net delta.
    delta = current_used - state.last_used
    return FilamentTrackingState(
        last_used=current_used,
        accumulated=state.accumulated + delta,
        initialized=True,
        flush_pending=False,
    )
