"""The loft field — the blended per-column stack at any map-plane point.

This is the core of the watertight loft builder (spec §3).  At a map-plane
point ``(x, y)`` the field answers "which bodies, at what elevations" by
interpolating the validated 2D section partitions (``computeSectionFill`` /
``compute_section_fill``) BETWEEN their sections.

Owner decisions encoded here (spec §3, decisions 4–6):

* **Two-nearest blend.** A node takes its two nearest sections and blends
  matched bodies' interfaces by inverse perpendicular distance.
* **Equidistance-midline pinch.** A body present on one of the two sections
  but not the other pinches to zero thickness exactly at the midline between
  them (the 2D lens rule generalised to 3D).
* **Between vs beyond.** A node blends only when it lies BETWEEN its two
  nearest sections (its projection onto the axis joining the two projection
  points has parameter ``t ∈ [0, 1]``); otherwise it is governed by its
  nearest section alone — BAND regions extend to the alpha wall, ONLAP/LENS
  regions pinch over ``open_extent_length_m``.
* **The tiling is always complete.** Any band volume not covered by a litho
  region is filled by the band itself (``is_band_filler``).

Re-stacking rule (resolves spec open question 3 — under-determined when
one-sided pinches interleave matched bodies).  Rather than blend interface
elevations independently (which can open gaps when a body pinches out), the
field blends THICKNESSES and lays the stack out cumulatively from a blended
top.  This guarantees the partition property (gap-free, no overlap) by
construction, and reproduces the independent-interface blend whenever the two
columns share a surface elevation (the common same-DEM case).

Pure domain module — no I/O, no logging, no framework imports.  ``LoftField``
computes; it does not act, so it does not inherit ``GroundModelLogger``.
"""

from __future__ import annotations

import math
from bisect import bisect_right
from collections import defaultdict
from collections.abc import Callable, Sequence
from dataclasses import dataclass

from groundmodel.domain.services.model_domain import ModelDomain
from groundmodel.domain.services.section_partition import (
    PartitionPoint,
    RegionKind,
    SectionRegion,
)

__all__ = [
    "BandSurface",
    "SectionInput",
    "StackEntry",
    "LoftField",
]

# Tolerance for "zero thickness / coincident elevation".  Mirrors the partition
# pipeline's EPS; intervals thinner than this are dropped.
EPS: float = 1e-9

# Fraction nudge: slicing a region polygon exactly on a column edge (fraction 0
# or 1) hits vertices and vertical edges; nudge the query fraction this far into
# the gap interior so every relevant edge strictly straddles the slice line.
FRAC_EPS: float = 1e-6


# ---------------------------------------------------------------------------
# Inputs and outputs
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class SectionInput:
    """One section's geometry and its 2D partition, ready for lofting.

    The 2D ``SectionRegion``s live in gap-local *fraction* space (0 = the gap's
    left column, 1 = its right column).  ``column_alongs`` is where the
    along ↔ fraction mapping lives — deliberately NOT on ``PartitionColumn``,
    which mirrors the TS interface and carries no along position.  Gap ``i``
    spans ``column_alongs[i] → column_alongs[i+1]``; a region with
    ``gap_index = i`` maps its fraction ``f`` to
    ``along = column_alongs[i] + f * (column_alongs[i+1] - column_alongs[i])``.

    Parameters
    ----------
    section_id : str
        Identity of the source cross-section.
    ax, ay, bx, by : float
        The section line's two endpoints in the project's map CRS (metres).
        ``along`` is measured from ``(ax, ay)`` toward ``(bx, by)``.
    column_alongs : tuple[float, ...]
        Ascending along-positions of the partition columns on this line.
        Length must equal (number of gaps) + 1.
    regions : tuple[SectionRegion, ...]
        The 2D partition regions (``compute_section_fill`` output) for this
        section, each tagged with its ``gap_index``.
    """

    section_id: str
    ax: float
    ay: float
    bx: float
    by: float
    column_alongs: tuple[float, ...]
    regions: tuple[SectionRegion, ...]

    def __post_init__(self) -> None:
        """Validate the along ↔ gap invariant: a section with regions needs at
        least 2 columns, and one more column than its highest gap index."""
        if not self.regions:
            return
        max_gap = max(r.gap_index for r in self.regions)
        if len(self.column_alongs) < max_gap + 2:
            raise ValueError(
                f"section {self.section_id!r}: column_alongs has "
                f"{len(self.column_alongs)} entries but gap_index reaches "
                f"{max_gap} (needs {max_gap + 2})"
            )


