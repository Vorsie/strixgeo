"""Real-data acceptance: GEO-22/115-S10 deep sand must segment matig/dicht/zeer-dicht.

Reads scripts/throwaway_geotech_qc.json (qc dump of the CPT) and runs the production
suggest_geotech_subdivision over the deep sand litho segment (12.57-16.97 m, ZAND).
Asserts the spec anchor: n6 12.57-14.37 / n7 14.37-15.10 / n8 15.10-16.97 (+-0.1 m).

Run: uv run python scripts/eval_geotech_nad_segmentation.py
Regenerate the qc dump (dev DB) if missing:
  docker exec strix-db-1 psql -U groundmodel -d groundmodel -t -A -c \\
    "SELECT json_build_object('depths',depths_m,'qc',qc_mpa) FROM cpt_series \\
     WHERE cpt_id='019e932e-7c4a-75e4-bc8c-59ce4ba1231c';" > scripts/throwaway_geotech_qc.json
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from groundmodel.domain.services.geotech_subdivision import suggest_geotech_subdivision

_QC = _ROOT / "scripts" / "throwaway_geotech_qc.json"
_EXPECTED = [(12.57, 14.37, 6), (14.37, 15.10, 7), (15.10, 16.97, 8)]
_TOL = 0.1


def _segment(data: dict, *, gradient_snap: bool) -> list[tuple[float, float, int]]:
    """Run the production segmenter on the deep-sand segment."""
    splits = suggest_geotech_subdivision(
        soil="ZAND",
        admixtures=(),
        depth_m=data["depths"],
        qc_mpa=data["qc"],
        segment_top_m=12.57,
        segment_base_m=16.97,
        min_thickness_m=0.35,
        gradient_snap=gradient_snap,
    )
    return [(s.depth_top_m, s.depth_base_m, s.nad_class) for s in splits]


def main() -> int:
    """Assert the spec anchor (core, snap-off) + the conservative snap nudge (snap-on).

    The spec §2 anchor (n6 12.57-14.37 / n7 14.37-15.10 / n8 15.10-16.97) is the
    CORE conservative placement, so it is checked with ``gradient_snap=False`` —
    the deterministic algorithm contract. With the snap ON (the production
    default) the dicht/zeer-dicht boundary may move DEEPER to a genuinely sharp
    qc break (here ~15.27 m, where raw qc jumps to ~31 MPa): same classes, the
    boundary only ever moves in the conservative (deeper) direction. Both are
    asserted so a regression in either mode fails loudly.
    """
    if not _QC.exists():
        print(f"MISSING {_QC} — see the regenerate command in this file's docstring.")
        return 2
    data = json.loads(_QC.read_text())

    core = _segment(data, gradient_snap=False)
    snap = _segment(data, gradient_snap=True)
    print("GEO-22/115-S10 deep sand bands:")
    print("  core (snap off):", [(round(t, 2), round(b, 2), c) for t, b, c in core])
    print("  snap on (prod) :", [(round(t, 2), round(b, 2), c) for t, b, c in snap])

    core_ok = len(core) == len(_EXPECTED) and all(
        gc == ec and abs(gt - et) <= _TOL and abs(gb - eb) <= _TOL
        for (gt, gb, gc), (et, eb, ec) in zip(core, _EXPECTED)
    )
    # Snap-on: identical class sequence, the n7/n8 boundary only moves deeper
    # (conservative), and never by more than the default 0.5 m snap window.
    snap_ok = (
        [c for _t, _b, c in snap] == [c for _t, _b, c in _EXPECTED]
        and snap[1][1] >= core[1][1] - 1e-9
        and (snap[1][1] - core[1][1]) <= 0.5 + 1e-9
    )
    print("\nCORE ACCEPTANCE :", "PASS" if core_ok else f"FAIL (expected {_EXPECTED})")
    print(
        "SNAP ACCEPTANCE :",
        "PASS" if snap_ok else "FAIL (classes drifted or snap less conservative)",
    )
    return 0 if (core_ok and snap_ok) else 1


if __name__ == "__main__":
    raise SystemExit(main())
