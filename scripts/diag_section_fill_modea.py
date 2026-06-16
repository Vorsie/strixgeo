"""Read-only diagnostic: why the 2-D model fill (Mode A) shows only small patches.

Ports the FRONTEND mode-A sampler (``desktop/.../utils/sectionFromSolids.ts``
``collectCrossings`` + ``sampleSolidColumns``) and the ``ModelFillOverlay``
"a body needs >=2 columns to draw a band" rule, then runs them on the REAL
``test.strix`` voxel solids (built in-process from the captured partition
fixture — no DB) using each section's column world ``(x, y)`` as the ray
positions, exactly as ``SectionPanel`` does.

Goal — separate two hypotheses for "only small patches of fill":

  H1  SEAM bug: the frontend ``collectCrossings`` uses an edge-inclusive
      point-in-triangle with NO seam-nudge.  Commit 28458f65 added a
      ``_SEAM_NUDGE_M`` to the BACKEND sampler (``vertical_ray_intervals``) but
      NOT to the frontend mirror.  On blocky voxel meshes a ray grazing a shared
      cell seam reports spurious slivers / two-body overlaps.

  H2  body_id FRAGMENTATION: a body rarely occupies >=2 of a section's columns,
      so Mode A (which needs >=2 to draw a band) fills almost nothing.

We measure both with the frontend algorithm WITHOUT the nudge (current prod) and
WITH it (the backend fix ported), and report the per-section band coverage so the
diff is unambiguous.

NOTE: the fixture build is the UN-BOUNDED labelling (no geo surfaces in the
fixture), so it omits the geo-band ``uuid5`` split that the dogfeed model has.
That split can only INCREASE fragmentation, so this is a lower bound for H2 and a
faithful reproduction for H1 (same voxel geometry class).

Usage
-----
    uv run python scripts/diag_section_fill_modea.py
    uv run python scripts/diag_section_fill_modea.py --horizontal 2 --vertical 0.5
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter, defaultdict
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from groundmodel.domain.services.voxel_litho.build_domain_from_sections import (  # noqa: E402
    build_domain_from_sections,
)
from groundmodel.domain.services.voxel_litho.extract_body_solids import (  # noqa: E402
    extract_body_solids,
)
from groundmodel.domain.services.voxel_litho.label_voxels import label_voxels  # noqa: E402
from scripts.eval_voxel_label import _FIXTURE, _load_sections  # noqa: E402

# Frontend constants (sectionFromSolids.ts), copied verbatim.
_AREA_EPS = 1e-10
_DEDUP_EPS = 1e-6
_SEAM_NUDGE_M = 1e-9  # commit 28458f65, applied to the BACKEND only


def _point_in_triangle_2d(px, py, ax, ay, bx, by, cx, cy) -> bool:
    """Edge-inclusive 2-D point-in-triangle — exact port of the frontend."""
    area2 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
    if abs(area2) < _AREA_EPS:
        return False
    d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by)
    d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy)
    d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay)
    has_neg = d1 < 0 or d2 < 0 or d3 < 0
    has_pos = d1 > 0 or d2 > 0 or d3 > 0
    return not (has_neg and has_pos)


def _interp_z(px, py, ax, ay, az, bx, by, bz, cx, cy, cz) -> float:
    """Barycentric z interpolation — exact port of the frontend."""
    area2 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
    u = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area2
    v = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area2
    w = 1 - u - v
    return u * az + v * bz + w * cz


def _collect_crossings(mesh, px, py) -> list[float]:
    """Port of the frontend ``collectCrossings``: sorted, deduped z-crossings."""
    raw: list[float] = []
    verts = mesh.vertices
    for i, j, k in mesh.triangles:
        ax, ay, az = verts[i]
        bx, by, bz = verts[j]
        cx, cy, cz = verts[k]
        if not _point_in_triangle_2d(px, py, ax, ay, bx, by, cx, cy):
            continue
        raw.append(_interp_z(px, py, ax, ay, az, bx, by, bz, cx, cy, cz))
    if not raw:
        return []
    raw.sort()
    out = [raw[0]]
    for z in raw[1:]:
        if z - out[-1] > _DEDUP_EPS:
            out.append(z)
    return out


def _segments_at(mesh, px, py, *, nudge: bool):
    """Return [(base, top), ...] intervals for one body at (px, py)."""
    if nudge:
        px = px + _SEAM_NUDGE_M
        py = py + _SEAM_NUDGE_M
    cr = _collect_crossings(mesh, px, py)
    segs = []
    i = 0
    while i + 1 < len(cr):
        segs.append((min(cr[i], cr[i + 1]), max(cr[i], cr[i + 1])))
        i += 2
    odd = len(cr) % 2 == 1
    return segs, odd


def _analyse_section(section, bodies, *, nudge: bool, vstep: float):
    """Run Mode A over one section's columns; return coverage + defect metrics."""
    cols = section.columns
    # body_id -> set of column indices where it has >=1 segment
    cols_by_body: dict[str, set[int]] = defaultdict(set)
    sliver_count = 0
    odd_count = 0
    overlap_pairs = 0
    seg_total = 0
    empty_cols: list[str] = []  # investigation_ids with ZERO model segments
    for ci, col in enumerate(cols):
        px, py = col.world_x, col.world_y
        col_seg_count = 0
        col_intervals: list[tuple[str, float, float]] = []  # (body_id, base, top)
        for b in bodies:
            segs, odd = _segments_at(b, px, py, nudge=nudge)
            if odd:
                odd_count += 1
            for base, top in segs:
                seg_total += 1
                col_seg_count += 1
                cols_by_body[b.body_id].add(ci)
                if (top - base) < vstep * 0.5:
                    sliver_count += 1
                col_intervals.append((b.body_id, base, top))
        if col_seg_count == 0:
            empty_cols.append(col.investigation_id)
        # Count overlapping intervals from DIFFERENT bodies at this column
        # (the seam-bug signature: two abutting bodies both claim the seam voxel).
        for a_idx in range(len(col_intervals)):
            bid_a, base_a, top_a = col_intervals[a_idx]
            for b_idx in range(a_idx + 1, len(col_intervals)):
                bid_b, base_b, top_b = col_intervals[b_idx]
                if bid_a == bid_b:
                    continue
                ov = min(top_a, top_b) - max(base_a, base_b)
                if ov > _DEDUP_EPS:
                    overlap_pairs += 1

    span_hist = Counter(len(cset) for cset in cols_by_body.values())
    bands_drawn = sum(1 for cset in cols_by_body.values() if len(cset) >= 2)
    single_col = sum(1 for cset in cols_by_body.values() if len(cset) == 1)
    return {
        "n_cols": len(cols),
        "bodies_present": len(cols_by_body),
        "bands_drawn": bands_drawn,
        "single_col": single_col,
        "span_hist": span_hist,
        "slivers": sliver_count,
        "odd": odd_count,
        "overlap_pairs": overlap_pairs,
        "seg_total": seg_total,
        "empty_cols": empty_cols,
    }


