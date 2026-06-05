"""
G-code Parser — Extracts estimated print time and filament usage from G-code files.

Supports comments from major slicers:
  - Cura: ;TIME:, ;Filament used:
  - PrusaSlicer/OrcaSlicer: ; estimated printing time, ; filament used [mm]
  - SuperSlicer: similar to PrusaSlicer
  - Simplify3D: ;   Build time:, ;   Filament length:
"""

import logging
import math
import re
from typing import Optional, Tuple

logger = logging.getLogger("printfarm.gcode_parser")

# Standard filament properties (1.75mm diameter)
FILAMENT_DIAMETER_MM = 1.75
# Density in g/cm³ for common materials
MATERIAL_DENSITIES = {
    "PLA": 1.24,
    "PETG": 1.27,
    "ABS": 1.04,
    "ASA": 1.07,
    "TPU": 1.21,
    "NYLON": 1.14,
    "PC": 1.20,
    "PVA": 1.23,
}


def _filament_mm_to_grams(length_mm: float, material: str = "PLA") -> float:
    """Convert filament length in mm to weight in grams."""
    density = MATERIAL_DENSITIES.get(material.upper(), 1.24)  # Default to PLA
    radius_cm = (FILAMENT_DIAMETER_MM / 2.0) / 10.0  # mm to cm
    length_cm = length_mm / 10.0
    volume_cm3 = math.pi * radius_cm**2 * length_cm
    return round(volume_cm3 * density, 1)


def _filament_m_to_grams(length_m: float, material: str = "PLA") -> float:
    """Convert filament length in meters to weight in grams."""
    return _filament_mm_to_grams(length_m * 1000.0, material)


def _parse_time_string(time_str: str) -> Optional[int]:
    """Parse human-readable time strings like '1h 23m 45s' or '1d 2h 3m'."""
    total_secs = 0
    # Match days, hours, minutes, seconds
    d = re.search(r'(\d+)\s*d', time_str)
    h = re.search(r'(\d+)\s*h', time_str)
    m = re.search(r'(\d+)\s*m', time_str)
    s = re.search(r'(\d+)\s*s', time_str)
    if d:
        total_secs += int(d.group(1)) * 86400
    if h:
        total_secs += int(h.group(1)) * 3600
    if m:
        total_secs += int(m.group(1)) * 60
    if s:
        total_secs += int(s.group(1))
    return total_secs if total_secs > 0 else None


def parse_gcode(file_path: str, material: str = "PLA") -> dict:
    """
    Parse a G-code file to extract estimated print time and filament usage.
    Only reads the first and last 300 lines for performance (slicer comments
    are typically at the top or bottom of the file).

    Returns:
        {
            "estimated_time_secs": int | None,
            "estimated_weight_g": float | None,
        }
    """
    estimated_time: Optional[int] = None
    estimated_weight: Optional[float] = None

    try:
        # Read first lines where slicer comments often live (text mode is fine
        # for a forward read).
        lines = []
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            for i, line in enumerate(f):
                if i >= 300:
                    break
                lines.append(line.strip())

        # Read the last ~10 KB in BINARY mode. Doing seek()/tell() on a text-mode
        # file is unreliable (tell() returns an opaque cookie, not a byte offset),
        # which could read garbage or fail on non-ASCII files. Binary seek is
        # well-defined.
        try:
            with open(file_path, "rb") as fb:
                fb.seek(0, 2)  # end
                file_size = fb.tell()
                chunk_size = min(10000, file_size)
                if chunk_size > 0:
                    fb.seek(file_size - chunk_size)
                    tail = fb.read().decode("utf-8", errors="ignore")
                    lines.extend([l.strip() for l in tail.splitlines()[-300:]])
        except OSError:
            pass

        for line in lines:
            if not line.startswith(";"):
                continue

            line_upper = line.upper()

            # --- TIME EXTRACTION ---

            # Cura: ;TIME:1234 (seconds)
            if line_upper.startswith(";TIME:") and estimated_time is None:
                try:
                    val = line.split(":", 1)[1].strip()
                    estimated_time = int(float(val))
                except (ValueError, IndexError):
                    pass

            # PrusaSlicer/OrcaSlicer: ; estimated printing time (normal mode) = 1h 23m 45s
            elif "ESTIMATED PRINTING TIME" in line_upper and estimated_time is None:
                match = re.search(r'=\s*(.+)', line)
                if match:
                    estimated_time = _parse_time_string(match.group(1))

            # Simplify3D: ;   Build time: 1 hours 23 minutes
            elif "BUILD TIME" in line_upper and estimated_time is None:
                match = re.search(r':\s*(.+)', line)
                if match:
                    estimated_time = _parse_time_string(match.group(1))

            # --- FILAMENT EXTRACTION ---

            # Cura: ;Filament used: 1.23456m
            # NOTE: exclude '[G]' here — otherwise PrusaSlicer's
            # '; total filament used [g] = 45.6' line would match this branch,
            # its metre-regex would fail, and the if/elif chain would skip the
            # grams branch below, leaving estimated_weight = None.
            if (
                "FILAMENT USED" in line_upper
                and "MM" not in line_upper
                and "[G]" not in line_upper
                and estimated_weight is None
            ):
                match = re.search(r':\s*([\d.]+)\s*m', line, re.IGNORECASE)
                if match:
                    length_m = float(match.group(1))
                    estimated_weight = _filament_m_to_grams(length_m, material)

            # PrusaSlicer: ; filament used [mm] = 12345.67
            elif "FILAMENT USED" in line_upper and "MM" in line_upper and estimated_weight is None:
                match = re.search(r'=\s*([\d.]+)', line)
                if match:
                    length_mm = float(match.group(1))
                    estimated_weight = _filament_mm_to_grams(length_mm, material)

            # PrusaSlicer: ; total filament used [g] = 45.6
            elif "FILAMENT USED" in line_upper and "[G]" in line_upper and estimated_weight is None:
                match = re.search(r'=\s*([\d.]+)', line)
                if match:
                    estimated_weight = round(float(match.group(1)), 1)

            # Simplify3D: ;   Filament length: 12345.6 mm
            elif "FILAMENT LENGTH" in line_upper and estimated_weight is None:
                match = re.search(r':\s*([\d.]+)\s*mm', line, re.IGNORECASE)
                if match:
                    length_mm = float(match.group(1))
                    estimated_weight = _filament_mm_to_grams(length_mm, material)

            # OrcaSlicer: ; filament_used_g = 45.6
            elif "FILAMENT_USED_G" in line_upper and estimated_weight is None:
                match = re.search(r'=\s*([\d.]+)', line)
                if match:
                    estimated_weight = round(float(match.group(1)), 1)

        logger.info(
            f"G-code parsed: time={estimated_time}s, weight={estimated_weight}g"
        )

    except Exception as e:
        logger.error(f"Error parsing G-code file {file_path}: {e}")

    return {
        "estimated_time_secs": estimated_time,
        "estimated_weight_g": estimated_weight,
    }
