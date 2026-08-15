"""Read a section's 2-D partition along one column's vertical line.

Owner ruling 2026-08-15, after two failed attempts to reconstruct a borehole's
correlations from donor bookkeeping:

    the borehole thing is really a geometry problem, we draw half length lenses
    between two cpts same for onlaps. you just need to check if a borehole
    column intersects a lens or onlap

That is the whole idea.  The partition between two CPTs has already decided —
geometrically, from the engineer's own ties — what lies in the gap: bands that
span it, lenses that pinch out inside it, onlaps that lap a tie line.  A
borehole standing in that gap is simply a **vertical line** through that
geometry.  What the line cuts is what the borehole has; what it misses (a lens
that ended before it) the borehole does not have.

Why this replaces the donor arithmetic
--------------------------------------
The previous rules asked "which CPT band does this borehole band continue?" and
answered it twice — once per gap — with a depth alignment.  The two answers
disagreed, so no chain of ties ever closed across a borehole and the CPT↔CPT
tie spanning it was never replaced (dogfeed 2026-08-15: 76 of 86 spanning ties
had no borehole hop at all).  Reading the region the line cuts answers it once,
and the region NAMES the layers it belongs to, so the correlation is read off
rather than inferred.  Two boreholes cutting the same region are in the same
region — the borehole↔borehole link that no donor rule could produce comes for
free.

Pure domain module: no I/O, no ORM, no logging.  The application layer supplies
the regions (the same payload the 3-D build already receives) and the column's
gap-local fraction.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from groundmodel.domain.services.voxel_litho.voxel_types import RegionInput

# Horizontal tolerance when deciding whether a polygon edge spans the sampling
# fraction. The fractions are gap-local in [0, 1] over gaps tens of metres
# wide, so 1e-9 is float noise, not geometry.
_FRACTION_EPS = 1e-9

# Vertical spans thinner than this are dropped: ``litho_layer`` stores
# intervals at mm grain, so a sub-mm cut is a graze, not a band.
_MIN_SPAN_M = 0.001


@dataclass(frozen=True)
class LithoFrame:
    """A litho unit's own top and base elevation at a gap's two columns.

    The frame is what makes the litho model authoritative (owner, 2026-08-15:
    *"litho is authoritative still"* / *"we don't need to invent those, only
    invent inside existing litho at boreholes"*).  A geotech boundary drawn at
    some absolute elevation does not mean "that elevation" on a neighbouring
    column — it means "that far down the unit".  Normalising against this frame
    is the ``0 → 1`` rescale the owner asked for, applied to the SECTION
    geometry rather than to a donor stack.

    Parameters
    ----------
    left_top_elev_m, left_base_elev_m : float
        The unit's top and base elevation (mTAW) on the gap's left column.
    right_top_elev_m, right_base_elev_m : float
        The same on its right column.
    """

    left_top_elev_m: float
    left_base_elev_m: float
    right_top_elev_m: float
    right_base_elev_m: float

    def bounds_at(self, fraction: float) -> tuple[float, float]:
        """The unit's top and base elevation at a gap-local *fraction*.

        Parameters
        ----------
        fraction : float
            Gap-local horizontal position in ``[0, 1]``.

        Returns
        -------
        tuple[float, float]
            ``(top_elev_m, base_elev_m)``, linearly interpolated between the
            two columns — the same straight contact the section draws.
        """
        top = self.left_top_elev_m + fraction * (self.right_top_elev_m - self.left_top_elev_m)
        base = self.left_base_elev_m + fraction * (self.right_base_elev_m - self.left_base_elev_m)
        return top, base


@dataclass(frozen=True)
class SampledBand:
    """One elevation interval a column's vertical line cuts out of a region.

    Parameters
    ----------
    top_elev_m : float
        Top of the cut, absolute elevation (mTAW).
    base_elev_m : float
        Base of the cut, absolute elevation (mTAW); always below ``top_elev_m``.
    formation_id : str
        The region's formation — on the geotech axis this is the NAD-class
        unit, which is what the band becomes.
    layer_ids : tuple[str, ...]
        The ``litho_layer`` ids whose units produced the region.  These are the
        bands the cut CORRESPONDS to, so they are exactly the endpoints of the
        ties the column earns by standing here.
    kind : str | None
        ``quad`` / ``pinch`` / ``lens`` — how the 2-D engine terminated the
        region.  Carried for provenance; a ``pinch`` or ``lens`` cut is the
        engineer's own half-length geometry, not an interpolation.
    overlay_tier : str | None
        ``onlap`` / ``lens`` for an overlay region, ``None`` for a main one.
        An overlay covers whatever main region it sits over.
    """

    top_elev_m: float
    base_elev_m: float
    formation_id: str
    layer_ids: tuple[str, ...]
    kind: str | None = None
    overlay_tier: str | None = None


def _vertical_span(
    polygon: Sequence[tuple[float, float]], fraction: float
) -> tuple[float, float] | None:
    """Elevation span a vertical line at *fraction* cuts from *polygon*.

    Parameters
    ----------
    polygon : Sequence[tuple[float, float]]
        Region outline as ``(fraction, elevation_m)`` points.
    fraction : float
        Gap-local horizontal position to sample at, in ``[0, 1]``.

    Returns
    -------
    tuple[float, float] | None
        ``(top_elev_m, base_elev_m)``, or ``None`` when the line misses the
        polygon (a lens that pinched out before this column) or grazes it.

    Notes
    -----
    Uses the extreme crossings rather than even-odd pairing.  Every region the
    partition engine emits is a top curve over a base curve — vertically convex
    at any fraction it covers — so the highest and lowest crossings ARE the
    band.  Even-odd pairing would be equivalent there but is fragile exactly
    where these polygons are not: at shared vertices and vertical end edges,
    which every quad has two of.
    """
    crossings: list[float] = []
    count = len(polygon)
    for index in range(count):
        x1, y1 = polygon[index]
        x2, y2 = polygon[(index + 1) % count]
        if abs(x2 - x1) <= _FRACTION_EPS:
            # A vertical edge — it lies at the sampling fraction or nowhere.
            if abs(x1 - fraction) <= _FRACTION_EPS:
                crossings.append(y1)
                crossings.append(y2)
            continue
        low, high = (x1, x2) if x1 < x2 else (x2, x1)
        if low - _FRACTION_EPS <= fraction <= high + _FRACTION_EPS:
            t = (fraction - x1) / (x2 - x1)
            crossings.append(y1 + t * (y2 - y1))
    if len(crossings) < 2:
        return None
    top, base = max(crossings), min(crossings)
    if top - base < _MIN_SPAN_M:
        return None
    return top, base


def sample_regions_at_fraction(
    regions: Sequence[RegionInput], *, gap_index: int, fraction: float
) -> list[SampledBand]:
    """Cut one gap's partition with a vertical line and report what it hits.

    Parameters
    ----------
    regions : Sequence[RegionInput]
        Every region of the section (any gap); only those whose ``gap_index``
        matches are read.
    gap_index : int
        The gap the column stands in — index of its LEFT column.
    fraction : float
        The column's gap-local horizontal position, ``0`` at the left column
        and ``1`` at the right one.

    Returns
    -------
    list[SampledBand]
        The intervals the line cuts, ordered top to bottom.  Overlay regions
        (lens / onlap) take precedence over the main regions they cover, which
        is the same order the section draws them in — so what this returns is
        what the engineer sees at that position.  Empty when the line cuts
        nothing (no partition in this gap, or a column outside every region).
    """
    mains: list[SampledBand] = []
    overlays: list[SampledBand] = []
    for region in regions:
        if region.gap_index != gap_index:
            continue
        span = _vertical_span(region.polygon, fraction)
        if span is None:
            continue
        band = SampledBand(
            top_elev_m=span[0],
            base_elev_m=span[1],
            formation_id=region.formation_id,
            layer_ids=tuple(region.layer_ids),
            kind=region.kind,
            overlay_tier=region.overlay_tier,
        )
        (overlays if region.overlay_tier is not None else mains).append(band)

    if not overlays:
        return sorted(mains, key=lambda b: -b.top_elev_m)

    # An overlay covers the main region it sits over — the same precedence the
    # renderer draws with. Subtracting rather than dropping keeps the parts of
    # a main band the overlay does not reach, which is the whole point of a
    # half-length lens: above and below it the matrix is still there.
    kept: list[SampledBand] = []
    for main in mains:
        pieces = [(main.top_elev_m, main.base_elev_m)]
        for overlay in overlays:
            remaining: list[tuple[float, float]] = []
            for top, base in pieces:
                if overlay.base_elev_m >= top or overlay.top_elev_m <= base:
                    remaining.append((top, base))
                    continue
                if top - overlay.top_elev_m >= _MIN_SPAN_M:
                    remaining.append((top, overlay.top_elev_m))
                if overlay.base_elev_m - base >= _MIN_SPAN_M:
                    remaining.append((overlay.base_elev_m, base))
            pieces = remaining
        for top, base in pieces:
            if top - base >= _MIN_SPAN_M:
                kept.append(
                    SampledBand(
                        top_elev_m=top,
                        base_elev_m=base,
                        formation_id=main.formation_id,
                        layer_ids=main.layer_ids,
                        kind=main.kind,
                        overlay_tier=None,
                    )
                )
    return sorted([*kept, *overlays], key=lambda b: -b.top_elev_m)


@dataclass(frozen=True)
class PlacedBand:
    """A sampled band re-laid inside a column's OWN litho unit.

    Parameters
    ----------
    depth_top_m, depth_base_m : float
        The band's extent in the column's own depth frame (m below its collar),
        always inside the litho layer it subdivides.
    formation_id : str
        The geotech (NAD-class) formation the sampled region carried.
    layer_ids : tuple[str, ...]
        The ``litho_layer`` ids the sampled region belongs to — the tie
        endpoints this band earns.
    kind : str | None
        The sampled region's termination (``quad`` / ``pinch`` / ``lens``).
    """

    depth_top_m: float
    depth_base_m: float
    formation_id: str
    layer_ids: tuple[str, ...]
    kind: str | None = None


def place_bands_in_litho_layer(
    bands: Sequence[SampledBand],
    *,
    fraction: float,
    frame: LithoFrame,
    layer_top_m: float,
    layer_base_m: float,
) -> list[PlacedBand]:
    """Re-lay sampled bands inside one column's own litho layer.

    Each band's elevations are read as a fraction of the litho unit's OWN
    thickness at the sampling position (the ``0 → 1`` rescale), then re-laid at
    the same fractions inside the column's litho layer.  That is what keeps the
    litho model authoritative: the unit's top and base on this column come from
    the column's own litho log, and only the subdivision INSIDE it comes from
    the section geometry (owner ruling 2026-08-15).

    Sampling and then warping is exact rather than an approximation: at a fixed
    fraction the warp is affine in elevation, so it commutes with the cut.

    Parameters
    ----------
    bands : Sequence[SampledBand]
        Bands cut by :func:`sample_regions_at_fraction`, any order.
    fraction : float
        The column's gap-local position the bands were sampled at.
    frame : LithoFrame
        The litho unit's own top/base elevation at the gap's two columns.
    layer_top_m, layer_base_m : float
        The litho layer's extent on THIS column (m below its collar).

    Returns
    -------
    list[PlacedBand]
        Bands inside ``[layer_top_m, layer_base_m]``, ordered top to bottom,
        clipped to the layer and with sub-mm slivers dropped.  Empty when the
        frame is degenerate at this fraction or the layer has no thickness.

    Notes
    -----
    Gaps are preserved.  Depth the section geometry leaves unclassified at this
    position stays unclassified here; deciding what to do with it is the
    caller's business, not this function's.
    """
    unit_top_elev, unit_base_elev = frame.bounds_at(fraction)
    unit_thickness = unit_top_elev - unit_base_elev
    layer_thickness = layer_base_m - layer_top_m
    if unit_thickness <= 0.0 or layer_thickness <= 0.0:
        return []

    placed: list[PlacedBand] = []
    for band in sorted(bands, key=lambda b: -b.top_elev_m):
        # 0 at the unit top, 1 at its base — the owner's rescale.
        top_u = (unit_top_elev - band.top_elev_m) / unit_thickness
        base_u = (unit_top_elev - band.base_elev_m) / unit_thickness
        top_u = min(max(top_u, 0.0), 1.0)
        base_u = min(max(base_u, 0.0), 1.0)
        if base_u - top_u <= 0.0:
            continue
        depth_top = layer_top_m + top_u * layer_thickness
        depth_base = layer_top_m + base_u * layer_thickness
        if depth_base - depth_top < _MIN_SPAN_M:
            continue
        placed.append(
            PlacedBand(
                depth_top_m=depth_top,
                depth_base_m=depth_base,
                formation_id=band.formation_id,
                layer_ids=band.layer_ids,
                kind=band.kind,
            )
        )
    return placed