_SLICE_EPS = 1e-6


def _plane_side(vx, vy, ax, ay, dx, dy) -> float:
    """Signed perpendicular side of (vx,vy) vs the section line — frontend port."""
    return dx * (vy - ay) - dy * (vx - ax)


def _slice_body(mesh, ax, ay, dx, dy, dhx, dhy):
    """Port of the frontend collectCutSegments: triangle-plane cut segments."""
    segs = []
    verts = mesh.vertices
    for i, j, k in mesh.triangles:
        vax, vay, vaz = verts[i]
        vbx, vby, vbz = verts[j]
        vcx, vcy, vcz = verts[k]
        sa = _plane_side(vax, vay, ax, ay, dx, dy)
        sb = _plane_side(vbx, vby, ax, ay, dx, dy)
        sc = _plane_side(vcx, vcy, ax, ay, dx, dy)
        sA = 0.0 if abs(sa) < _SLICE_EPS else sa
        sB = 0.0 if abs(sb) < _SLICE_EPS else sb
        sC = 0.0 if abs(sc) < _SLICE_EPS else sc
        crossings = []

        def _edge(x0, y0, z0, x1, y1, z1, s0, s1):
            if not ((s0 > 0 and s1 < 0) or (s0 < 0 and s1 > 0)):
                return
            t = s0 / (s0 - s1)
            cx = x0 + t * (x1 - x0)
            cy = y0 + t * (y1 - y0)
            cz = z0 + t * (z1 - z0)
            crossings.append((dhx * (cx - ax) + dhy * (cy - ay), cz))

        _edge(vax, vay, vaz, vbx, vby, vbz, sA, sB)
        _edge(vbx, vby, vbz, vcx, vcy, vcz, sB, sC)
        _edge(vcx, vcy, vcz, vax, vay, vaz, sC, sA)
        if len(crossings) == 2:
            segs.append(crossings)
    return segs


