"""
Standalone tests for the pure filament-tracking logic.

No pytest dependency (it isn't installed in the prod image): run directly with

    cd backend && python tests/test_filament_tracking.py

Exits non-zero if any assertion fails.
"""

import importlib.util
import os

# Load filament_tracking.py directly by path so the test stays dependency-free:
# importing it as `app.services.filament_tracking` would trigger
# app/services/__init__.py, which pulls in moonraker -> sqlalchemy/websockets.
_MODULE_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "app", "services", "filament_tracking.py")
)
_spec = importlib.util.spec_from_file_location("filament_tracking", _MODULE_PATH)
_ft = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_ft)

FilamentTrackingState = _ft.FilamentTrackingState
step_filament_tracking = _ft.step_filament_tracking

import sys  # noqa: E402


INITIAL = FilamentTrackingState(last_used=0.0, accumulated=0.0, initialized=False, flush_pending=False)

_passed = 0
_failed = 0


def check(name, condition):
    global _passed, _failed
    if condition:
        _passed += 1
        print(f"  PASS: {name}")
    else:
        _failed += 1
        print(f"  FAIL: {name}")


def feed(state, readings):
    """Run a list of filament_used readings through the tracker, returning the
    final state and the number of flush signals raised along the way."""
    flushes = 0
    for r in readings:
        state = step_filament_tracking(state, r)
        if state.flush_pending:
            flushes += 1
    return state, flushes


# --- 1. First reading adopts the baseline and counts nothing -----------------
s = step_filament_tracking(INITIAL, 1234.5)
check("first reading sets baseline, accumulates 0",
      s.initialized and s.last_used == 1234.5 and s.accumulated == 0.0)

# --- 2. Plain forward extrusion accumulates the net delta --------------------
s, _ = feed(INITIAL, [0.0, 10.0, 25.0, 100.0])
check("forward extrusion accumulates total delta (100mm)",
      abs(s.accumulated - 100.0) < 1e-9)

# --- 3. THE BUG: a retraction dip must NOT be counted as new extrusion -------
# Extrude to 1000, retract to 998, un-retract + extrude to 1005.
# Real new extrusion is 5mm. The old "lower baseline on any decrease" logic
# would have counted 1005 - 998 = 7mm. The fix must yield exactly 5mm.
s, flushes = feed(INITIAL, [0.0, 1000.0, 998.0, 1005.0])
check("retraction dip is not double-counted (net = 5mm, not 7mm)",
      abs(s.accumulated - 1005.0) < 1e-9 and flushes == 0)
# (accumulated == 1005 because we started the print from 0; the point is the
#  2mm retraction added nothing extra — 1005 total, not 1007.)

# --- 4. Many small retractions over a print never inflate the total ----------
# A real print: filament_used climbs from a non-zero baseline, with a 2mm
# retraction dip before each 10mm forward segment. Net forward = 50 * 10 = 500mm.
# All values stay well above the reset floor, so none should be seen as a reset.
start = FilamentTrackingState(last_used=100.0, accumulated=0.0, initialized=True, flush_pending=False)
readings = []
pos = 100.0
for _ in range(50):
    readings.append(pos - 2.0)   # retraction dip (drop of 2mm)
    pos += 10.0                  # forward 10mm net vs the kept baseline
    readings.append(pos)
s, flushes = feed(start, readings)
check("50 retractions do not inflate the accumulated total (net 500mm)",
      abs(s.accumulated - 500.0) < 1e-6 and flushes == 0)

# --- 5. New print (value near zero) triggers a reset/flush -------------------
s = FilamentTrackingState(last_used=4800.0, accumulated=120.0, initialized=True, flush_pending=False)
s2 = step_filament_tracking(s, 0.3)
check("near-zero reading flags a reset flush", s2.flush_pending and s2.last_used == 0.3)

# --- 6. A large drop (missed 'complete' event) also triggers a reset ---------
s = FilamentTrackingState(last_used=900.0, accumulated=50.0, initialized=True, flush_pending=False)
s2 = step_filament_tracking(s, 800.0)  # drop of 100mm > 50mm threshold
check("large drop (>50mm) flags a reset flush", s2.flush_pending and s2.last_used == 800.0)

# --- 7. A drop just under the threshold is treated as a retraction ----------
s = FilamentTrackingState(last_used=900.0, accumulated=50.0, initialized=True, flush_pending=False)
s2 = step_filament_tracking(s, 860.0)  # 40mm drop < 50mm threshold
check("sub-threshold drop is a retraction, baseline preserved",
      not s2.flush_pending and s2.last_used == 900.0 and s2.accumulated == 50.0)

# --- 8. Full mini-print: start, print with retractions, finish, new print ---
seq = [
    0.0,            # print A starts
    50.0, 48.0, 60.0,    # extrude w/ retraction -> net 60
    120.0, 118.0, 130.0, # more, net 130
    0.5,            # print B starts (reset)
    40.0,           # extrude in B
]
s, flushes = feed(INITIAL, seq)
check("multi-print sequence flushes once at the new print",
      flushes == 1)

print()
print(f"Filament tracking tests: {_passed} passed, {_failed} failed")
sys.exit(1 if _failed else 0)
