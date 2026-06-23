"""Pure geotech split-surface interpolator (spec §0.1 step 3).

Interpolate one packing-transition surface, defined by the CPTs that read the
transition, onto every column of a body group (boreholes + too-shallow CPTs
included) so the sub-bodies connect across the group.

Strategy
--------
* **≥ 3 CPT points** — build a TIN via :func:`compute_tin` and evaluate it at
  every column.  Columns that fall outside the TIN footprint (off-triangulation)
  receive the mean of the CPT elevations as a flat fallback.
* **< 3 CPT points** — no triangulation is possible; assign the mean of the
  CPT elevations to every column (flat surface at the observed average).

This is intentionally a pure-domain service: no database access, no framework
imports.  The only external call is into the sibling TIN helpers.
"""

from __future__ import annotations

from dataclasses import dataclass

from groundmodel.domain.services.tin_surface import compute_tin, evaluate_tin_at
from groundmodel.domain.value_objects.contact_point_3d import ContactPoint3D


@dataclass(frozen=True)
class ColumnXY:
    """An investigation's plan-view location used for split-surface interpolation.

    Parameters
    ----------
    investigation_id : str
        Unique identifier for the column (CPT or borehole id).
    x_m : float
        Easting in the project's horizontal CRS (metres).
    y_m : float
        Northing in the project's horizontal CRS (metres).
    """

    investigation_id: str
    x_m: float
    y_m: float


def interpolate_split_elevations(
    cpt_points: list[ColumnXY],
    cpt_elevations: list[float],
    all_columns: list[ColumnXY],
) -> dict[str, float]:
    """Interpolate a packing-transition surface onto every column in the group.

    Each CPT that read the packing transition contributes one control point
    ``(x_m, y_m, elevation_m)``.  The function builds a TIN when ≥ 3 points
    are available (barycentric interpolation inside the triangulation footprint)
    or falls back to a flat mean-elevation surface otherwise.  Columns that
    fall outside the TIN footprint also receive the mean elevation.

    Parameters
    ----------
    cpt_points : list[ColumnXY]
        CPTs that read the transition, in any order.
    cpt_elevations : list[float]
        Transition elevation (m, positive upward) for each element of
        *cpt_points*.  Must be the same length.
    all_columns : list[ColumnXY]
        Every column in the body group (CPTs + boreholes + too-shallow CPTs).
        The returned dict covers all of them.

    Returns
    -------
    dict[str, float]
        Mapping ``investigation_id -> interpolated elevation (m)`` for every
        column in *all_columns*.

    Raises
    ------
    ValueError
        When ``len(cpt_points) != len(cpt_elevations)``.
    """
    if len(cpt_points) != len(cpt_elevations):
        raise ValueError(
            f"cpt_points and cpt_elevations must be the same length "
            f"(got {len(cpt_points)} points and {len(cpt_elevations)} elevations)"
        )

    mean_elev = sum(cpt_elevations) / len(cpt_elevations) if cpt_elevations else 0.0

    if len(cpt_points) >= 3:
        # Build TIN from the CPT control points.  Use the investigation_id as
        # contact_id so the checksum helper (if called later) is stable.
        contacts = [
            ContactPoint3D(
                contact_id=p.investigation_id,
                x_m=p.x_m,
                y_m=p.y_m,
                elevation_m=e,
            )
            for p, e in zip(cpt_points, cpt_elevations)
        ]
        surface = compute_tin(contacts)
        result: dict[str, float] = {}
        for col in all_columns:
            val = evaluate_tin_at(surface, col.x_m, col.y_m)
            # val is None when the column is outside the TIN footprint.
            result[col.investigation_id] = mean_elev if val is None else val
        return result

    # Fewer than 3 CPT points: flat mean surface over every column.
    return {col.investigation_id: mean_elev for col in all_columns}
