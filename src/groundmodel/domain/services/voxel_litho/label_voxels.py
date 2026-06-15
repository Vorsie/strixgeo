"""Label a 3-D voxel grid from the validated 2-D section partitions.

This is the heart of the voxel-litho builder (spec §"A. label_voxels").
Rather than build bodies and then reconcile them (every prior 3-D attempt,
which produced overlaps / holes / non-faithfulness), we **label space**:
every voxel of a regular grid is assigned the body that fills it, read
directly from the frontend's ``computeSectionFill`` partitions.  A labelling
of space is itself a partition, so the per-body boundaries the mesher (Task 4)
extracts are watertight and faithful by construction — and because any voxel
can carry any body, interfingering / pinch-out is representable (the implicit
field could not do this).

The vertical stack at a map-plane point ``(x, y)`` is the SAME 2-nearest-section
+ midline-pinch blend the retired ``loft_field`` validated geologically (only
its mesher failed — which we do not use).  This module PORTS those functions,
re-pointed at the voxel-litho value objects:

* ``_project_point_to_segment`` — copied verbatim.
* ``_slice_region_intervals`` — adapted: our ``RegionInput.polygon`` is a
  ``tuple[(fraction, elevation), ...]`` of plain float pairs (``p[0]`` =
  fraction, ``p[1]`` = elevation), not objects with ``.fraction`` / ``.elevation``.
* ``_section_stack_at`` — adapted to ``SectionColumnInput.along_m`` and
  ``RegionInput.gap_index`` / ``.polygon``.
* ``_blend_stacks`` / ``_blended_top`` / ``_layout`` — the midline pinch:
  bodies present on BOTH sections (paired by ``body_id`` then elevation rank)
  blend thickness by weight; a body present on only ONE side pinches to zero
  thickness at the equidistance midline.  PORTED faithfully.
* ``_stack_at`` — the ``LoftField.stack_at`` 2-nearest + between/beyond rule.

Difference from ``loft_field`` (documented per spec): our ``RegionInput`` has
NO ``kind`` / ``overlay_tier`` fields, so we do NOT reconstruct band/onlap/lens
kinds.  The midline pinch between two sections is purely geometric (present on
one stack, absent on the other) and needs no kind.  For the BEYOND rule (a
voxel beyond all its nearest sections but inside the domain footprint) we take
the simple faithful choice: **extend the nearest section's stack laterally**
(horizontal extrapolation within the hull — consistent with the
litho-extrapolated-horizontally stance).  A voxel OUTSIDE the domain footprint
is void (-1).

Pure domain module — scipy/numpy only, no I/O, no logging, no framework
imports.  The helpers compute; they do not act, so nothing inherits
``GroundModelLogger``.
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass

import numpy as np

from groundmodel.domain.services.model_domain import ModelDomain
from groundmodel.domain.services.voxel_litho.voxel_types import (
    LabelGrid,
    SectionPartitionInput,
)

__all__ = ["label_voxels"]

# Tolerance for "zero thickness / coincident elevation".  Mirrors the loft /
# partition pipeline's EPS; intervals thinner than this are dropped.
_EPS: float = 1e-9

# Fraction nudge: slicing a region polygon exactly on a column edge (fraction 0
# or 1) hits vertices and vertical edges; nudge the query fraction this far into
# the gap interior so every relevant edge strictly straddles the slice line.
_FRAC_EPS: float = 1e-6


# ---------------------------------------------------------------------------
# Internal stack entry
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class _Entry:
    """One vertical interval of a single body at a map-plane point.

    Parameters
    ----------
    body_id : str or None
        Resolver-stamped body identity, or ``None`` for a never-correlated
        minority (these never match across sections — always one-sided).
    formation_id : str
        Lithology (drives the fill colour / formation lookup).
    top_elev : float
        Top elevation of the interval (mTAW, positive up).
    base_elev : float
        Base elevation of the interval (mTAW, positive up; below ``top_elev``).
    """

    body_id: str | None
    formation_id: str
    top_elev: float
    base_elev: float


def _th(e: _Entry) -> float:
    """Vertical thickness of an interval (``top_elev - base_elev``)."""
    return e.top_elev - e.base_elev


def _mid(e: _Entry) -> float:
    """Mid-elevation of an interval (``(top_elev + base_elev) / 2``)."""
    return (e.top_elev + e.base_elev) / 2.0


# ---------------------------------------------------------------------------
# Geometry helpers (ported from loft_field)
# ---------------------------------------------------------------------------


def _project_point_to_segment(
    x: float, y: float, ax: float, ay: float, bx: float, by: float
) -> tuple[float, float, float, float]:
    """Project ``(x, y)`` onto segment ``[a, b]`` (clamped to its endpoints).

    Ported verbatim from ``loft_field._project_point_to_segment``.

    Parameters
    ----------
    x, y : float
        The map-plane query point.
    ax, ay, bx, by : float
        The section segment endpoints.

    Returns
    -------
    tuple[float, float, float, float]
        ``(along, dist, px, py)`` — distance of the projected point from
        ``a`` along the segment, perpendicular distance of ``(x, y)`` to the
        clamped projection, and the projected point coordinates.
    """
    abx = bx - ax
    aby = by - ay
    seg2 = abx * abx + aby * aby
    if seg2 < _EPS:
        px, py, along = ax, ay, 0.0
    else:
        t = ((x - ax) * abx + (y - ay) * aby) / seg2
        t = min(max(t, 0.0), 1.0)
        px = ax + t * abx
        py = ay + t * aby
        along = t * math.sqrt(seg2)
    dist = math.hypot(x - px, y - py)
    return along, dist, px, py


def _slice_region_intervals(
    polygon: tuple[tuple[float, float], ...], f: float
) -> list[tuple[float, float]]:
    """Slice a region polygon by the vertical line ``fraction = f``.

    Even-odd scanline with a half-open edge convention (each spanning edge
    contributes exactly one crossing).  Adapted from
    ``loft_field._slice_region_intervals``: our polygon points are plain
    ``(fraction, elevation)`` float pairs, so ``p[0]`` is the fraction and
    ``p[1]`` the elevation.

    Parameters
    ----------
    polygon : tuple of (float, float)
        Closed ring (no repeated last point) in ``(fraction, elevation)`` space.
    f : float
        The fraction to slice at (already nudged off the column edges).

    Returns
    -------
    list of (float, float)
        ``(base_elev, top_elev)`` pairs, base below top.  Empty when the
        region does not cover ``f`` (e.g. a pinched-out apex).
    """
    xs = [p[0] for p in polygon]
    if f < min(xs) or f > max(xs):
        return []
    crossings: list[float] = []
    n = len(polygon)
    for i in range(n):
        x0, y0 = polygon[i][0], polygon[i][1]
        x1, y1 = polygon[(i + 1) % n][0], polygon[(i + 1) % n][1]
        if x0 == x1:
            continue  # vertical edge — the nudged slice line never lies exactly here
        if (x0 <= f < x1) or (x1 <= f < x0):
            tt = (f - x0) / (x1 - x0)
            crossings.append(y0 + tt * (y1 - y0))
    crossings.sort()
    out: list[tuple[float, float]] = []
    for k in range(0, len(crossings) - 1, 2):
        base, top = crossings[k], crossings[k + 1]
        if top - base > _EPS:
            out.append((base, top))
    return out


def _project_to_section_fence(
    section: SectionPartitionInput, x: float, y: float
) -> tuple[int, float, float, float, float]:
    """Project ``(x, y)`` onto the section's column-WORLD polyline.

    The faithful section geometry is the polyline through the columns' true
    ``(world_x, world_y)`` positions (the canonical fence), NOT the smoothed
    ``start → end`` line: in real data ``along_m`` (the section-view axis with
    its column-spacing nudge) does not equal world distance, and the columns
    sit metres off the ``start → end`` line.  So we project onto each gap
    segment (between consecutive columns' world positions) and keep the nearest
    one, yielding the gap index, the gap-local fraction (0 = left column,
    1 = right column — exactly the region polygon's fraction axis), and the
    perpendicular distance (used for the 2-nearest-section blend).

    A projection beyond the first / last column clamps to that end column's
    fraction (0 or 1), so the section extends its end stack laterally —
    consistent with the 2-D model and the loft's beyond rule.

    Parameters
    ----------
    section : SectionPartitionInput
        The section whose fence is projected onto.
    x, y : float
        The map-plane query point (metres, project CRS).

    Returns
    -------
    tuple[int, float, float, float, float]
        ``(gap_index, fraction, perp_dist, foot_x, foot_y)`` — the foot is the
        projected point on the nearest gap segment (for the between/beyond
        test).  Returns ``(-1, 0.0, inf, x, y)`` when the section has fewer
        than 2 columns (no gap to slice).
    """
    cols = section.columns
    if len(cols) < 2:
        return -1, 0.0, math.inf, x, y
    best_gap = 0
    best_frac = 0.0
    best_dist = math.inf
    best_px = x
    best_py = y
    for gi in range(len(cols) - 1):
        a = cols[gi]
        b = cols[gi + 1]
        along, dist, px, py = _project_point_to_segment(
            x, y, a.world_x, a.world_y, b.world_x, b.world_y
        )
        seg_len = math.hypot(b.world_x - a.world_x, b.world_y - a.world_y)
        frac = 0.0 if seg_len < _EPS else along / seg_len
        frac = min(max(frac, 0.0), 1.0)
        if dist < best_dist:
            best_dist = dist
            best_gap = gi
            best_frac = frac
            best_px = px
            best_py = py
    return best_gap, best_frac, best_dist, best_px, best_py


def _section_stack_at(
    section: SectionPartitionInput, gap_index: int, fraction: float
) -> list[_Entry]:
    """The section's vertical stack in gap ``gap_index`` at local ``fraction``.

    Slices every region of that gap at the (nudged) fraction and returns the
    intervals shallow → deep.  Adapted from ``loft_field._section_stack_at``:
    the gap + fraction now come from :func:`_project_to_section_fence` (the
    column-world polyline projection), not a bisect over ``along_m``.

    Parameters
    ----------
    section : SectionPartitionInput
        The section whose stack is read.
    gap_index : int
        The gap (column pair) the query point falls in.
    fraction : float
        The gap-local horizontal fraction (0 = left column, 1 = right column).

    Returns
    -------
    list of _Entry
        The vertical body intervals, ordered shallow → deep (descending top).
    """
    if gap_index < 0:
        return []
    # Nudge off the column edges so the scanline strictly straddles every edge.
    f = min(max(fraction, _FRAC_EPS), 1.0 - _FRAC_EPS)
    raw: list[_Entry] = []
    for r in section.regions:
        if r.gap_index != gap_index:
            continue
        for base_e, top_e in _slice_region_intervals(r.polygon, f):
            raw.append(_Entry(r.body_id, r.formation_id, top_e, base_e))
    raw.sort(key=lambda e: -e.top_elev)
    return raw


# ---------------------------------------------------------------------------
# Stack blending (the midline pinch — ported from loft_field)
# ---------------------------------------------------------------------------


def _layout(specs: list[tuple[float, str | None, str, float]], top: float | None) -> list[_Entry]:
    """Lay out placement specs cumulatively from ``top`` (the partition rule).

    Each spec is ``(ref_elev, body_id, formation_id, thickness)`` already
    sorted shallow → deep.  Entries are stacked contiguously so the result is
    gap-free by construction; zero-thickness specs (a fully pinched body) are
    dropped from the output but still advance the running elevation (by zero),
    keeping the stack a true partition.

    Ported from ``loft_field._layout``.

    Parameters
    ----------
    specs : list of (float, str or None, str, float)
        ``(ref_elev, body_id, formation_id, thickness)`` tuples shallow → deep.
    top : float or None
        The blended top elevation; ``None`` yields an empty stack.

    Returns
    -------
    list of _Entry
        The laid-out, gap-free stack.
    """
    if top is None:
        return []
    out: list[_Entry] = []
    cur = top
    for _ref, body_id, formation_id, thickness in specs:
        base = cur - thickness
        if thickness > _EPS:
            out.append(_Entry(body_id, formation_id, cur, base))
        cur = base
    return out


def _blended_top(stack1: list[_Entry], stack2: list[_Entry], w1: float) -> float | None:
    """Blend the two stacks' top elevations, tolerating an empty stack.

    Ported from ``loft_field._blended_top``.

    Parameters
    ----------
    stack1, stack2 : list of _Entry
        The two sections' stacks (shallow → deep).
    w1 : float
        Inverse-distance weight for ``stack1``.

    Returns
    -------
    float or None
        The blended top elevation, or ``None`` when both stacks are empty.
    """
    t1 = stack1[0].top_elev if stack1 else None
    t2 = stack2[0].top_elev if stack2 else None
    if t1 is None and t2 is None:
        return None
    if t1 is None:
        return t2
    if t2 is None:
        return t1
    return w1 * t1 + (1.0 - w1) * t2


def _blend_stacks(stack1: list[_Entry], stack2: list[_Entry], w1: float) -> list[_Entry]:
    """Blend two section stacks at inverse-distance weight ``w1`` (for stack 1).

    Bodies present on BOTH stacks (matched by ``body_id``, re-entrant
    occurrences paired by elevation rank) blend their thickness by ``w1``.  A
    body present on only one stack pinches: its thickness scales by
    ``max(0, 2*w_own - 1)`` — full at its own section, zero at the equidistance
    midline (the lens / pinch-out behaviour).  ``None`` bodies (never-correlated
    minorities) are always one-sided (no cross-section identity to match on).
    The result is laid out cumulatively so it tiles.

    Ported faithfully from ``loft_field._blend_stacks``.

    Parameters
    ----------
    stack1, stack2 : list of _Entry
        The two sections' stacks (shallow → deep).
    w1 : float
        Inverse-distance weight for ``stack1`` (``w2 = 1 - w1``).

    Returns
    -------
    list of _Entry
        The blended, gap-free stack.
    """
    w2 = 1.0 - w1
    g1: dict[str, list[_Entry]] = defaultdict(list)
    g2: dict[str, list[_Entry]] = defaultdict(list)
    for e in stack1:
        if e.body_id is not None:
            g1[e.body_id].append(e)
    for e in stack2:
        if e.body_id is not None:
            g2[e.body_id].append(e)
    matched = set(g1) & set(g2)

    specs: list[tuple[float, str | None, str, float]] = []
    for body in matched:
        left = sorted(g1[body], key=lambda e: -_mid(e))
        right = sorted(g2[body], key=lambda e: -_mid(e))
        for k in range(max(len(left), len(right))):
            e1 = left[k] if k < len(left) else None
            e2 = right[k] if k < len(right) else None
            if e1 is not None and e2 is not None:
                th = w1 * _th(e1) + w2 * _th(e2)
                ref = w1 * _mid(e1) + w2 * _mid(e2)
                specs.append((ref, body, e1.formation_id, th))
            elif e1 is not None:
                specs.append((_mid(e1), body, e1.formation_id, _th(e1) * max(0.0, 2 * w1 - 1)))
            elif e2 is not None:
                specs.append((_mid(e2), body, e2.formation_id, _th(e2) * max(0.0, 2 * w2 - 1)))

    # One-sided: non-matched non-None bodies, and every None-body entry.
    for e in stack1:
        if e.body_id is None or e.body_id not in matched:
            specs.append((_mid(e), e.body_id, e.formation_id, _th(e) * max(0.0, 2 * w1 - 1)))
    for e in stack2:
        if e.body_id is None or e.body_id not in matched:
            specs.append((_mid(e), e.body_id, e.formation_id, _th(e) * max(0.0, 2 * w2 - 1)))

    # Order shallow → deep by reference elevation; the body-id tie-break is only
    # for determinism on exact elevation ties (None bodies sort as "None" — each
    # stays its own spec, they never merge).
    specs.sort(key=lambda s: (-s[0], str(s[1])))
    return _layout(specs, _blended_top(stack1, stack2, w1))


# ---------------------------------------------------------------------------
# The per-column stack (LoftField.stack_at, ported)
# ---------------------------------------------------------------------------


def _stack_at(sections: list[SectionPartitionInput], x: float, y: float) -> list[_Entry]:
    """Return the vertical body stack at map-plane point ``(x, y)``.

    Picks the two nearest sections by perpendicular distance; blends them when
    the node lies BETWEEN them (its projection onto the axis joining the two
    projection points has ``t in [0, 1]``), else extrudes the nearest section
    alone (the BEYOND rule = horizontal extrapolation of the nearest section's
    stack — we have no band/onlap/lens kind to ramp, so we extend faithfully).

    Ported from ``loft_field.LoftField.stack_at`` minus the band-clipping and
    domain-clipping (the caller clips Z to the domain bbox grid; the footprint
    test gates labelling).

    Parameters
    ----------
    sections : list of SectionPartitionInput
        The project's cross-sections with their 2-D partitions.
    x, y : float
        Map-plane query coordinates (metres, project CRS).

    Returns
    -------
    list of _Entry
        The body stack ordered shallow → deep; ``[]`` when there are no
        sections.
    """
    if not sections:
        return []

    # Project onto every section's column-world fence; rank by perpendicular
    # distance to the nearest gap segment.  Each tuple is
    # (section, gap_index, fraction, perp_dist, foot_x, foot_y).
    projs = [(s, *_project_to_section_fence(s, x, y)) for s in sections]
    projs.sort(key=lambda p: p[3])  # by perpendicular distance
    s1, gap1, frac1, d1, px1, py1 = projs[0]

    between = False
    if len(projs) >= 2:
        # Blend only when the node lies BETWEEN the two sections — its
        # projection onto the axis joining the two foot points has t in [0, 1].
        # For near-parallel sections this axis is the true interpolation
        # direction; for crossing sections it errs toward blending, which is
        # geologically reasonable in the crossing zone.
        _s2, _g2, _f2, _d2, px2, py2 = projs[1]
        dx, dy = px2 - px1, py2 - py1
        axis2 = dx * dx + dy * dy
        t = 0.0 if axis2 < _EPS else ((x - px1) * dx + (y - py1) * dy) / axis2
        between = -_EPS <= t <= 1.0 + _EPS

    if between:
        s2, gap2, frac2, d2, _px2, _py2 = projs[1]
        stack1 = _section_stack_at(s1, gap1, frac1)
        stack2 = _section_stack_at(s2, gap2, frac2)
        denom = d1 + d2
        w1 = 0.5 if denom < _EPS else d2 / denom
        return _blend_stacks(stack1, stack2, w1)

    # Beyond rule: horizontal extrapolation of the nearest section's stack
    # (no kind to ramp; extend it faithfully within the domain footprint).
    return _section_stack_at(s1, gap1, frac1)


# ---------------------------------------------------------------------------
# The grid labeller
# ---------------------------------------------------------------------------


def label_voxels(
    domain: ModelDomain,
    grid_spacing_m: float,
    sections: list[SectionPartitionInput],
) -> LabelGrid:
    """Label a regular 3-D voxel grid from the 2-D section partitions.

    Builds a regular grid over the domain's ``(x, y)`` bounding box and the
    section data's elevation range, then for each voxel column ``(x, y)``
    computes the blended section stack once and assigns every ``z`` voxel the
    body whose ``[base, top]`` interval contains it (else void).  A voxel whose
    ``(x, y)`` falls outside the domain footprint is void (``-1``).

    The body ordering is deterministic (sorted ``body_id`` strings), so the
    labelling — and therefore every downstream mesh — is reproducible.

    Parameters
    ----------
    domain : ModelDomain
        The lateral footprint (``contains``) and ``(x, y)`` extent (its alpha
        hull polygon) of the model.  Built by the caller (Task 6) from the
        investigation positions; constructed directly in tests / eval.
    grid_spacing_m : float
        The voxel edge length in metres (same in x, y, z).  Must be positive.
    sections : list of SectionPartitionInput
        The project's cross-sections with their validated 2-D partitions.

    Returns
    -------
    LabelGrid
        The labelled grid: regular axes ``gx`` / ``gy`` / ``gz``, the dense
        ``labels`` array (body index or ``-1``), and the body→formation lookup.

    Raises
    ------
    ValueError
        If ``grid_spacing_m`` is not positive, or no section carries any region
        (no elevation range to grid over).

    Notes
    -----
    The BEYOND rule (a voxel beyond all its nearest sections but inside the
    footprint) extends the nearest section's stack laterally — horizontal
    extrapolation within the hull, consistent with the
    litho-extrapolated-horizontally stance.  We deliberately do NOT reconstruct
    band/onlap/lens ramps (our ``RegionInput`` carries no ``kind``).
    """
    if grid_spacing_m <= 0.0:
        raise ValueError(f"grid_spacing_m must be positive; got {grid_spacing_m}")

    # --- horizontal extent: the domain's alpha-hull bounding box -----------
    ring = np.asarray(domain.polygon, dtype=float)
    xmin, ymin = float(ring[:, 0].min()), float(ring[:, 1].min())
    xmax, ymax = float(ring[:, 0].max()), float(ring[:, 1].max())

    # --- vertical extent: the global min/max region elevation --------------
    # The section partitions are the only carrier of elevation in the voxel
    # payload (columns hold world_x/y but no surface/base), so the z-range is
    # the min/max elevation over every region polygon point.
    zmin = math.inf
    zmax = -math.inf
    for s in sections:
        for r in s.regions:
            for _frac, elev in r.polygon:
                if elev < zmin:
                    zmin = elev
                if elev > zmax:
                    zmax = elev
    if not math.isfinite(zmin) or not math.isfinite(zmax) or zmax - zmin <= _EPS:
        raise ValueError("label_voxels: no section regions carry an elevation range to grid over")

    h = grid_spacing_m
    # ``+ h/2`` so the closed interval is fully covered even when the span is an
    # exact multiple of h (numpy ``arange`` is half-open).
    gx = np.arange(xmin, xmax + h / 2.0, h)
    gy = np.arange(ymin, ymax + h / 2.0, h)
    gz = np.arange(zmin, zmax + h / 2.0, h)
    nx, ny, nz = len(gx), len(gy), len(gz)

    labels = np.full((nx, ny, nz), -1, dtype=np.int32)

    # Deterministic body ordering: collect every body_id that appears, sorted.
    body_index: dict[str, int] = {}
    formation_by_body: dict[str, str] = {}

    # Pre-place all body ids (sorted) so the index map is deterministic
    # regardless of which voxel is labelled first.
    seen: set[str] = set()
    for s in sections:
        for r in s.regions:
            if r.body_id is not None and r.body_id not in seen:
                seen.add(r.body_id)
                formation_by_body[r.body_id] = r.formation_id
    for bid in sorted(seen):
        body_index[bid] = len(body_index)

    # ``None``-body regions (never-correlated minorities) get a stable synthetic
    # body id keyed by formation so they still mesh; created lazily but ordered
    # after the real bodies (their index assignment is deterministic because we
    # sort the formation key).
    none_body_ids: dict[str, str] = {}  # formation_id → synthetic body_id
    for s in sections:
        for r in s.regions:
            if r.body_id is None and r.formation_id not in none_body_ids:
                synth = f"__none__:{r.formation_id}"
                none_body_ids[r.formation_id] = synth
                formation_by_body[synth] = r.formation_id
    for formation in sorted(none_body_ids):
        synth = none_body_ids[formation]
        if synth not in body_index:
            body_index[synth] = len(body_index)

    # --- label every voxel column -----------------------------------------
    # The stack is a gap-free partition ordered shallow → deep, so its entries'
    # contiguous ``[base, top]`` intervals share boundary elevations.  A voxel
    # at elevation ``z`` belongs to the entry whose interval contains it.  We
    # find that entry with one ``np.searchsorted`` over the ascending boundary
    # edges (deep → shallow) — O(nz log m) per column, m = stack height.  The
    # half-open convention assigns a shared contact elevation to the SHALLOWER
    # body (the upper entry's base == the lower entry's top → the upper wins),
    # except the global base, which the lowest entry owns (closed bottom).
    for i in range(nx):
        x = float(gx[i])
        for j in range(ny):
            y = float(gy[j])
            if not domain.contains(x, y):
                continue  # outside the footprint → void
            stack = _stack_at(sections, x, y)
            if not stack:
                continue
            # Boundary edges ascending: [deepest base, ..., shallowest top].
            edges = np.empty(len(stack) + 1, dtype=float)
            edges[0] = stack[-1].base_elev
            for k, e in enumerate(stack):
                edges[len(stack) - k] = e.top_elev
            # Body index per interval, deep → shallow (matches ``edges`` gaps).
            interval_idx = np.array(
                [
                    body_index[
                        e.body_id if e.body_id is not None else none_body_ids[e.formation_id]
                    ]
                    for e in reversed(stack)
                ],
                dtype=np.int32,
            )
            # ``searchsorted(side='right')`` maps z → its interval slot in
            # ``edges``; slot 0 (z below the column) and slot len(edges) (z
            # above the column) are void.  Clamp z onto the closed top/base so
            # voxels exactly on the envelope boundary still land in-range.
            slot = np.searchsorted(edges, gz, side="right")
            inside = (slot >= 1) & (slot <= len(stack)) & (gz <= edges[-1] + _EPS)
            sel = slot[inside] - 1
            col = np.full(nz, -1, dtype=np.int32)
            col[inside] = interval_idx[sel]
            labels[i, j, :] = col

    body_id_by_index: tuple[str, ...] = tuple(
        bid for bid, _ in sorted(body_index.items(), key=lambda kv: kv[1])
    )

    return LabelGrid(
        gx=gx,
        gy=gy,
        gz=gz,
        labels=labels,
        body_id_by_index=body_id_by_index,
        formation_by_body=formation_by_body,
    )