@dataclass(frozen=True)
class StackEntry:
    """One vertical interval of a single body at a map-plane point.

    Parameters
    ----------
    body_id : str | None
        Resolver-stamped body identity, or ``None`` for a never-correlated
        minority / a band filler.
    formation_id : str
        Lithology (drives the fill colour).
    top_elev : float
        Top elevation of the interval (mTAW, positive up).
    base_elev : float
        Base elevation of the interval (mTAW, positive up; below ``top_elev``).
    is_band_filler : bool, default False
        True when this entry fills uncovered band volume (it carries the band's
        formation, not a litho body).
    """

    body_id: str | None
    formation_id: str
    top_elev: float
    base_elev: float
    is_band_filler: bool = False

    @property
    def thickness(self) -> float:
        """Vertical thickness of the interval (``top_elev - base_elev``)."""
        return self.top_elev - self.base_elev


@dataclass(frozen=True)
class BandSurface:
    """A geological band bounding the litho fill (geology-prevails rule).

    Litho never crosses a band boundary; uncovered band volume is filled by
    the band itself.  The surfaces are supplied as callables so the
    application layer can wrap geo-model TINs (with their own fallbacks)
    without coupling this domain module to a surface representation.

    Parameters
    ----------
    formation_id : str
        The band's formation (used for the filler entries).
    top_elev_at : Callable[[float, float], float]
        Band top elevation at ``(x, y)``.
    base_elev_at : Callable[[float, float], float]
        Band base elevation at ``(x, y)`` (below the top).
    """

    formation_id: str
    top_elev_at: Callable[[float, float], float]
    base_elev_at: Callable[[float, float], float]


@dataclass(frozen=True)
class _RawEntry:
    """An internal section-stack interval, carrying the 2D kind for the beyond
    ramp (BAND extends, ONLAP/LENS pinch)."""

    body_id: str | None
    formation_id: str
    top_elev: float
    base_elev: float
    kind: RegionKind
    overlay_tier: str | None


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------


