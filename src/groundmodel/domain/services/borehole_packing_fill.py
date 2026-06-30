"""Litho-confined borehole packing fill helper.

Pure domain module — no I/O, no logging, no ORM.  Computes the NAD packing
bands for one litho-body extent on a borehole by:

1. Clipping the CPT-derived packing sub-intervals to the extent bounds
   (never rescaling — a boundary at 7.5 m on a CPT stays at 7.5 m and
   is simply cut at the extent edge).
2. Filling any uncovered depth range within the extent conservatively:
   * ``body_min``   — use the smallest NAD class observed across the body's
     same-lithology CPTs (weakest packing = most conservative).
   * ``absolute_min`` — use the lithology family's absolute weakest class
     (constants from :mod:`geotech_subdivision_constants`), applied when no
     CPT data exists for the body at all (``body_min_class is None``).

The result is a contiguous, non-overlapping list of :class:`FillBand` rows
whose union exactly covers ``[extent_top, extent_base]``.

Provenance tags
---------------
``source`` on each band drives the confidence written to the persisted
``litho_layer.confidence`` column:

* ``"cpt_interpolated"`` — real CPT data TIN-interpolated at the borehole
  XY; write ``confidence='high'``.
* ``"body_min"``          — body-level conservative fallback; write
  ``confidence='low'``.
* ``"absolute_min"``     — last-resort lithology-floor fallback; write
  ``confidence='low'``.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class FillBand:
    """One NAD packing band within a borehole's litho-body extent.

    Parameters
    ----------
    top : float
        Band top depth (m, positive down), ≥ ``extent_top``.
    base : float
        Band base depth (m, positive down), ≤ ``extent_base``.
    nad_class : int
        NAD packing class 1–31.
    source : str
        Provenance tag: ``"cpt_interpolated"`` | ``"body_min"`` |
        ``"absolute_min"``.
    """

    top: float
    base: float
    nad_class: int
    source: str


def fill_borehole_litho_body_extent(
    extent_top: float,
    extent_base: float,
    cpt_packing_surfaces: list[tuple[float, float, int]],
    body_min_class: int | None,
    litho_abs_min_class: int,
) -> list[FillBand]:
    """Fill one litho-body extent on a borehole with NAD packing bands.

    Projects CPT-derived packing sub-intervals into ``[extent_top,
    extent_base]`` using CLIP (not proportional rescale), then fills any
    uncovered stretch with a conservative fallback band.

    Parameters
    ----------
    extent_top : float
        Top of the borehole's litho-body extent (m, positive down).
    extent_base : float
        Base of the borehole's litho-body extent (m, positive down).
    cpt_packing_surfaces : list[tuple[float, float, int]]
        TIN-interpolated CPT packing sub-intervals at the borehole (x, y),
        each as ``(top_m, base_m, nad_class)`` ordered top→bottom.
        Intervals outside or partially outside ``[extent_top, extent_base]``
        are clipped; intervals fully outside are dropped.
    body_min_class : int | None
        Minimum (weakest) NAD class observed across all same-lithology CPT
        bands in this body.  ``None`` when no same-lithology CPT data exists.
    litho_abs_min_class : int
        Absolute weakest NAD class for the lithology family (e.g. 5 for ZAND,
        21 for KLEI).  Used when ``body_min_class is None``.

    Returns
    -------
    list[FillBand]
        Contiguous, non-overlapping bands covering ``[extent_top,
        extent_base]`` exactly.  Never empty.

    Notes
    -----
    When ``cpt_packing_surfaces`` is empty **and** ``body_min_class is None``
    the entire extent is one ``absolute_min`` band.

    When CPT intervals leave gaps (head, internal, or tail) the gap is filled
    with one band whose ``nad_class`` is ``body_min_class`` (source
    ``"body_min"``) or ``litho_abs_min_class`` (source ``"absolute_min"``)
    depending on whether ``body_min_class`` is set.
    """
    # Fast-path: no CPT data at all → single conservative band.
    if not cpt_packing_surfaces:
        fallback_class = body_min_class if body_min_class is not None else litho_abs_min_class
        fallback_source = "body_min" if body_min_class is not None else "absolute_min"
        return [FillBand(extent_top, extent_base, fallback_class, fallback_source)]

    # Clip each CPT interval to [extent_top, extent_base].
    clipped: list[tuple[float, float, int]] = []
    for top, base, nc in cpt_packing_surfaces:
        c_top = max(top, extent_top)
        c_base = min(base, extent_base)
        if c_base > c_top + 1e-9:
            clipped.append((c_top, c_base, nc))

    # If all CPT intervals lay fully outside the extent, treat as no CPT data.
    if not clipped:
        fallback_class = body_min_class if body_min_class is not None else litho_abs_min_class
        fallback_source = "body_min" if body_min_class is not None else "absolute_min"
        return [FillBand(extent_top, extent_base, fallback_class, fallback_source)]

    # Sort by top depth and fill gaps around and between intervals.
    clipped.sort(key=lambda t: t[0])
    result: list[FillBand] = []
    cursor = extent_top
    gap_class = body_min_class if body_min_class is not None else litho_abs_min_class
    gap_source = "body_min" if body_min_class is not None else "absolute_min"

    for c_top, c_base, nc in clipped:
        if c_top > cursor + 1e-9:
            # Gap before this CPT interval.
            result.append(FillBand(cursor, c_top, gap_class, gap_source))
        result.append(FillBand(c_top, c_base, nc, "cpt_interpolated"))
        cursor = c_base

    # Tail gap after the last CPT interval.
    if cursor < extent_base - 1e-9:
        result.append(FillBand(cursor, extent_base, gap_class, gap_source))

    return result
