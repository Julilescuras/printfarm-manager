"""
Extract embedded thumbnails from a stored G-code file.

Slicers (PrusaSlicer, OrcaSlicer, SuperSlicer, Cura with the right plugin) embed
one or more preview images as base64 inside comment blocks:

    ; thumbnail begin 220x124 7300
    ; iVBORw0KGgoAAAANSU...
    ; ...
    ; thumbnail end

We return the LARGEST embedded image as raw bytes, served by the manager itself
so the browser never has to reach the printer's local network.
"""

import base64
import re
import logging
from typing import Optional

logger = logging.getLogger("printfarm.gcode_thumbnail")

# Matches "; thumbnail begin 220x124 7300" and the JPG variant.
_BEGIN_RE = re.compile(
    r";\s*thumbnail(?:_JPG)?\s+begin\s+(\d+)\s*x\s*(\d+)\s+\d+",
    re.IGNORECASE,
)


def extract_gcode_thumbnail(gcode_path: str, max_scan_bytes: int = 4_000_000) -> Optional[bytes]:
    """Return the largest embedded thumbnail as raw image bytes, or None.

    Only the header region is scanned (slicers put thumbnails up top), with a
    hard byte cap, so we never read an entire multi-hundred-MB G-code file.
    """
    try:
        thumbnails: list[tuple[int, str]] = []  # (pixel area, base64 payload)
        scanned = 0
        in_thumb = False
        seen_thumb = False
        current: list[str] = []
        cw = ch = 0

        with open(gcode_path, "r", errors="ignore") as f:
            for line in f:
                scanned += len(line)
                s = line.strip()

                if in_thumb:
                    if "thumbnail" in s.lower() and "end" in s.lower():
                        if current:
                            thumbnails.append((cw * ch, "".join(current)))
                        in_thumb = False
                        current = []
                    elif s.startswith(";"):
                        current.append(s.lstrip(";").strip())
                    continue

                m = _BEGIN_RE.match(s)
                if m:
                    cw, ch = int(m.group(1)), int(m.group(2))
                    in_thumb = True
                    seen_thumb = True
                    current = []
                    continue

                # Once we've read the header thumbnails and reached real G-code,
                # stop — no point scanning the rest of a huge file.
                if seen_thumb and s and not s.startswith(";"):
                    break
                if scanned > max_scan_bytes:
                    break

        if not thumbnails:
            return None

        _, payload = max(thumbnails, key=lambda t: t[0])
        return base64.b64decode(payload)
    except FileNotFoundError:
        return None
    except Exception as e:
        logger.warning(f"Thumbnail extract failed for {gcode_path}: {e}")
        return None
