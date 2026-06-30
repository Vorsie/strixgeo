"""Assign a borehole geotech band to the nearest same-class CPT geotech body.

Pure domain module — no I/O, no logging, no ORM imports.

A borehole has no CPT qc series, so its geotech bands are filled by
interpolating from neighbouring CPT bands of the same lithology (see
:mod:`borehole_packing_fill`).  After filling, each band must be associated
with the correct **geotech packing body** — the resolver-connected component
that groups same-packing CPT sub-bands across tests.

This helper answers: "given that this borehole band received packing class
*k*, which geotech body does it join?"

Rule
----
Among all CPT geotech bands in the same litho-body group whose
``nad_class`` equals the borehole band's ``nad_class`` AND whose
``body_id`` is not ``None``, return the ``body_id`` of the **spatially
nearest** CPT (2-D Euclidean distance).

When no such band exists (the borehole band was filled by the conservative
``body_min`` or ``absolute_min`` fallback, meaning no CPT in the group
carries that packing class), return ``None``.

On an exact distance tie, the CPT whose ``body_id`` string sorts
lexicographically first wins — this makes the result deterministic for any
dataset regardless of insertion order.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID


@dataclass(frozen=True)
class CptBandRef:
    """Reference to one CPT geotech band for nearest-body resolution.

    Parameters
    ----------
    cpt_x : float
        CPT world x-coordinate (m, e.g. Lambert 72 easting).
    cpt_y : float
        CPT world y-coordinate (m, e.g. Lambert 72 northing).
    nad_class : int
        NAD packing class 1–31 for this band.
    body_id : UUID | None
        Geotech resolver body_id for this band; ``None`` when the band
        was not resolved by the graph resolver (e.g. a skeleton band with
        no usable qc, or an isolated CPT with no correlation edges).
    """

    cpt_x: float
    cpt_y: float
    nad_class: int
    body_id: UUID | None


def assign_borehole_band_body(
    band_nad_class: int,
    borehole_x: float,
    borehole_y: float,
    cpt_bands_in_group: list[CptBandRef],
) -> UUID | None:
    """Return the geotech body_id of the nearest same-class CPT band.

    Searches ``cpt_bands_in_group`` for entries whose ``nad_class`` matches
    ``band_nad_class`` AND whose ``body_id`` is not ``None``.  Among those
    candidates, returns the ``body_id`` of the CPT closest to
    ``(borehole_x, borehole_y)`` in 2-D Euclidean distance (squared distance
    is used internally; the square root is never computed).

    On an exact distance tie, the candidate whose ``body_id`` sorts
    lexicographically first (as a string) wins, making the result
    deterministic for any dataset.

    Parameters
    ----------
    band_nad_class : int
        NAD packing class of the borehole band being assigned (1–31).
    borehole_x : float
        Borehole world x-coordinate (m).
    borehole_y : float
        Borehole world y-coordinate (m).
    cpt_bands_in_group : list[CptBandRef]
        CPT geotech bands from the same litho-body group that was used to
        fill this borehole's extent.  Each entry carries the CPT's (x, y),
        its own ``nad_class``, and its resolver ``body_id``.

    Returns
    -------
    UUID | None
        Geotech body_id of the nearest same-class CPT, or ``None`` when
        no same-class CPT band with a resolved body_id exists in the group
        (the borehole band was filled by a conservative ``body_min`` or
        ``absolute_min`` fallback; no CPT evidence of this packing class is
        present in the group).
    """
    candidates = [
        b for b in cpt_bands_in_group if b.nad_class == band_nad_class and b.body_id is not None
    ]
    if not candidates:
        return None

    def _sort_key(b: CptBandRef) -> tuple[float, str]:
        # Squared distance avoids a sqrt; tie-break on body_id string so the
        # result is independent of list order.
        dx = b.cpt_x - borehole_x
        dy = b.cpt_y - borehole_y
        return (dx * dx + dy * dy, str(b.body_id))

    return min(candidates, key=_sort_key).body_id
