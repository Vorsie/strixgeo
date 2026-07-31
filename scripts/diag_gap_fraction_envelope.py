"""Report how far each gap's partition polygons fall short of the gap's own edges.

``_section_stack_at`` queries the 2-D partition at a gap-local fraction. A query at
the extreme edge only returns regions if the polygons actually reach that fraction.
The engine snaps its arrangement on a 1 mm grid in along-section metres, so a tiny
shortfall is expected and the builder insets by two grid cells to absorb it.

This prints the shortfall for every gap **in millimetres of along-section distance**,
using that gap's own width — a fraction shortfall means nothing without it. Anything
materially over the snap grid is not rounding; it is the fill genuinely stopping short,
which is a 2-D question and must not be papered over with a bigger inset.

Read-only. Takes the payload the desktop sent, so it measures what the builder sees.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

PAYLOAD = Path("scripts/throwaway_v2_voxel_payload.json")
SNAP_MM = 1.0  # the 2-D engine's arrangement snap grid


def main() -> int:
    if not PAYLOAD.exists():
        print(f"no payload at {PAYLOAD}", file=sys.stderr)
        return 1
    raw = json.loads(PAYLOAD.read_text(encoding="utf-8"))
    sections = raw.get("sections", raw)

    rows = []
    for si, sec in enumerate(sections):
        cols = sec.get("columns", [])
        by_gap: dict[int, list] = {}
        for r in sec.get("regions", []):
            by_gap.setdefault(r["gap_index"], []).append(r)
        for gi, regions in sorted(by_gap.items()):
            xs = [p[0] for r in regions for p in r["polygon"]]
            if not xs or gi + 1 >= len(cols):
                continue
            lo, hi = min(xs), max(xs)
            left, right = cols[gi], cols[gi + 1]
            width = math.hypot(
                right["world_x"] - left["world_x"], right["world_y"] - left["world_y"]
            )
            rows.append((si, gi, lo * width * 1000.0, (1.0 - hi) * width * 1000.0, width, len(regions)))

    worst = sorted(rows, key=lambda r: max(r[2], r[3]), reverse=True)
    print(f"{len(rows)} non-empty gaps; shortfall in mm of along-section distance\n")
    print(f"{'sec':>4} {'gap':>4} {'left mm':>9} {'right mm':>9} {'width m':>9} {'regions':>8}")
    over = 0
    for si, gi, lmm, rmm, width, n in worst[:12]:
        flag = "  <-- beyond the snap grid" if max(lmm, rmm) > SNAP_MM * 2 else ""
        print(f"{si:>4} {gi:>4} {lmm:>9.3f} {rmm:>9.3f} {width:>9.2f} {n:>8}{flag}")
    for si, gi, lmm, rmm, *_ in rows:
        if max(lmm, rmm) > SNAP_MM * 2:
            over += 1
    print(f"\n{over} of {len(rows)} gaps fall short by more than two snap cells (2 mm)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
