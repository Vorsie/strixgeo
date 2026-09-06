"""Value object: :class:`BedOverridePolygon`."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class BedOverridePolygon:
    """A manual bed-level override — a map polygon at one constant elevation.

    The owner's site was dredged for a canal.  The DEM over the water carries
    the water surface, not the dredged bed, so the ground surface needs a way
    to say "the ground here is really at this level".  A ``BedOverridePolygon``
    is that instruction: inside the ring the ground surface takes ``level_m``
    instead of the DEM; outside, the DEM stands.

    This is the manual half of bathymetry — survey-file import stays Phase 5
    (only the drawn polygon exists now).

    Attributes
    ----------
    label : str
        Human-readable name shown in the bed-override list (e.g. "Canal bed").
    level_m : float
        The bed elevation in the project's vertical datum (m TAW / NAP).  A
        single constant value across the whole polygon.  ``0.0`` is a real
        elevation, never a sentinel.
    vertices : list[tuple[float, float]]
        The polygon ring as ``(x, y)`` in the project's horizontal CRS.  Open
        ring (the closing edge from the last vertex back to the first is
        implicit).  Three or more vertices define an area; fewer is degenerate
        and never contains a point.
    """

    label: str
    level_m: float
    vertices: list[tuple[float, float]]