def _mode_b_coverage(section, bodies):
    """Slice the solids at the section plane; return (n_polys, along_coverage_m,
    section_along_len_m, n_bodies_hit)."""
    ax, ay = section.start_x, section.start_y
    dx, dy = section.end_x - ax, section.end_y - ay
    length = (dx * dx + dy * dy) ** 0.5
    if length < _SLICE_EPS:
        return 0, 0.0, 0.0, 0
    dhx, dhy = dx / length, dy / length
    # Section's column along-extent (where fill is expected).
    alongs = [c.along_m for c in section.columns]
    a_lo, a_hi = (min(alongs), max(alongs)) if alongs else (0.0, 0.0)
    span = max(a_hi - a_lo, 1e-9)
    # Union of along-intervals covered by any slice segment, clipped to [a_lo,a_hi].
    intervals = []
    n_polys = 0
    hit = 0
    for b in bodies:
        segs = _slice_body(b, ax, ay, dx, dy, dhx, dhy)
        if not segs:
            continue
        hit += 1
        n_polys += 1  # one body → one (possibly multi-loop) poly group
        for (a0, _z0), (a1, _z1) in segs:
            lo, hi = min(a0, a1), max(a0, a1)
            lo, hi = max(lo, a_lo), min(hi, a_hi)
            if hi > lo:
                intervals.append((lo, hi))
    # Merge intervals → covered length.
    covered = 0.0
    for lo, hi in sorted(intervals):
        if covered == 0.0 and not intervals:
            break
    intervals.sort()
    cur_lo = cur_hi = None
    for lo, hi in intervals:
        if cur_hi is None:
            cur_lo, cur_hi = lo, hi
        elif lo <= cur_hi:
            cur_hi = max(cur_hi, hi)
        else:
            covered += cur_hi - cur_lo
            cur_lo, cur_hi = lo, hi
    if cur_hi is not None:
        covered += cur_hi - cur_lo
    return n_polys, covered, span, hit


def main() -> int:
    """Build the real voxel solids and report Mode-A fill coverage + defects."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--horizontal", type=float, default=2.0)
    parser.add_argument("--vertical", type=float, default=0.5)
    parser.add_argument("--fixture", type=Path, default=_FIXTURE)
    args = parser.parse_args()

    sections, fixture_h = _load_sections(args.fixture)
    h, v = args.horizontal, args.vertical
    print(f"Loaded {len(sections)} sections; building voxel grid at {h} m / {v} m (UN-bounded)")
    domain = build_domain_from_sections(sections)
    grid = label_voxels(domain, h, sections, vertical_spacing_m=v)
    bodies = extract_body_solids(grid)
    print(f"Grid {len(grid.gx)}x{len(grid.gy)}x{len(grid.gz)}; {len(bodies)} body solids meshed\n")

    for nudge in (False, True):
        tag = "WITH seam-nudge (backend fix)" if nudge else "NO nudge (current FRONTEND)"
        print(f"================  Mode A — {tag}  ================")
        agg = Counter()
        for si, section in enumerate(sections):
            m = _analyse_section(section, bodies, nudge=nudge, vstep=v)
            agg["n_cols"] += m["n_cols"]
            agg["bands_drawn"] += m["bands_drawn"]
            agg["single_col"] += m["single_col"]
            agg["slivers"] += m["slivers"]
            agg["odd"] += m["odd"]
            agg["overlap_pairs"] += m["overlap_pairs"]
            agg["seg_total"] += m["seg_total"]
            hist = dict(sorted(m["span_hist"].items()))
            empty = f" EMPTY_COLS={m['empty_cols']}" if m["empty_cols"] else ""
            print(
                f"  S{si:<2} cols={m['n_cols']:<3} present={m['bodies_present']:<4} "
                f"BANDS(>=2col)={m['bands_drawn']:<4} 1col={m['single_col']:<4} "
                f"slivers={m['slivers']:<4} odd={m['odd']:<4} overlap={m['overlap_pairs']:<4} "
                f"span_hist={hist}{empty}"
            )
        print(
            f"  TOTAL  cols={agg['n_cols']} segs={agg['seg_total']} "
            f"BANDS={agg['bands_drawn']} 1col-skipped={agg['single_col']} "
            f"slivers={agg['slivers']} odd-crossings={agg['odd']} overlap-pairs={agg['overlap_pairs']}\n"
        )

    # --- Mode B (plane slice) coverage --------------------------------------
    print("================  Mode B — section-plane SLICE coverage  ================")
    tot_cov = tot_span = 0.0
    for si, section in enumerate(sections):
        n_polys, covered, span, hit = _mode_b_coverage(section, bodies)
        tot_cov += covered
        tot_span += span
        pct = 100.0 * covered / span if span else 0.0
        print(
            f"  S{si:<2} bodies_hit={hit:<4} polys={n_polys:<4} "
            f"along_cover={covered:7.1f}m / {span:7.1f}m = {pct:5.1f}%"
        )
    print(
        f"  TOTAL along-coverage {tot_cov:.0f}m / {tot_span:.0f}m = "
        f"{100.0 * tot_cov / tot_span if tot_span else 0:.1f}% of the column span\n"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
