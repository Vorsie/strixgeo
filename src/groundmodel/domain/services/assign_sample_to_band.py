"""Assign a lab sample to the geotech band it falls in.

Pure domain helper — no I/O, no logging, no ORM imports.

A sample's membership in a geotech band is determined by its **midpoint**
``(depth_top_m + depth_base_m) / 2``.  Spanning samples (whose depth interval
straddles a band boundary) are assigned to the band that contains the midpoint,
so a thin, hard-to-locate boundary does not split an otherwise consistent
sample.

DOV spot samples where ``depth_top_m == depth_base_m`` produce a midpoint equal
to both values and are matched correctly by the ``top <= mid <= base`` check.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Band:
    """Input descriptor for one geotech packing band.

    Carries the minimum fields needed to assign a sample to a band.  Callers
    build this from the :class:`~groundmodel.domain.services.borehole_packing_fill.FillBand`
    rows persisted during "Divide boreholes", augmented with the geotech
    resolver ``body_id`` determined by
    :func:`~groundmodel.domain.services.assign_borehole_band_body.assign_borehole_band_body`.

    Parameters
    ----------
    top : float
        Band top depth (m, positive down).
    base : float
        Band base depth (m, positive down).  Must satisfy ``base > top``.
    body_id : str | None
        Geotech resolver connected-component body_id, or ``None`` when the
        band was filled by a conservative fallback (``body_min`` /
        ``absolute_min``) and no same-class CPT exists in the group.
    nad_class : int | None
        NAD packing class 1–31, or ``None`` for a band the model has not
        classified. A band left unclassified by the soil-family clamp is the
        case that produces ``None`` here, and the sample must inherit the gap
        rather than a class: ``assign_sample_to_band`` already answers
        ``int | None`` and ``sample.geotech_nad_class`` is nullable.
    source : str
        Provenance tag: ``"cpt_interpolated"`` | ``"body_min"`` |
        ``"absolute_min"``.
    """

    top: float
    base: float
    body_id: str | None
    nad_class: int | None
    source: str


def assign_sample_to_band(
    sample_top: float,
    sample_base: float,
    bands: list[Band],
) -> tuple[str | None, int | None, str]:
    """Assign a lab sample to the geotech band containing its midpoint.

    The sample's midpoint ``(sample_top + sample_base) / 2`` is computed and
    matched against each band's ``[top, base]`` interval.  The first band that
    contains the midpoint (``band.top <= mid <= band.base``) is returned.

    When bands are non-overlapping and contiguous (as produced by
    :func:`~groundmodel.domain.services.borehole_packing_fill.fill_borehole_litho_body_extent`)
    at most one band will match for any midpoint that does not fall exactly on a
    boundary.  In the rare exact-boundary case the first (shallowest) matching
    band wins.

    Parameters
    ----------
    sample_top : float
        Sample top depth (m, positive down).
    sample_base : float
        Sample base depth (m, positive down).  Equal to ``sample_top`` for DOV
        spot samples.
    bands : list[Band]
        Ordered list of geotech bands for the borehole.  The list is typically
        sorted top→bottom but the function iterates all bands and returns the
        first match, so order only affects tie-breaking at exact boundaries.

    Returns
    -------
    tuple[str | None, int | None, str]
        ``(body_id, nad_class, source)`` of the matched band, or
        ``(None, None, "unresolved")`` when the midpoint lies outside every
        band.

    Notes
    -----
    * Samples whose midpoint lies above or below all bands return
      ``"unresolved"`` — this happens when a sample sits outside the borehole's
      geotech-modelled extent (e.g. a shallow surface sample above the first
      geotech layer).
    * The ``source`` return value carries the provenance tier of the *band*
      (``"cpt_interpolated"`` / ``"body_min"`` / ``"absolute_min"``), which is
      richer than the binary ``confidence`` flag stored on the layer row.
    """
    mid = (sample_top + sample_base) / 2.0
    for band in bands:
        if band.top <= mid <= band.base:
            return (band.body_id, band.nad_class, band.source)
    return (None, None, "unresolved")
