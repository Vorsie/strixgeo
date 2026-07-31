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
* ``_section_stack_at`` — adapted to take the gap + fraction from
  :func:`_project_to_section_fence` (projection onto the columns'
  ``world_x`` / ``world_y`` fence), not a bisect over ``along_m``, and to
  read ``RegionInput.gap_index`` / ``.polygon``.
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
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

import numpy as np

from groundmodel.domain.services.model_domain import ModelDomain
from groundmodel.domain.services.surface_bound import SurfaceBound
from groundmodel.domain.services.voxel_litho.geo_bands import (
    band_extent_from_elevs,
    band_of_from_elevs,
    section_reaches_band_from_elevs,
)
from groundmodel.domain.services.voxel_litho.honor_precedence import honor_rank
from groundmodel.domain.services.voxel_litho.pinch_terminations import (
    Termination,
    body_terminations,
    pinch_factor,
)
from groundmodel.domain.services.voxel_litho.voxel_types import (
    InvestigationColumn,
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

_CONTIGUOUS_EPS: float = 1e-6
"""How close two slices of one body must be to count as touching, in metres.

Measured on the real partitions the gap is exactly zero — a slice's base IS the next
slice's top — so this is a float-noise guard, not a tunable.  Widening it would start
joining intervals across genuinely thin layers of another body, which is the #228
sliver problem and must be fixed there rather than absorbed here.
"""


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
    kind : {'quad', 'pinch', 'lens'} or None
        What the 2-D engine says the body is doing AT THIS POSITION — ``'quad'``
        tied across the gap, ``'pinch'`` lapping one side, ``'lens'`` tied
        neither side.  Per position, never per body: a body that onlaps at one
        end and bands to the section end is an onlap only where it onlaps
        (owner correction 2026-07-31).  ``None`` on a payload written before
        debt #256, where the classification never crossed the API boundary.
    overlay_tier : {'onlap', 'lens'} or None
        The region's carve tier, where the 2-D engine set one.
    """

    body_id: str | None
    formation_id: str
    top_elev: float
    base_elev: float
    kind: Literal["quad", "pinch", "lens"] | None = None
    overlay_tier: Literal["onlap", "lens"] | None = None


@dataclass(frozen=True)
class _SectionProjection:
    """One section's BAND-INVARIANT projection + full stack at a column ``(x, y)``.

    The projection of ``(x, y)`` onto a section's column-world fence and the full
    (un-clipped) section stack at that foot do NOT depend on the geological band —
    they are the same for every band the column spans.  :func:`_column_stack_geo`
    computes one of these per section ONCE per column and threads the list into
    :func:`_stack_at_band` for every band, so the per-band loop never re-projects
    or re-slices a section (the secondary hot path the profiler flagged).

    Parameters
    ----------
    perp : float
        Perpendicular distance of ``(x, y)`` to the section's nearest gap segment
        (the 2-nearest-section blend weight).
    foot_x, foot_y : float
        The projected foot point on that gap segment (the between/beyond test).
    full_stack : list of _Entry
        The section's full un-clipped vertical stack at the foot, shallow → deep.
    reach_stack : tuple of (str, str, float, float)
        ``full_stack`` flattened to the ``section_reaches_band`` interval tuple
        (``body_id or ""``, formation_id, top_elev, base_elev) — precomputed so
        the per-band reach test does not rebuild it.
    """

    perp: float
    foot_x: float
    foot_y: float
    full_stack: list[_Entry]
    reach_stack: tuple[tuple[str, str, float, float], ...]


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
        # Exact bounding-box prune.  The true distance to a segment is never less
        # than the distance to its bounding box, so a segment whose box is already
        # farther than the best found cannot win — skipping it cannot change the
        # result.  This loop runs once per section per in-footprint voxel column
        # (2.6 M segment projections on the real model, docs/debt.md #245).
        ax, bx = a.world_x, b.world_x
        ay, by = a.world_y, b.world_y
        if ax > bx:
            ax, bx = bx, ax
        if ay > by:
            ay, by = by, ay
        gap_x = ax - x if x < ax else (x - bx if x > bx else 0.0)
        gap_y = ay - y if y < ay else (y - by if y > by else 0.0)
        if gap_x * gap_x + gap_y * gap_y >= best_dist * best_dist:
            continue
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
            # The region's own classification rides along, so the blend can ask what
            # the body does HERE rather than what kind of body it is.
            raw.append(_Entry(r.body_id, r.formation_id, top_e, base_e, r.kind, r.overlay_tier))
    raw.sort(key=lambda e: -e.top_elev)
    return _merge_contiguous(raw)


def _merge_contiguous(entries: list[_Entry]) -> list[_Entry]:
    """Join touching slices of the same body into the one interval they are (#257).

    The 2-D engine may cut a single interval into several polygons — five on one
    section where the other has one, each touching the next base-to-top.  Left as
    separate entries they reach ``_pair_occurrences``, which matches one-to-one and
    leaves the surplus unpaired; ``_blend_stacks`` then sends the surplus down the
    ONE-SIDED branch and the midline factor annihilates it.  The body is on BOTH
    sections and is not one-sided: it was deleted for how the partition happened to be
    cut.  Because ``_layout`` stacks cumulatively downward, every deleted metre came
    off the bottom — 8.85 m of missing column at (88 082.3, 164 463.3), and 57.6 % of
    all deleted thickness model-wide.

    Only slices that TOUCH merge.  A body that genuinely comes back lower, with another
    body between, stays two intervals — that is a re-entrant body, not a cut one.

    ``None`` bodies are never merged: a never-correlated minority has no identity to
    share, and each is one-sided regardless, so merging them would change nothing here
    while quietly fusing two distinct minorities.

    Parameters
    ----------
    entries : list of _Entry
        One section's intervals at a point, ordered shallow → deep.

    Returns
    -------
    list of _Entry
        The same intervals with touching same-body runs joined.  A merged interval
        keeps the 2-D classification only when every slice agreed on it; where they
        disagree it carries ``None`` rather than picking one arbitrarily.
    """
    merged: list[_Entry] = []
    for entry in entries:
        prev = merged[-1] if merged else None
        if (
            prev is not None
            and prev.body_id is not None
            and prev.body_id == entry.body_id
            and abs(prev.base_elev - entry.top_elev) <= _CONTIGUOUS_EPS
        ):
            merged[-1] = _Entry(
                prev.body_id,
                prev.formation_id,
                prev.top_elev,
                entry.base_elev,
                prev.kind if prev.kind == entry.kind else None,
                prev.overlay_tier if prev.overlay_tier == entry.overlay_tier else None,
            )
            continue
        merged.append(entry)
    return merged


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


def _pair_occurrences(
    left: list[_Entry], right: list[_Entry]
) -> list[tuple[_Entry | None, _Entry | None]]:
    """Match a body's re-entrant occurrences across two sections, by elevation.

    A body can appear several times in one section's stack (a clay that occurs
    twice down the column).  Before their thicknesses can be interpolated, each
    occurrence on one section has to be matched to the occurrence on the other
    that it actually corresponds to.

    This used to be done by ARRAY RANK — ``left[k]`` with ``right[k]`` after
    sorting by elevation.  Rank is an artifact of sort order, not evidence: where
    the two sections carry different NUMBERS of occurrences the ranks shift, and
    a shallow occurrence gets paired with a deep one.  Measured 2 m from
    ``GEO-23/125-S12``: the tie's two clays sit at mid 7.25 and 4.73, CS1 has one
    at mid 4.64, and rank paired the 7.25 with the 4.64 — 2.6 m apart — while the
    4.73 sat 0.1 m away (docs/debt.md #248).

    Pairing is therefore by CLOSEST mid-elevation, greedily: the globally nearest
    pair is taken first, then the next nearest among what is left, and so on.
    Whatever is left over on either side is returned unpaired, so the caller
    pinches it exactly as it already pinches a body present on one section only —
    an occurrence with no counterpart is a lens, and inventing a partner for it is
    the thing this function exists to stop.

    Parameters
    ----------
    left, right : list of _Entry
        One body's occurrences on each section, in any order.

    Returns
    -------
    list of (``_Entry`` or None, ``_Entry`` or None)
        One tuple per occurrence across both sides: matched pairs first (nearest
        first), then the unmatched remainder.  Every input entry appears exactly
        once, so the laid-out stack still tiles.
    """
    candidates = sorted(
        ((abs(_mid(a) - _mid(b)), i, j) for i, a in enumerate(left) for j, b in enumerate(right)),
        # Distance first; the index tie-break keeps the result deterministic when
        # two candidates are equidistant.
        key=lambda c: (c[0], c[1], c[2]),
    )
    used_left: set[int] = set()
    used_right: set[int] = set()
    pairs: list[tuple[_Entry | None, _Entry | None]] = []
    for _distance, i, j in candidates:
        if i in used_left or j in used_right:
            continue
        used_left.add(i)
        used_right.add(j)
        pairs.append((left[i], right[j]))
    pairs.extend((e, None) for i, e in enumerate(left) if i not in used_left)
    pairs.extend((None, e) for j, e in enumerate(right) if j not in used_right)
    return pairs


def _blend_stacks(
    stack1: list[_Entry],
    stack2: list[_Entry],
    w1: float,
    *,
    pinch1: dict[str, float] | None = None,
    pinch2: dict[str, float] | None = None,
) -> list[_Entry]:
    """Blend two section stacks at inverse-distance weight ``w1`` (for stack 1).

    Bodies present on BOTH stacks (matched by ``body_id``, re-entrant
    occurrences paired by elevation rank) blend their thickness by ``w1``.  A
    body present on only one stack pinches.

    How far it pinches depends on what is known about it.  Given a factor in
    ``pinch1`` / ``pinch2`` — the body thinned toward where the 2-D partition
    MEASURES it to end (see ``pinch_terminations.pinch_factor``) — that factor is
    used.  Without one the old assumption stands: ``max(0, 2*w_own - 1)``, full at
    its own section and zero at the equidistance midline.  The substitution is per
    body, so one measured body never re-rules its neighbours, and a body measured to
    die nowhere is never pinched on a guess.

    ``None`` bodies (never-correlated minorities) are always one-sided — no
    cross-section identity to match on, and no measured end either.  The result is
    laid out cumulatively so it tiles.

    Parameters
    ----------
    stack1, stack2 : list of _Entry
        The two sections' stacks (shallow → deep).
    w1 : float
        Inverse-distance weight for ``stack1`` (``w2 = 1 - w1``).
    pinch1, pinch2 : dict of str to float, optional
        Per-body survival factors in ``[0, 1]`` for one-sided bodies of stack 1 and
        stack 2 respectively.  A body absent from the mapping keeps the midline rule.

    Returns
    -------
    list of _Entry
        The blended, gap-free stack.
    """
    w2 = 1.0 - w1
    midline1, midline2 = max(0.0, 2 * w1 - 1), max(0.0, 2 * w2 - 1)

    def factor1(body: str | None) -> float:
        """Survival factor for a one-sided body of stack 1."""
        if pinch1 is None or body is None:
            return midline1
        return pinch1.get(body, midline1)

    def factor2(body: str | None) -> float:
        """Survival factor for a one-sided body of stack 2."""
        if pinch2 is None or body is None:
            return midline2
        return pinch2.get(body, midline2)

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
        # Occurrences are matched by NEAREST mid-elevation, not by rank — see
        # ``_pair_occurrences``.  Where the two sections carry different numbers
        # of occurrences, rank paired a shallow one with a deep one and averaged
        # their thicknesses into a position neither section has (#248).
        for e1, e2 in _pair_occurrences(g1[body], g2[body]):
            if e1 is not None and e2 is not None:
                th = w1 * _th(e1) + w2 * _th(e2)
                ref = w1 * _mid(e1) + w2 * _mid(e2)
                specs.append((ref, body, e1.formation_id, th))
            # SURPLUS of a body BOTH sections carry — blend it, do not pinch it (#257).
            # This body is not one-sided; only its internal subdivision differs, because
            # the 2-D engine cut it into a different NUMBER of polygons on each section.
            # The old midline factor annihilated the surplus, deleting material both
            # sections agree on and — since ``_layout`` stacks downward — taking every
            # deleted metre off the bottom of the column.
            #
            # Blending with ``w`` is exactly right, not merely safer: pairing gives
            # ``w1*a1 + w2*b1`` and the surplus ``w1*a2``, which sum to
            # ``w1*(a1+a2) + w2*b1`` — the interpolation of the two sections' own totals.
            elif e1 is not None:
                specs.append((_mid(e1), body, e1.formation_id, _th(e1) * w1))
            elif e2 is not None:
                specs.append((_mid(e2), body, e2.formation_id, _th(e2) * w2))

    # One-sided: non-matched non-None bodies, and every None-body entry.
    for e in stack1:
        if e.body_id is None or e.body_id not in matched:
            specs.append((_mid(e), e.body_id, e.formation_id, _th(e) * factor1(e.body_id)))
    for e in stack2:
        if e.body_id is None or e.body_id not in matched:
            specs.append((_mid(e), e.body_id, e.formation_id, _th(e) * factor2(e.body_id)))

    # Order shallow → deep by reference elevation; the body-id tie-break is only
    # for determinism on exact elevation ties (None bodies sort as "None" — each
    # stays its own spec, they never merge).
    specs.sort(key=lambda s: (-s[0], str(s[1])))
    return _layout(specs, _blended_top(stack1, stack2, w1))


# ---------------------------------------------------------------------------
# The per-column stack (LoftField.stack_at, ported)
# ---------------------------------------------------------------------------


def _measured_pinches(
    own: list[_Entry],
    other: list[_Entry],
    query: tuple[float, float],
    distance_to_section: float,
    terminations: dict[str, tuple[Termination, ...]] | None,
    own_section_index: int,
) -> dict[str, float] | None:
    """Survival factors for the bodies ``own`` carries and ``other`` does not.

    Only one-sided bodies pinch, so only they need a factor. A body the partition
    measures to die nowhere is left out, and keeps the midline rule rather than being
    pinched on a guess.

    Parameters
    ----------
    own : list of _Entry
        The stack whose one-sided bodies are being measured.
    other : list of _Entry
        The facing stack, which decides what counts as one-sided.
    query : tuple of float
        World ``(x, y)`` of the point being labelled.
    distance_to_section : float
        Distance from ``query`` to the section ``own`` came from, in metres.
    terminations : dict or None
        Every body's measured pinch-outs, or ``None`` to keep the old rule
        throughout.
    own_section_index : int
        Index of the section ``own`` came from. Its own apexes measure the body's
        extent ALONG it, not away from it, so they are excluded.

    Returns
    -------
    dict of str to float or None
        Per-body factors, or ``None`` when there is nothing measured to apply.
    """
    if not terminations:
        return None
    theirs = {e.body_id for e in other if e.body_id is not None}
    out: dict[str, float] = {}
    for entry in own:
        body = entry.body_id
        if body is None or body in theirs or body in out:
            continue
        factor = pinch_factor(
            query,
            distance_to_section,
            terminations.get(body, ()),
            own_section_index=own_section_index,
        )
        if factor is not None:
            out[body] = factor
    return out or None


def _stack_at(
    sections: list[SectionPartitionInput],
    x: float,
    y: float,
    terminations: dict[str, tuple[Termination, ...]] | None = None,
) -> list[_Entry]:
    """Return the vertical body stack at map-plane point ``(x, y)``.

    Picks the two nearest sections by perpendicular distance; blends them when
    the node lies BETWEEN them (its projection onto the axis joining the two
    projection points has ``t in [0, 1]``), else extrudes the nearest section
    alone (the BEYOND rule = horizontal extrapolation of the nearest section's
    stack).

    A body on one stack and not the other pinches. With ``terminations`` it thins
    toward where the 2-D partition MEASURES it to end; without them it falls back
    to the equidistance midline the builder used to assume (#256).

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
    # The index rides along: a body's apexes on its OWN section measure its extent
    # along that section, not away from it, so the factor must know which that is.
    projs = [(i, s, *_project_to_section_fence(s, x, y)) for i, s in enumerate(sections)]
    projs.sort(key=lambda p: p[4])  # by perpendicular distance
    i1, s1, gap1, frac1, d1, px1, py1 = projs[0]

    between = False
    if len(projs) >= 2:
        # Blend only when the node lies BETWEEN the two sections — its
        # projection onto the axis joining the two foot points has t in [0, 1].
        # For near-parallel sections this axis is the true interpolation
        # direction; for crossing sections it errs toward blending, which is
        # geologically reasonable in the crossing zone.
        _i2, _s2, _g2, _f2, _d2, px2, py2 = projs[1]
        dx, dy = px2 - px1, py2 - py1
        axis2 = dx * dx + dy * dy
        t = 0.0 if axis2 < _EPS else ((x - px1) * dx + (y - py1) * dy) / axis2
        between = -_EPS <= t <= 1.0 + _EPS

    if between:
        i2, s2, gap2, frac2, d2, _px2, _py2 = projs[1]
        stack1 = _section_stack_at(s1, gap1, frac1)
        stack2 = _section_stack_at(s2, gap2, frac2)
        # An EMPTY stack is no information, not an interpretation of "no material
        # here".  It happens routinely: the projection clamps to a section's end
        # column, or lands in a gap the partition never filled.  Blending against
        # it made every body in the informed column one-sided, so each was pinched
        # by ``max(0, 2w - 1)`` and — because ``_layout`` re-stacks cumulatively
        # downward — the shortfall accumulated into the depths.  On the dev model
        # that lifted a clay tied top AND base from -6.481/-7.610 to
        # -4.086/-5.072, and the owner correctly reported the bottom clay as
        # missing from the 3-D model.  Defer to the section that does know.
        if not stack2:
            return stack1
        if not stack1:
            return stack2
        denom = d1 + d2
        w1 = 0.5 if denom < _EPS else d2 / denom
        here = (x, y)
        return _blend_stacks(
            stack1,
            stack2,
            w1,
            pinch1=_measured_pinches(stack1, stack2, here, d1, terminations, i1),
            pinch2=_measured_pinches(stack2, stack1, here, d2, terminations, i2),
        )

    # Beyond rule: horizontal extrapolation of the nearest section's stack
    # (no kind to ramp; extend it faithfully within the domain footprint).
    return _section_stack_at(s1, gap1, frac1)


# ---------------------------------------------------------------------------
# Geological-band-scoped stack assembly (Task 3 — the band-aware path)
# ---------------------------------------------------------------------------


def _clip_stack_to_band(
    stack: list[_Entry],
    band_base: float | None,
    band_top: float | None,
    snap_tol: float,
    snap_edges: bool = False,
) -> list[_Entry]:
    """Clip a section stack to a geological band's ``(base, top)`` extent.

    A litho is confined to its geological band by the **snap-or-divide** rule
    (the same rule ``litho_geo_bounding.divide_picks_by_geology`` applies to
    picks): a band surface is a genuine **cut** of an entry only when it crosses the
    entry's span STRICTLY INSIDE it AND is farther than ``snap_tol`` from BOTH
    the entry's top and base.  When a band surface is a cut, the entry is
    DIVIDED at it and only the part inside this band survives.  When a band
    surface is within ``snap_tol`` of an entry's top or base (or does not cross
    the span at all), it **snaps** — the entry stays WHOLE and is kept iff its
    MID-elevation lands in this band.  This is the key fix over a naive clip: a
    thin entry that straddles a band edge but is too thin to be cut (within
    ``snap_tol`` of the edge on both sides) is NOT collapsed to zero — it is kept
    whole in its mid-elevation's band (a near-coincident litho contact reads as
    coincident with the band boundary, no sliver, no vanished layer).
    ``None`` band bounds are open (treated as ±∞) and never cut.

    Parameters
    ----------
    stack : list of _Entry
        The (already-blended) section stack, shallow → deep.
    band_base : float or None
        The band's base elevation (the geological surface below it), or ``None``
        when the band is open below (the deepest band).
    band_top : float or None
        The band's top elevation (the geological surface above it), or ``None``
        when the band is open above (the shallowest band).
    snap_tol : float
        A litho contact within this distance of a band surface snaps to it.
    snap_edges : bool, default False
        When True, the band's OUTERMOST contacts (the shallowest entry's top, the
        deepest entry's base) snap to the band surfaces if within ``snap_tol`` —
        closing a sub-tolerance void between the band's extreme litho and the
        geological surface.  Applied ONLY on the FINAL assembled band stack (not
        the per-section clips that feed the blend), so the blend thicknesses stay
        faithful while the final band fills cleanly to its surfaces.

    Returns
    -------
    list of _Entry
        The entries' in-band segments, shallow → deep; entries whose segment is
        thinner than ``_EPS`` or whose mid falls outside the band are dropped.
    """
    out: list[_Entry] = []
    for e in stack:
        top = e.top_elev
        base = e.base_elev
        # A band edge CUTS the entry only when it lies strictly inside the span,
        # farther than snap_tol from BOTH ends (the geo_blocks cut rule).  A cut
        # trims the entry to the band side; a non-cut edge leaves the entry whole.
        seg_top = top
        seg_base = base
        if band_top is not None and base + snap_tol < band_top < top - snap_tol:
            seg_top = band_top  # the surface above this band cuts → trim the top
        if band_base is not None and base + snap_tol < band_base < top - snap_tol:
            seg_base = band_base  # the surface below this band cuts → trim the base
        if seg_top - seg_base <= _EPS:
            continue
        # Keep the segment iff its MID lands in this band.  For a whole (un-cut)
        # entry this assigns it to exactly one band by its mid-elevation (a thin
        # straddling entry goes to the band its centre is in — never collapsed).
        # For a cut entry the trimmed segment's mid is unambiguously inside the
        # band, so the test always passes.
        mid = 0.5 * (seg_top + seg_base)
        below_top = band_top is None or mid < band_top + _EPS
        above_base = band_base is None or mid > band_base - _EPS
        if below_top and above_base:
            out.append(_Entry(e.body_id, e.formation_id, seg_top, seg_base))
    if not out or not snap_edges:
        return out
    # Snap the band's EXTREME contacts to the band surfaces when within tolerance,
    # closing a sub-tolerance void between the band's shallowest/deepest litho and
    # the geological surface (a near-coincident litho↔geology contact reads as
    # coincident — the litho fills the band to the surface).  Only the OUTERMOST
    # contacts snap, so an interior thin layer is never collapsed.
    # NB: an un-cut entry whose far end pokes <= snap_tol INTO the adjacent band is
    # intentionally left untrimmed here (the cut rule above only trims edges strictly
    # interior to the span).  The gap-aware labeller (``_column_labels_gapped``,
    # shallower-wins) resolves the resulting <=1-voxel overlap, so do NOT "fix" this
    # into a hard trim — that would open a gap instead of letting the overlap absorb.
    out.sort(key=lambda e: -e.top_elev)  # shallow → deep
    if band_top is not None and 0.0 < band_top - out[0].top_elev <= snap_tol:
        out[0] = _Entry(out[0].body_id, out[0].formation_id, band_top, out[0].base_elev)
    if band_base is not None and 0.0 < out[-1].base_elev - band_base <= snap_tol:
        out[-1] = _Entry(out[-1].body_id, out[-1].formation_id, out[-1].top_elev, band_base)
    return out


def _fill_band_voids(
    blended: list[_Entry],
    fallbacks: list[list[_Entry]],
    band_base: float | None,
    band_top: float | None,
) -> list[_Entry]:
    """Fill the voids of ``blended`` (within the band) from the reaching sections.

    The midline pinch can empty parts of a band that the contributing sections
    actually fill (their litho is the same formation but uncorrelated, so it
    matches as one-sided and pinches), and the two nearest sections can each
    pinch in DIFFERENT parts of the band.  This back-fills every void the blend
    left, walking the reaching sections' clipped stacks in NEAREST-FIRST order:
    each section fills whatever void still remains, so a band that ANY reaching
    section fills (even the 3rd-nearest, when the two nearest both pinch there) is
    never left whole-void — horizontal extrapolation of the nearest section that
    reaches that depth into the gap.  The ``blended`` entries WIN wherever they
    exist (the pinch geometry is kept); only genuine voids are filled, and a
    nearer section's fill wins over a farther one's in the same gap.

    Parameters
    ----------
    blended : list of _Entry
        The midline-blended band stack (may have pinch-induced voids).
    fallbacks : list of list of _Entry
        The reaching sections' clipped band stacks, NEAREST-FIRST (the void
        fillers, applied in order so the nearest wins each gap).
    band_base, band_top : float or None
        The band's extent (``None`` = open); the fill is confined to it.

    Returns
    -------
    list of _Entry
        The blended stack with its in-band voids back-filled, shallow → deep.
    """
    lo = -math.inf if band_base is None else band_base
    hi = math.inf if band_top is None else band_top
    out: list[_Entry] = list(blended)
    for fallback in fallbacks:
        for f in fallback:
            # Clip the fallback entry to the band, then subtract everything ALREADY
            # placed (blend + earlier/nearer fills) so only the still-void parts
            # remain — a nearer section's fill therefore wins each gap.
            seg_base = max(f.base_elev, lo)
            seg_top = min(f.top_elev, hi)
            gaps: list[tuple[float, float]] = (
                [(seg_base, seg_top)] if seg_top - seg_base > _EPS else []
            )
            covered = sorted(((e.base_elev, e.top_elev) for e in out), key=lambda iv: iv[0])
            for cb, ct in covered:
                new_gaps: list[tuple[float, float]] = []
                for gb, gt in gaps:
                    # Subtract [cb, ct] from [gb, gt].
                    if ct <= gb + _EPS or cb >= gt - _EPS:
                        new_gaps.append((gb, gt))  # no overlap
                        continue
                    if gb < cb - _EPS:
                        new_gaps.append((gb, cb))  # piece below the covered span
                    if gt > ct + _EPS:
                        new_gaps.append((ct, gt))  # piece above the covered span
                gaps = new_gaps
            for gb, gt in gaps:
                if gt - gb > _EPS:
                    out.append(_Entry(f.body_id, f.formation_id, gt, gb))
    out.sort(key=lambda e: -e.top_elev)
    return out


def _stack_at_band(
    projections: list[_SectionProjection],
    x: float,
    y: float,
    band: int,
    surf_elevs: tuple[float, ...],
    snap_tol: float,
) -> list[_Entry]:
    """Return the band-clipped blended stack at ``(x, y)`` for one geological band.

    The band analogue of :func:`_stack_at`: for each section's PRECOMPUTED
    column projection it clips the section's stack to the band's extent
    (snap-or-divide), drops sections whose clipped stack does NOT reach the band
    (the shallow section that stops above it — its next-nearest REACHING
    neighbour fills the band instead, the sideways fill), and blends the two
    nearest REACHING sections with the SAME between/beyond midline-pinch rule as
    :func:`_stack_at`.

    The section projection + full stack + reach-stack are BAND-INVARIANT, so the
    caller (:func:`_column_stack_geo`) computes them once per column and passes
    them in; this function only does the per-band band-extent + reach-filter +
    clip + blend + void-fill.  The geological surface elevations at ``(x, y)``
    are likewise precomputed (``surf_elevs``) so the band extent + reach test
    never re-scan a TIN.

    Parameters
    ----------
    projections : list of _SectionProjection
        The per-section precomputed projection + full stack at this column.
    x, y : float
        The map-plane query point (the between/beyond geometry still uses them).
    band : int
        The geological band index to fill (0 = shallowest).
    surf_elevs : tuple of float
        The geological surfaces' elevations at ``(x, y)`` (precomputed once per
        column; sorted internally by the ``_from_elevs`` band helpers).
    snap_tol : float
        The snap-or-divide tolerance.

    Returns
    -------
    list of _Entry
        The band-clipped blended stack, shallow → deep; ``[]`` when no section
        reaches the band here (the band is void at this column).
    """
    if not projections:
        return []

    band_base, band_top = band_extent_from_elevs(surf_elevs, band)

    # Clip + reach-filter: keep only sections whose clipped stack actually
    # overlaps the band (a shallow section that stops above the band is dropped,
    # so the next-nearest reaching section fills it — the sideways fill).  The
    # projection + full stack + reach-stack are precomputed (band-invariant).
    reaching: list[tuple[float, float, float, list[_Entry]]] = []  # (perp, foot_x, foot_y, clipped)
    for proj in projections:
        # Reach test on the UN-clipped stack (does the section's litho overlap
        # the band at all here?) — the canonical geo_bands predicate.
        if not section_reaches_band_from_elevs(proj.reach_stack, surf_elevs, band):
            continue
        clipped = _clip_stack_to_band(proj.full_stack, band_base, band_top, snap_tol)
        if clipped:
            reaching.append((proj.perp, proj.foot_x, proj.foot_y, clipped))

    if not reaching:
        return []

    # By perpendicular distance; exact-distance ties resolve by section input order
    # (stable sort) → deterministic, matching the ported ``_stack_at`` behaviour.
    reaching.sort(key=lambda r: r[0])
    perp1, px1, py1, clipped1 = reaching[0]

    between = False
    if len(reaching) >= 2:
        # Same BETWEEN test as ``_stack_at``: the node lies between the two
        # nearest reaching sections when its projection onto the axis joining the
        # two foot points has t in [0, 1].
        _p2, px2, py2, _c2 = reaching[1]
        dx, dy = px2 - px1, py2 - py1
        axis2 = dx * dx + dy * dy
        t = 0.0 if axis2 < _EPS else ((x - px1) * dx + (y - py1) * dy) / axis2
        between = -_EPS <= t <= 1.0 + _EPS

    if between:
        perp2, _px2, _py2, clipped2 = reaching[1]
        denom = perp1 + perp2
        w1 = 0.5 if denom < _EPS else perp2 / denom
        blended = _blend_stacks(clipped1, clipped2, w1)
        # The midline pinch matches bodies by ``body_id``: two sections that BOTH
        # fill the band but with DIFFERENT (uncorrelated) bodies are each treated
        # as one-sided and pinch toward zero at the midline — which can empty a
        # whole band even though sections carry litho there.  Fill any void the
        # pinch left from the reaching sections' clipped stacks (nearest-first
        # horizontal extrapolation into the gap), so a band any section reaches is
        # never left whole-void.
        fallbacks = [r[3] for r in reaching]
        blended = _fill_band_voids(blended, fallbacks, band_base, band_top)
        # Re-clip so the band invariant holds exactly + snap the extreme contacts
        # to the band surfaces (the FINAL band stack).
        return _clip_stack_to_band(blended, band_base, band_top, snap_tol, snap_edges=True)

    # Beyond rule: horizontal extrapolation of the nearest reaching section, then
    # fill any band void it leaves from the farther reaching sections (so a band
    # a farther section fills is not left whole-void at a beyond-all-sections
    # node).  Snap the extreme contacts to the band surfaces (the FINAL stack).
    beyond = _fill_band_voids(list(clipped1), [r[3] for r in reaching[1:]], band_base, band_top)
    return _clip_stack_to_band(beyond, band_base, band_top, snap_tol, snap_edges=True)


def _column_stack_geo(
    sections: list[SectionPartitionInput],
    x: float,
    y: float,
    gz_min: float,
    gz_max: float,
    geo_surfaces: tuple[SurfaceBound, ...],
    snap_tol: float,
) -> list[_Entry]:
    """Assemble one gap-free band-scoped column stack at ``(x, y)``.

    The geological surfaces at ``(x, y)`` split the column's ``[gz_min, gz_max]``
    elevation range into the bands it spans; each band is filled independently by
    :func:`_stack_at_band` (so the band's lithology comes from the nearest
    section that REACHES it — the sideways fill below a shallow test), and the
    per-band stacks are concatenated shallow → deep into one stack.  Because each
    band's clip snaps to the shared geological surface, adjacent bands abut
    exactly, so the concatenation is a gap-free partition — exactly what
    :func:`_column_labels` consumes.

    Parameters
    ----------
    sections : list of SectionPartitionInput
        The project's cross-sections.
    x, y : float
        The map-plane query point.
    gz_min, gz_max : float
        The grid's global elevation range (the column's vertical extent).
    geo_surfaces : tuple of SurfaceBound
        The geological band surfaces.
    snap_tol : float
        The snap-or-divide tolerance.

    Returns
    -------
    list of _Entry
        The band-concatenated column stack, shallow → deep.
    """
    # Evaluate every geological surface at this column ONCE (4 TIN scans) instead
    # of re-scanning per band per section (~60-100x), and project each section
    # onto the column-world fence + slice its full stack ONCE (band-invariant).
    # The per-band loop then runs purely on the precomputed floats + stacks.
    surf_elevs = tuple(s.evaluate(x, y) for s in geo_surfaces)
    projections: list[_SectionProjection] = []
    for s in sections:
        gap, frac, perp, fx, fy = _project_to_section_fence(s, x, y)
        full = _section_stack_at(s, gap, frac)
        reach_stack = tuple(
            (e.body_id or "", e.formation_id, e.top_elev, e.base_elev) for e in full
        )
        projections.append(_SectionProjection(perp, fx, fy, full, reach_stack))

    # Which bands does this column's elevation range touch?  Band index is the
    # count of surfaces above a given z, so the band at the column TOP (gz_max)
    # is the shallowest band the column reaches and the band at the BOTTOM
    # (gz_min) is the deepest — every integer between is also spanned (bands are
    # contiguous in elevation).  Iterate shallow → deep (ascending band index).
    band_top_idx = band_of_from_elevs(surf_elevs, gz_max)
    band_bot_idx = band_of_from_elevs(surf_elevs, gz_min)
    column: list[_Entry] = []
    for band in range(band_top_idx, band_bot_idx + 1):
        column.extend(_stack_at_band(projections, x, y, band, surf_elevs, snap_tol))
    return column


# ---------------------------------------------------------------------------
# Per-column voxel labelling (shared by the blend path and the honored path)
# ---------------------------------------------------------------------------


def _honored_cells(
    gx: np.ndarray | list[float],
    gy: np.ndarray | list[float],
    world_x: float,
    world_y: float,
    radius_m: float,
) -> list[tuple[int, int]]:
    """Grid cells an investigation's own log should own, as ``(i, j)`` pairs.

    An investigation used to own exactly its NEAREST cell.  Two consequences the
    owner hit (docs/debt.md #249): a test sitting near a cell boundary is honored
    up to half a voxel from where it is, and which side it lands on depends on
    the grid phase — which moves whenever the footprint changes; and the column
    drawn on a section is wider than one voxel, so the cells beside the honored
    one show blended material instead of the log.

    Every cell whose CENTRE lies within ``radius_m`` of the investigation is
    therefore honored.  The nearest cell is always included, whatever the radius,
    so a small value can never leave a log unhonored altogether.

    Note the geometry: a radius of one horizontal spacing reaches the four
    orthogonal neighbours but NOT the diagonals, which sit ``sqrt(2)`` spacings
    away — so the footprint is a plus, not a 3x3 block.

    Parameters
    ----------
    gx, gy : numpy.ndarray or list of float
        The grid's X and Y coordinate axes.
    world_x, world_y : float
        The investigation's true map position.
    radius_m : float
        Honored radius in metres; ``0.0`` reproduces the nearest-cell-only
        behaviour exactly.

    Returns
    -------
    list of (int, int)
        Cell indices, sorted, so contention between two investigations resolves
        identically on every run.
    """
    ax = np.asarray(gx, dtype=float)
    ay = np.asarray(gy, dtype=float)
    ci = int(np.argmin(np.abs(ax - world_x)))
    cj = int(np.argmin(np.abs(ay - world_y)))
    cells = {(ci, cj)}
    if radius_m > 0.0:
        # Only the axis bands within the radius can contain a qualifying centre.
        xs = np.nonzero(np.abs(ax - world_x) <= radius_m)[0]
        ys = np.nonzero(np.abs(ay - world_y) <= radius_m)[0]
        r2 = radius_m * radius_m
        for i in xs:
            dx = ax[i] - world_x
            for j in ys:
                dy = ay[j] - world_y
                if dx * dx + dy * dy <= r2:
                    cells.add((int(i), int(j)))
    return sorted(cells)


def _column_labels(
    stack: list[_Entry],
    gz: np.ndarray,
    body_index: dict[str, int],
    none_body_ids: dict[str, str],
) -> np.ndarray:
    """Label one voxel column's ``gz`` axis from a gap-free shallow→deep stack.

    The stack is a gap-free partition ordered shallow → deep, so its entries'
    contiguous ``[base, top]`` intervals share boundary elevations.  A voxel at
    elevation ``z`` belongs to the entry whose interval contains it.  Found with
    one ``np.searchsorted`` over the ascending boundary edges (deep → shallow) —
    O(nz log m), ``m`` = stack height.  The half-open convention assigns a shared
    contact elevation to the SHALLOWER body (the upper entry's base == the lower
    entry's top → the upper wins).  The base is closed (the lowest entry owns a
    voxel exactly on the global base) and the top is open (a voxel exactly on the
    global top is void) — a benign measure-zero asymmetry on the grid.

    Parameters
    ----------
    stack : list of _Entry
        The vertical body intervals, shallow → deep (a gap-free partition).
        An empty stack yields an all-void column.
    gz : numpy.ndarray
        The Z (elevation) grid-node coordinates, ascending.
    body_index : dict of str to int
        Maps a body_id (real or ``__none__:`` synthetic) to its label index.
    none_body_ids : dict of str to str
        Maps a ``formation_id`` to the synthetic body_id used for its
        never-correlated (``None``-body) minorities.

    Returns
    -------
    numpy.ndarray
        Shape ``(len(gz),)`` ``int32`` array of body indices; ``-1`` for void.
    """
    nz = len(gz)
    col = np.full(nz, -1, dtype=np.int32)
    if not stack:
        return col
    # Boundary edges ascending: [deepest base, ..., shallowest top].
    edges = np.empty(len(stack) + 1, dtype=float)
    edges[0] = stack[-1].base_elev
    for k, e in enumerate(stack):
        edges[len(stack) - k] = e.top_elev
    # Body index per interval, deep → shallow (matches ``edges`` gaps).
    interval_idx = np.array(
        [
            body_index[e.body_id if e.body_id is not None else none_body_ids[e.formation_id]]
            for e in reversed(stack)
        ],
        dtype=np.int32,
    )
    # ``searchsorted(side='right')`` maps z → its interval slot in ``edges``;
    # slot 0 (z below the column) and slot len(edges) (z at or above the column
    # top) are void.  Any z that yields a valid slot is already below
    # ``edges[-1]`` (the open top), so no separate top clamp is needed — the
    # base is closed via slot >= 1, the top open via slot <= len(stack).
    slot = np.searchsorted(edges, gz, side="right")
    inside = (slot >= 1) & (slot <= len(stack))
    sel = slot[inside] - 1
    col[inside] = interval_idx[sel]
    return col


def _column_labels_gapped(
    stack: list[_Entry],
    gz: np.ndarray,
    body_index: dict[str, int],
    none_body_ids: dict[str, str],
) -> np.ndarray:
    """Label a voxel column from a stack that MAY contain gaps (the band path).

    Unlike :func:`_column_labels`, this does NOT assume a gap-free partition.
    The band-scoped column stack is the concatenation of independently filled
    geological bands, so a band whose litho pinches out before reaching its
    geological surface leaves a genuine VOID gap — and a deeper band's body must
    NOT bleed up into it (which the gap-free searchsorted would wrongly do).

    Each entry is point-located independently: a voxel ``z`` with
    ``base_elev <= z < top_elev`` takes that entry's body.  Entries are applied
    shallow → deep, and a voxel keeps the FIRST (shallowest) entry that claims it,
    so a shared contact elevation goes to the shallower body (matching
    :func:`_column_labels`' half-open convention).  Any voxel claimed by no entry
    stays void — the faithful representation of a pinched-out litho between two
    geological bands.

    Parameters
    ----------
    stack : list of _Entry
        The band-concatenated column intervals, shallow → deep; MAY have gaps.
        An empty stack yields an all-void column.
    gz : numpy.ndarray
        The Z (elevation) grid-node coordinates, ascending.
    body_index : dict of str to int
        Maps a body_id (real or ``__none__:`` synthetic) to its label index.
    none_body_ids : dict of str to str
        Maps a ``formation_id`` to the synthetic body_id used for its
        never-correlated (``None``-body) minorities.

    Returns
    -------
    numpy.ndarray
        Shape ``(len(gz),)`` ``int32`` array of body indices; ``-1`` for void.
    """
    nz = len(gz)
    col = np.full(nz, -1, dtype=np.int32)
    if not stack:
        return col
    # Apply deep → shallow so the SHALLOWER entry overwrites on a shared contact
    # (it is written last → it wins), reproducing ``_column_labels``' rule that a
    # voxel exactly on a contact belongs to the upper body.  A voxel inside a gap
    # is claimed by no entry and stays void.
    for e in reversed(stack):
        idx = body_index[e.body_id if e.body_id is not None else none_body_ids[e.formation_id]]
        # Half-open ``[base, top)`` so the top contact goes to the body above.
        covered = (gz >= e.base_elev - _EPS) & (gz < e.top_elev - _EPS)
        col[covered] = idx
    return col


def _honored_column_labels(
    blend_stack: list[_Entry],
    inv: InvestigationColumn,
    gz: np.ndarray,
    body_index: dict[str, int],
    none_body_ids: dict[str, str],
    fallback_labeller: Callable[
        [list[_Entry], np.ndarray, dict[str, int], dict[str, str]], np.ndarray
    ] = _column_labels,
) -> np.ndarray:
    """Label a voxel column honoring the investigation's OWN log over the blend.

    Within the investigation's observed elevation range
    ``[min base_elev, max top_elev]`` each voxel takes the body of the
    investigation's OWN interval covering its elevation (point-located in the
    log).  ABOVE the observed top or BELOW the observed base the voxel falls
    back to the section-blend label, so the column stays filled past the log
    (a shallow log punches no hole below it).

    Parameters
    ----------
    blend_stack : list of _Entry
        The section-blend stack at the investigation's true ``(x, y)`` — the
        fallback above / below the log.  For the geology-bounded path this is the
        BAND-SCOPED column stack (so the sideways fill applies below a shallow
        log's TD), passed alongside ``fallback_labeller=_column_labels_gapped``.
    inv : InvestigationColumn
        The investigation whose observed log overrides the blend.  Its
        ``intervals`` carry resolver body_ids already registered in
        ``body_index`` / ``none_body_ids``.
    gz : numpy.ndarray
        The Z (elevation) grid-node coordinates, ascending.
    body_index : dict of str to int
        Body_id → label index (includes the investigation's body_ids).
    none_body_ids : dict of str to str
        ``formation_id`` → synthetic body_id for ``None``-body minorities.
    fallback_labeller : callable, optional
        The labeller used for the above-log / below-log fallback fill.  Defaults
        to :func:`_column_labels` (the gap-free no-geo path, byte-identical to
        before this parameter existed); the band path passes
        :func:`_column_labels_gapped` so an inter-band void gap below the log is
        not bled over by a deeper band's body.

    Returns
    -------
    numpy.ndarray
        Shape ``(len(gz),)`` ``int32`` array of body indices; ``-1`` for void.
    """
    # Start from the blend so above-top / below-base voxels are already filled.
    col = fallback_labeller(blend_stack, gz, body_index, none_body_ids)
    if not inv.intervals:
        return col

    obs_top = max(top for _bid, _fid, top, _base in inv.intervals)
    obs_base = min(base for _bid, _fid, _top, base in inv.intervals)

    # A borehole defines its OWN ground surface — there is no material above its
    # logged top.  The litho picks start at the surface, so ``obs_top`` ≈ the
    # borehole's ground surface; when the interpolated section-blend surface at
    # this (x, y) sits ABOVE ``obs_top`` (a neighbour with a higher surface), the
    # fallback above filled the [obs_top, blend_top] band with that neighbour's
    # blend lithology — a geologically wrong above-surface sliver.  Void it: the
    # honored column's top becomes the borehole's own surface, not the blend's.
    # (If a log genuinely started below the ground surface this would leave that
    # gap to the blend — correct — but the litho picks start at the surface.)
    #
    # Void at and above ``obs_top`` (``gz > obs_top - _EPS``): the in-log override
    # below re-fills the observed voxels using the half-open ``[base, top)`` log
    # rule, which leaves the voxel exactly ON the top contact unclaimed (a contact
    # belongs to the body above) — that voxel is now the surface, so it stays void
    # rather than keeping a blend label.  The override fills the strictly-interior
    # voxels (``gz < obs_top - _EPS``), so it is disjoint from this void.
    col[gz > obs_top - _EPS] = -1
    # Within the observed range, override each voxel with its OWN log interval.
    # The log intervals need NOT be a contiguous partition: an unlogged interval
    # between two observed units (a body-unassigned / rejected layer that
    # ``load_body_picks`` drops) leaves a genuine vertical gap.  Label with the
    # gap-aware ``_column_labels_gapped`` so a gap voxel stays ``-1`` (it is
    # claimed by no observed interval) and the ``log_col >= 0`` guard in the
    # ``in_log`` mask leaves it to the blend — the unlogged depth defers to the
    # section fill instead of one bounding unit bridging across it.  For a
    # CONTIGUOUS log (the normal case) ``_column_labels_gapped`` is byte-
    # identical to ``_column_labels`` (same half-open ``[base, top)`` contact
    # rule), so the honor of an observed log is unchanged.
    log_stack = [_Entry(bid, fid, top, base) for bid, fid, top, base in inv.intervals]
    log_stack.sort(key=lambda e: -e.top_elev)
    log_col = _column_labels_gapped(log_stack, gz, body_index, none_body_ids)

    # Override only the voxels within the observed depth range that an observed
    # interval actually claims.  The window is ``[obs_base, obs_top]`` — the log
    # wins through ``obs_top`` inclusive (the ``+ _EPS`` is the grid-node guard
    # so a node sitting exactly on the observed top is honored, not a half-open
    # exclusion of it) and through ``obs_base`` inclusive (its ``- _EPS`` guard).
    # The ``log_col >= 0`` guard excludes any voxel inside an unlogged gap, so a
    # gap defers to the already-placed blend.
    in_log = (gz >= obs_base - _EPS) & (gz < obs_top + _EPS) & (log_col >= 0)
    col[in_log] = log_col[in_log]
    return col


# ---------------------------------------------------------------------------
# The grid labeller
# ---------------------------------------------------------------------------


def label_voxels(
    domain: ModelDomain,
    grid_spacing_m: float,
    sections: list[SectionPartitionInput],
    *,
    vertical_spacing_m: float | None = None,
    investigation_columns: tuple[InvestigationColumn, ...] = (),
    geo_surfaces: tuple[SurfaceBound, ...] = (),
    litho_snap_tolerance_m: float = 0.20,
    honor_radius_m: float = 0.0,
    measured_pinch: bool = False,
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
        The HORIZONTAL voxel edge length in metres (X and Y).  Also the Z edge
        length when ``vertical_spacing_m`` is ``None`` (the cubic case).  Must be
        positive.
    sections : list of SectionPartitionInput
        The project's cross-sections with their validated 2-D partitions.
    vertical_spacing_m : float or None, optional
        The Z (elevation) voxel edge length in metres.  ``None`` (the default) →
        the grid is cubic: Z uses ``grid_spacing_m``, byte-identical to the
        behaviour before this parameter existed.  When set, the grid is
        ANISOTROPIC: X/Y step at ``grid_spacing_m`` (the horizontal spacing) and
        Z steps at ``vertical_spacing_m``.  Geology is thin-layered vertically, so
        a fine Z over a coarse X/Y resolves thin layers without exploding the X/Y
        voxel count.  Must be positive when set.
    investigation_columns : tuple of InvestigationColumn, optional
        Per-investigation OWN observed pick stacks at their TRUE map
        locations.  At each investigation's nearest grid column the voxels
        within its observed depth range are labelled from its OWN log
        (overriding the between-section blend, which may disagree because the
        investigation feeds a section at its projected foot, not its true
        ``(x, y)``); above / below the log the blend still fills the column.
        Defaults to ``()`` — the pure section-blend path, byte-identical to the
        behaviour before this parameter existed.
    geo_surfaces : tuple of SurfaceBound, optional
        The parent geological model's built band surfaces.  When non-empty, the
        per-column stack is assembled band-by-band: each geological band is filled
        by the nearest section reaching it, clipped to the band's bounding surfaces
        with snap-or-divide, and the bands are concatenated into a gap-aware column
        stack.  A litho body never crosses a geological surface.  The default ``()``
        keeps labelling byte-identical to the un-bounded single-blend path.
    honor_radius_m : float, default 0.0
        Radius in metres around an investigation whose grid cells take its OWN
        log rather than the section blend.  ``0.0`` honors only the single
        nearest cell — the pre-#249 behaviour, under which a test near a cell
        boundary was honored up to half a voxel from where it is, and the column
        drawn on a section (wider than one voxel) showed blended material beside
        the honored cell.  The caller resolves the value; see
        ``BuildVoxelLithoModel``.
    litho_snap_tolerance_m : float, default 0.20
        The snap-or-divide tolerance for clipping a litho contact to a geological
        band surface (geology-bounded branch only).  A litho contact within this
        distance of a band surface snaps to it — the band's extreme litho fills
        clean to the surface; a contact farther than this divides the interval at
        the surface, so the litho is split across the two bands.  Ignored when
        ``geo_surfaces`` is empty.
    measured_pinch : bool, default False
        When ``True``, a one-sided body thins toward where the 2-D partition
        MEASURES it to end rather than toward the equidistance midline that
        ``max(0, 2w - 1)`` assumes (#256).  Off by default until an A/B on real
        data earns it: the first attempt pinned every factor at exactly 0.5, so
        nothing tapered to nothing anywhere.

    Returns
    -------
    LabelGrid
        The labelled grid: regular axes ``gx`` / ``gy`` / ``gz``, the dense
        ``labels`` array (body index or ``-1``), and the body→formation lookup.

    Raises
    ------
    ValueError
        If ``grid_spacing_m`` (or ``vertical_spacing_m`` when set) is not
        positive, or no section carries any region (no elevation range to grid
        over).

    Notes
    -----
    The BEYOND rule (a voxel beyond all its nearest sections but inside the
    footprint) extends the nearest section's stack laterally — horizontal
    extrapolation within the hull, consistent with the
    litho-extrapolated-horizontally stance.  We deliberately do NOT reconstruct
    band/onlap/lens ramps (our ``RegionInput`` carries no ``kind``).

    Honor-borehole: when two investigations map to the SAME grid column (sub-
    voxel neighbours at the chosen spacing) only ONE of them can be honored, and
    it is chosen by
    :func:`~groundmodel.domain.services.voxel_litho.honor_precedence.honor_rank`
    — a CPT over a borehole, then the one that reached deeper, then the lower id.
    Each honored
    investigation's interval body_ids are registered in the body index +
    formation lookup (a borehole-only body that no section carries still meshes).
    """
    if grid_spacing_m <= 0.0:
        raise ValueError(f"grid_spacing_m must be positive; got {grid_spacing_m}")
    if vertical_spacing_m is not None and vertical_spacing_m <= 0.0:
        raise ValueError(f"vertical_spacing_m must be positive; got {vertical_spacing_m}")

    # When geological band surfaces are supplied, the per-column stack is
    # assembled BAND-BY-BAND (each band filled by the nearest section that
    # reaches it, clipped to the geological surface with snap-or-divide) instead
    # of the single un-bounded blend.  An empty ``geo_surfaces`` keeps the
    # labelling byte-identical to the un-bounded path (the ``geo_bounded`` flag
    # gates the only divergence).
    geo_bounded = len(geo_surfaces) > 0

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

    # Horizontal spacing (X and Y) is ``grid_spacing_m``; the vertical (Z) spacing
    # is ``vertical_spacing_m`` when set, else the same — the cubic case, in which
    # ``v == h`` makes ``gz`` byte-identical to the pre-anisotropy build.
    h = grid_spacing_m
    v = grid_spacing_m if vertical_spacing_m is None else vertical_spacing_m
    # ``+ step/2`` so the closed interval is fully covered even when the span is an
    # exact multiple of the step (numpy ``arange`` is half-open).
    gx = np.arange(xmin, xmax + h / 2.0, h)
    gy = np.arange(ymin, ymax + h / 2.0, h)
    gz = np.arange(zmin, zmax + v / 2.0, v)
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

    # --- register honored-investigation bodies ----------------------------
    # Each honored investigation's intervals carry resolver body_ids; register
    # any not already seen on a section so a borehole-only body still meshes.
    # Sorted by (body_id) for a deterministic index assignment after the
    # section + None bodies.
    inv_new_bodies: dict[str, str] = {}  # body_id → formation_id
    for inv in investigation_columns:
        for bid, fid, _top, _base in inv.intervals:
            if bid not in body_index and bid not in inv_new_bodies:
                inv_new_bodies[bid] = fid
                formation_by_body[bid] = fid
    for bid in sorted(inv_new_bodies):
        if bid not in body_index:
            body_index[bid] = len(body_index)

    # --- map each honored investigation to the cells it owns ---------------
    # Every grid cell whose centre lies within ``honor_radius_m`` of the
    # investigation, plus its nearest cell always (see ``_honored_cells``).  When
    # two investigations claim the same cell, ``honor_rank`` decides —
    # has-a-log, then CPT over borehole, then deepest, then id (debt #241).
    honored_by_cell: dict[tuple[int, int], InvestigationColumn] = {}
    for inv in investigation_columns:
        if not inv.intervals:
            continue  # no observed log → nothing to honor
        for cell in _honored_cells(gx, gy, inv.world_x, inv.world_y, honor_radius_m):
            existing = honored_by_cell.get(cell)
            if existing is None or honor_rank(inv) < honor_rank(existing):
                honored_by_cell[cell] = inv

    # --- label every voxel column -----------------------------------------
    # Each column is labelled from its section-blend stack via ``_column_labels``
    # (a gap-free shallow→deep partition → one searchsorted over the boundary
    # edges).  A column that hosts an honored investigation instead takes
    # ``_honored_column_labels``: its OWN log within the observed depth range,
    # the blend above / below — so every investigation is faithful to its log
    # without punching a hole below a shallow log.
    gz_min = float(gz[0])
    gz_max = float(gz[-1])
    # Boundary-inclusive footprint tolerance: a grid cell whose centre sits on
    # or near a hull edge still overlaps the data footprint, so it must label.
    # Strict point-in-polygon parity is numerically unstable for cell centres
    # coincident with a boundary edge (~half flip to "outside" and get voided
    # even though the labeller produces a full stack), which left the 2-D
    # section fill discontinuous across hull-edge corridors. The cell
    # half-diagonal (½·h·√2) is the safe inclusion radius — any node whose cell
    # touches the footprint is admitted; nodes farther than a full cell stay void.
    footprint_tol = 0.5 * h * math.sqrt(2.0)
    # Off by default. The first attempt anchored the taper on the distance to an apex
    # that, 87-92 % of the time, lay on the very fence the other distance was measured
    # to — pinning the factor at exactly 0.5 so no body tapered to nothing anywhere.
    # The anchor is fixed (own-section apexes are excluded); it stays opt-in until an
    # A/B on real data earns the default.
    terminations: dict[str, tuple[Termination, ...]] | None = (
        body_terminations(sections) if measured_pinch else None
    )
    for i in range(nx):
        x = float(gx[i])
        for j in range(ny):
            y = float(gy[j])
            if not domain.contains(x, y, tol=footprint_tol):
                continue  # outside the footprint → void
            # The band-scoped column (geology-bounded) vs the un-bounded blend.
            # The band path fills each geological band from the nearest section
            # that reaches it (so a deeper band below a shallow test draws its
            # lithology sideways), clipped to the geological surfaces.
            # The band path may produce inter-band void gaps (a litho pinches
            # out before reaching its geological surface), so it labels with the
            # gap-aware ``_column_labels_gapped`` (a deeper band must not bleed up
            # into a shallower band's void); the no-geo path keeps the gap-free
            # ``_column_labels`` so its output is byte-identical to before.
            if geo_bounded:
                stack = _column_stack_geo(
                    sections, x, y, gz_min, gz_max, geo_surfaces, litho_snap_tolerance_m
                )
                labeller = _column_labels_gapped
            else:
                stack = _stack_at(sections, x, y, terminations)
                labeller = _column_labels
            honored = honored_by_cell.get((i, j))
            if honored is not None:
                labels[i, j, :] = _honored_column_labels(
                    stack, honored, gz, body_index, none_body_ids, labeller
                )
            elif stack:
                labels[i, j, :] = labeller(stack, gz, body_index, none_body_ids)

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
