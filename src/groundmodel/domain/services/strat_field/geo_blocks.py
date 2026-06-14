"""Geological band partition for the implicit stratigraphic builder.

The litho field is fit WITHIN each geological band, never across one (owner
directive 2026-06-11, ``CLAUDE.local.md``: "geology prevails — litho
interfingers ONLY within each geological unit").  The parent geological model
supplies hard band surfaces; this module turns them into:

1. :func:`partition_picks_by_geology` — assign every
   :class:`~groundmodel.domain.services.litho_body_pick.BodyLayerPick` to a
   geological band by its mid-elevation vs the surfaces at its ``(x, y)``,
   applying the **snap-or-divide** rule on the pick's bounding contacts so a
   litho contact near a geological surface does not spawn a spurious thin
   sliver across the boundary, and a layer that genuinely straddles a surface
   is divided at it.
2. :func:`band_blocks` — one surface-bounded
   :class:`~groundmodel.domain.services.strat_field.strat_types.Block` per
   geological band over the model hull, with the bounding geological surfaces
   as the band's hard top / base (the outermost open bounds stay flat).

Both are pure domain (no I/O, no logging); the geological surfaces are passed
in as :class:`~groundmodel.domain.services.strat_field.strat_types.SurfaceBound`
objects.  The geological model itself is never modified (build-only).

Reuse note
----------
The snap-or-divide segment logic adapts the retired loft builder's
``divide_picks_by_geology`` (``git show 1259e30c^:.../litho_geo_bounding.py``):
the per-pick "cut at boundaries strictly inside the span, within tolerance →
snap" mechanic is the same.  The strat path differs in its DOWNSTREAM need —
it groups segments by *band index* (the field is fit per band) rather than
re-keying split bodies by a derived id, so the body-id re-keying half of the
loft function is intentionally NOT ported here.  ``band_index`` itself is
ported verbatim from ``scripts/eval_geo_bounded_cycles.py``.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import replace

from groundmodel.domain.services.litho_body_pick import BodyLayerPick
from groundmodel.domain.services.strat_field.strat_types import Block, SurfaceBound

#: Elevations within this margin are treated as coincident (numeric guard,
#: independent of the user-facing snap tolerance).
_EPS = 1e-6


def _band_index(surfaces: list[SurfaceBound], x: float, y: float, mid_elev: float) -> int:
    """Band index = how many geological surfaces lie ABOVE ``mid_elev`` at ``(x, y)``.

    Ported verbatim from ``scripts/eval_geo_bounded_cycles.py``: band 0 is
    above every surface, band ``len(surfaces)`` is below every surface.
    Off-footprint sampling uses the surface's nearest-vertex fallback (handled
    inside :meth:`SurfaceBound.evaluate`).

    Parameters
    ----------
    surfaces : list of SurfaceBound
        The geological band surfaces (order irrelevant — we count, not index).
    x, y : float
        Horizontal sample location (project CRS).
    mid_elev : float
        The elevation whose band membership is being decided.

    Returns
    -------
    int
        The zero-based band index, 0 (shallowest) … ``len(surfaces)`` (deepest).
    """
    return sum(1 for s in surfaces if s.evaluate(x, y) > mid_elev)


def partition_picks_by_geology(
    picks: list[BodyLayerPick],
    surfaces: list[SurfaceBound],
    snap_tolerance_m: float,
) -> dict[int, list[BodyLayerPick]]:
    """Group picks by geological band, applying the snap-or-divide rule.

    For each pick, the geological surfaces at its ``(x, y)`` partition its
    elevation span.  A surface is a **cut** only when it crosses the span
    deeper than ``snap_tolerance_m`` from both the pick's top and base; a
    surface within ``snap_tolerance_m`` of the top or base **snaps** (the
    observed litho contact stands in for the divider — geology→litho — so no
    spurious thin sliver is created).  A pick whose span a surface cuts is
    **divided** at the surface: the part above goes to the upper band, the part
    below to the lower band.  Each resulting segment is assigned to its band by
    its own mid-elevation.

    Parameters
    ----------
    picks : list of BodyLayerPick
        Body-assigned picks (one member layer per investigation).
    surfaces : list of SurfaceBound
        The parent geological model's band surfaces.  An empty list → every
        pick lands in band 0 unchanged.
    snap_tolerance_m : float
        A geological boundary within this distance of a pick's top or base is
        treated as coincident with it (snap, no cut).

    Returns
    -------
    dict[int, list[BodyLayerPick]]
        Band index → the picks (whole or divided) whose mid-elevation falls in
        that band.  Divided picks keep their original ``body_id`` (the per-band
        body re-keying is the per-band build loop's job); only their
        ``top_depth_m`` / ``base_depth_m`` are trimmed to the band boundary.
    """
    by_band: dict[int, list[BodyLayerPick]] = defaultdict(list)
    if not surfaces:
        # No geology to bound against: one band, picks unchanged.
        by_band[0] = list(picks)
        return dict(by_band)

    # Sample geology once per investigation location (all picks at one
    # investigation share an (x, y)).
    elevations_by_inv: dict[str, list[float]] = {}
    for p in picks:
        if p.investigation_id not in elevations_by_inv:
            elevations_by_inv[p.investigation_id] = [s.evaluate(p.x_m, p.y_m) for s in surfaces]

    for p in picks:
        surf_elevs = elevations_by_inv[p.investigation_id]
        top_e = p.surface_elev_m - p.top_depth_m
        base_e = p.surface_elev_m - p.base_depth_m
        # A surface is a CUT only if it crosses strictly inside the span AND is
        # farther than tol from both the top and base (else it SNAPS to the
        # nearer contact — no cut).
        cuts = sorted(
            (e for e in surf_elevs if base_e + snap_tolerance_m < e < top_e - snap_tolerance_m),
            reverse=True,
        )
        edges = [top_e, *cuts, base_e]
        for seg_top_e, seg_base_e in zip(edges, edges[1:]):
            mid = 0.5 * (seg_top_e + seg_base_e)
            bi = _band_index(surfaces, p.x_m, p.y_m, mid)
            by_band[bi].append(
                replace(
                    p,
                    top_depth_m=p.surface_elev_m - seg_top_e,
                    base_depth_m=p.surface_elev_m - seg_base_e,
                )
            )

    return dict(by_band)


def band_blocks(
    surfaces: list[SurfaceBound],
    hull: tuple[tuple[float, float], ...],
    z_min: float,
    z_max: float,
) -> list[Block]:
    """Build one surface-bounded :class:`Block` per geological band, top → bottom.

    For ``n`` geological surfaces there are ``n + 1`` bands.  Band ``k`` (0 =
    shallowest) is bounded above by surface ``k - 1`` and below by surface
    ``k``; the shallowest band's top and the deepest band's base are OPEN and
    stay flat (``z_max`` / ``z_min`` — the DEM / deep-base fallbacks).  Adjacent
    bands SHARE the dividing surface object so the per-band caps stitch exactly.

    Parameters
    ----------
    surfaces : list of SurfaceBound
        The geological band surfaces.  Ordered top → bottom by their elevation
        at the hull centroid so the returned blocks are top → bottom; an empty
        list → a single flat block (the v1 behaviour).
    hull : tuple of (float, float)
        The horizontal footprint polygon shared by every band block.
    z_min : float
        Flat base fallback for the deepest (open) band.
    z_max : float
        Flat top fallback for the shallowest (open) band.

    Returns
    -------
    list[Block]
        One block per band, ordered shallowest → deepest.  ``block[0]`` has
        ``top_surface=None``; ``block[-1]`` has ``base_surface=None``.
    """
    if not surfaces:
        return [Block(polygon=hull, z_min=z_min, z_max=z_max)]

    # Order surfaces top → bottom by elevation at the hull centroid.  The
    # centroid is a stable, footprint-interior sample (every surface covers it
    # for a model whose bands share the hull); a tie-free, deterministic key.
    cx = sum(v[0] for v in hull) / len(hull)
    cy = sum(v[1] for v in hull) / len(hull)
    ordered = sorted(surfaces, key=lambda s: s.evaluate(cx, cy), reverse=True)

    blocks: list[Block] = []
    n_bands = len(ordered) + 1
    for k in range(n_bands):
        top_surface = ordered[k - 1] if k > 0 else None
        base_surface = ordered[k] if k < len(ordered) else None
        blocks.append(
            Block(
                polygon=hull,
                z_min=z_min,
                z_max=z_max,
                top_surface=top_surface,
                base_surface=base_surface,
            )
        )
    return blocks