def _project_point_to_segment(
    x: float, y: float, ax: float, ay: float, bx: float, by: float
) -> tuple[float, float, float, float]:
    """Project ``(x, y)`` onto segment ``[a, b]`` (clamped to its endpoints).

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
    if seg2 < EPS:
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
    polygon: Sequence[PartitionPoint], f: float
) -> list[tuple[float, float]]:
    """Slice a region polygon by the vertical line ``fraction = f``.

    Uses the standard even-odd scanline with a half-open edge convention so
    each spanning edge contributes exactly one crossing.  Returns the
    ``(base, top)`` intervals where the polygon covers the slice line.

    Parameters
    ----------
    polygon : Sequence[PartitionPoint]
        Closed ring (no repeated last point) in (fraction, elevation) space.
    f : float
        The fraction to slice at (already nudged off the column edges).

    Returns
    -------
    list[tuple[float, float]]
        ``(base_elev, top_elev)`` pairs, base below top.  Empty when the
        region does not cover ``f`` (e.g. a pinched-out apex).
    """
    xs = [p.fraction for p in polygon]
    if f < min(xs) or f > max(xs):
        return []
    crossings: list[float] = []
    n = len(polygon)
    for i in range(n):
        x0, y0 = polygon[i].fraction, polygon[i].elevation
        x1, y1 = polygon[(i + 1) % n].fraction, polygon[(i + 1) % n].elevation
        if x0 == x1:
            continue  # vertical edge — the nudged slice line never lies exactly here
        if (x0 <= f < x1) or (x1 <= f < x0):
            tt = (f - x0) / (x1 - x0)
            crossings.append(y0 + tt * (y1 - y0))
    crossings.sort()
    out: list[tuple[float, float]] = []
    for k in range(0, len(crossings) - 1, 2):
        base, top = crossings[k], crossings[k + 1]
        if top - base > EPS:
            out.append((base, top))
    return out


def _section_stack_at(section: SectionInput, along: float) -> list[_RawEntry]:
    """The section's vertical stack at along-position ``along``.

    Clamps ``along`` into the section's column range (a projection beyond the
    end columns uses the end column's stack — the section extends its end
    stack laterally, consistent with the 2D model), finds the containing gap,
    slices every region of that gap at the local fraction, and returns the
    intervals ordered shallow → deep.
    """
    alongs = section.column_alongs
    if len(alongs) < 2:
        return []
    a = min(max(along, alongs[0]), alongs[-1])
    gi = bisect_right(alongs, a) - 1
    gi = min(max(gi, 0), len(alongs) - 2)
    lo, hi = alongs[gi], alongs[gi + 1]
    f = 0.0 if hi - lo < EPS else (a - lo) / (hi - lo)
    f = min(max(f, FRAC_EPS), 1.0 - FRAC_EPS)
    raw: list[_RawEntry] = []
    for r in section.regions:
        if r.gap_index != gi:
            continue
        for base_e, top_e in _slice_region_intervals(r.polygon, f):
            raw.append(_RawEntry(r.body_id, r.formation_id, top_e, base_e, r.kind, r.overlay_tier))
    raw.sort(key=lambda e: -e.top_elev)
    return raw


# ---------------------------------------------------------------------------
# Stack assembly
# ---------------------------------------------------------------------------


def _th(e: _RawEntry | StackEntry) -> float:
    """Vertical thickness of an interval."""
    return e.top_elev - e.base_elev


def _mid(e: _RawEntry | StackEntry) -> float:
    """Mid-elevation of an interval."""
    return (e.top_elev + e.base_elev) / 2.0


def _layout(
    specs: list[tuple[float, str | None, str, float]], top: float | None
) -> list[StackEntry]:
    """Lay out placement specs cumulatively from ``top`` (the partition rule).

    Each spec is ``(ref_elev, body_id, formation_id, thickness)`` already
    sorted shallow → deep.  Entries are stacked contiguously so the result is
    gap-free by construction; zero-thickness specs (a fully pinched body) are
    dropped from the output but still advance the running elevation (by zero),
    keeping the stack a true partition.
    """
    if top is None:
        return []
    out: list[StackEntry] = []
    cur = top
    for _ref, body_id, formation_id, thickness in specs:
        base = cur - thickness
        if thickness > EPS:
            out.append(StackEntry(body_id, formation_id, cur, base))
        cur = base
    return out


def _blended_top(stack1: list[_RawEntry], stack2: list[_RawEntry], w1: float) -> float | None:
    """Blend the two stacks' top elevations (shallowest entry), tolerating an
    empty stack on either side."""
    t1 = stack1[0].top_elev if stack1 else None
    t2 = stack2[0].top_elev if stack2 else None
    if t1 is None and t2 is None:
        return None
    if t1 is None:
        return t2
    if t2 is None:
        return t1
    return w1 * t1 + (1.0 - w1) * t2


def _blend_stacks(stack1: list[_RawEntry], stack2: list[_RawEntry], w1: float) -> list[StackEntry]:
    """Blend two section stacks at inverse-distance weight ``w1`` (for stack 1).

    Bodies present on BOTH stacks (matched by ``body_id``, re-entrant
    occurrences paired by elevation rank) blend their thickness by ``w1``.
    A body present on only one stack pinches: its thickness scales by
    ``max(0, 2*w_own - 1)`` — full at its own section, zero at the equidistance
    midline.  ``None`` bodies (never-correlated minorities) are always treated
    as one-sided (they carry no cross-section identity to match on).  The
    result is laid out cumulatively so it tiles.
    """
    w2 = 1.0 - w1
    g1: dict[str, list[_RawEntry]] = defaultdict(list)
    g2: dict[str, list[_RawEntry]] = defaultdict(list)
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


def _beyond_stack(raw: list[_RawEntry], ramp: float) -> list[StackEntry]:
    """Single-section extrusion (the node is beyond its nearest section).

    BAND regions (``kind == 'quad'``) extend to the alpha wall unchanged;
    ONLAP/LENS regions (``pinch``/``lens``) ramp to zero thickness over
    ``open_extent_length_m`` (the caller passes the already-computed ``ramp``
    factor in ``[0, 1]``).  Reuses ``_layout`` for the cumulative walk so the
    gap-free guarantee lives in one place: the raw stack is already ordered
    shallow → deep, so the specs preserve that order (``_layout`` does not
    re-sort).
    """
    if not raw:
        return []
    specs = [
        (
            _mid(e),
            e.body_id,
            e.formation_id,
            _th(e) if e.kind == "quad" else _th(e) * ramp,
        )
        for e in raw
    ]
    return _layout(specs, raw[0].top_elev)


def _clip_to_bands(
    stack: list[StackEntry], bands: Sequence[BandSurface], x: float, y: float
) -> list[StackEntry]:
    """Clip the litho stack to each geological band and fill the uncovered
    sub-intervals with the band itself (the tiling is always complete).

    Geology prevails (owner directive 2026-06-11): a litho body never crosses a
    band boundary.  A body that spans two bands is therefore split into TWO
    distinct bodies — one per band — by suffixing the band index onto its
    ``body_id`` (``"<body>#b<k>"``).  Without this re-key the mesher, which
    groups wedges by ``body_id``, would reunite the two band portions into one
    mesh that straddles the boundary.  Band fillers keep ``body_id is None``.
    """
    out: list[StackEntry] = []
    for k, band in enumerate(bands):
        bt = band.top_elev_at(x, y)
        bb = band.base_elev_at(x, y)
        if bt - bb <= EPS:
            continue
        covered: list[StackEntry] = []
        for e in stack:
            hi = min(e.top_elev, bt)
            lo = max(e.base_elev, bb)
            if hi - lo > EPS:
                # Re-key the body per band so a body spanning the boundary
                # becomes two band-confined bodies (geology prevails).
                band_body_id = None if e.body_id is None else f"{e.body_id}#b{k}"
                covered.append(StackEntry(band_body_id, e.formation_id, hi, lo, e.is_band_filler))
        covered.sort(key=lambda e: -e.top_elev)
        # The band's own filler also carries a band-scoped id so two bands'
        # fillers (same formation colour) do NOT merge into one mesh straddling
        # the boundary — the geology-prevails rule applies to fillers too.
        filler_id = f"band-filler#b{k}"
        cur = bt
        for e in covered:
            if e.top_elev < cur - EPS:
                out.append(StackEntry(filler_id, band.formation_id, cur, e.top_elev, True))
            out.append(e)
            # ``min`` (not a plain assignment) keeps the frontier at the deepest
            # elevation seen — robust even if a covered entry were nested inside
            # an earlier one, which a plain ``cur = e.base_elev`` would regress.
            cur = min(cur, e.base_elev)
        if cur > bb + EPS:
            out.append(StackEntry(filler_id, band.formation_id, cur, bb, True))
    return out


def _clip_to_domain(stack: list[StackEntry], top_lim: float, base_lim: float) -> list[StackEntry]:
    """Clip every entry to ``[base_lim, top_lim]``; drop empty intervals."""
    out: list[StackEntry] = []
    for e in stack:
        hi = min(e.top_elev, top_lim)
        lo = max(e.base_elev, base_lim)
        if hi - lo > EPS:
            out.append(StackEntry(e.body_id, e.formation_id, hi, lo, e.is_band_filler))
    return out


# ---------------------------------------------------------------------------
# The field
# ---------------------------------------------------------------------------


class LoftField:
    """The blended per-column stack field over a set of sections.

    Parameters
    ----------
    sections : Sequence[SectionInput]
        The project's cross-sections with their 2D partitions.  At least one;
        with one section every node uses the single-section rule.
    domain : ModelDomain
        The lateral footprint + top/deep-base surfaces (Task 4).  The stack is
        always clipped to ``[deep_base_at(x, y), top_at(x, y)]``.
    band_surfaces : Sequence[BandSurface] | None, optional
        Geological bands that bound the litho fill.  When given, the stack is
        clipped to the bands and uncovered band volume is filled by the band.
    open_extent_length_m : float, default 3.0
        How far a one-sided (pinch/lens) region extends past its section before
        it ramps to zero thickness (the ``open_extent`` knob).
    """

    def __init__(
        self,
        sections: Sequence[SectionInput],
        domain: ModelDomain,
        band_surfaces: Sequence[BandSurface] | None = None,
        open_extent_length_m: float = 3.0,
    ) -> None:
        self.sections = list(sections)
        self.domain = domain
        self.band_surfaces = list(band_surfaces) if band_surfaces else None
        self.open_extent_length_m = open_extent_length_m

    def stack_at(self, x: float, y: float) -> list[StackEntry]:
        """Return the vertical body stack at map-plane point ``(x, y)``.

        Picks the two nearest sections; blends them when the node lies between
        them, else extrudes the nearest section alone (beyond rule).  Then
        clips to the geological bands (if any) and to the domain interval.

        Parameters
        ----------
        x, y : float
            Map-plane query coordinates (metres, project CRS).

        Returns
        -------
        list[StackEntry]
            The body stack ordered shallow → deep; ``[]`` when the domain
            interval at ``(x, y)`` is degenerate.
        """
        if not self.sections:
            return []

        projs = [
            (s, *_project_point_to_segment(x, y, s.ax, s.ay, s.bx, s.by)) for s in self.sections
        ]
        projs.sort(key=lambda p: p[2])  # by perpendicular distance
        s1, along1, d1, px1, py1 = projs[0]

        between = False
        if len(projs) >= 2:
            # Blend only when the node lies BETWEEN the two sections — its
            # projection onto the axis joining the two projection points has
            # t ∈ [0, 1].  For near-parallel sections this axis is the true
            # interpolation direction; for crossing sections it is an
            # approximation that errs toward blending, which is geologically
            # reasonable in the crossing zone.
            _s2, _along2, _d2, px2, py2 = projs[1]
            dx, dy = px2 - px1, py2 - py1
            axis2 = dx * dx + dy * dy
            t = 0.0 if axis2 < EPS else ((x - px1) * dx + (y - py1) * dy) / axis2
            between = -EPS <= t <= 1.0 + EPS

        if between:
            s2, along2, d2, _px2, _py2 = projs[1]
            stack1 = _section_stack_at(s1, along1)
            stack2 = _section_stack_at(s2, along2)
            denom = d1 + d2
            w1 = 0.5 if denom < EPS else d2 / denom
            stack = _blend_stacks(stack1, stack2, w1)
        else:
            raw = _section_stack_at(s1, along1)
            if self.open_extent_length_m > EPS:
                ramp = max(0.0, 1.0 - d1 / self.open_extent_length_m)
            else:
                # A zero/negative knob disables the ramp: full thickness when
                # the node sits on the section line, nothing once it is off it.
                ramp = 1.0 if d1 < EPS else 0.0
            stack = _beyond_stack(raw, ramp)

        if self.band_surfaces:
            stack = _clip_to_bands(stack, self.band_surfaces, x, y)

        top_lim = self.domain.top_at(x, y)
        base_lim = self.domain.deep_base_at(x, y)
        return _clip_to_domain(stack, top_lim, base_lim)
