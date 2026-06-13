"""Stage 2 of the implicit stratigraphic field builder: build tagged 3D control data.

This module is purely functional — no I/O, no logging, no framework dependencies.
It takes per-investigation contact observations and user-drawn section contacts,
then emits the :class:`StratControlData` that Stage 3 (the potential-field solver)
consumes.

Why this stage exists
---------------------
The Stage-1 output (:class:`~groundmodel.domain.services.strat_field.strat_types.StratColumn`)
tells us WHICH stratigraphic horizons exist and assigns each an iso-value; it
carries the ``contact_ids`` that link a domain contact record to its horizon.
This stage bridges the domain observation data (depths in investigation columns,
polylines in section space) to the spatial domain the solver needs:

  contact observation → depth → elevation (TAW) → ControlPoint(x, y, z, rank)

Why rank-0 and rank-N are skipped
----------------------------------
Rank 0 is the SURFACE horizon (the top of the shallowest stratigraphic instance).
Its contact_ids come from the top of the uppermost unit, which is always at or
near ground level.  This horizon is constrained by the DEM / ground surface, not
by an observed subsurface contact, so placing a control point here would duplicate
the Stage-4 DEM constraint with noisy near-surface borehole depth data.

Rank N is the FLOOR horizon (the open base of the model).  It carries no
contact_ids by construction (see ``build_stratigraphic_order``) — there are no
accepted contacts at the open base — so it can never contribute control points.

Why the gradient direction is vertical-DOWN for v1
--------------------------------------------------
Our field convention is fixed by Stage 1: ``iso_value = float(rank)`` with
rank 0 = shallowest/youngest and rank N = deepest/oldest, so the scalar field F
INCREASES WITH DEPTH (deeper = higher rank = higher iso-value).  This is exactly
what the Stage-4 monotonicity gate requires ("F strictly increases DOWN every
borehole").  The gradient of F (the direction of increasing F) therefore points
DOWNWARD, so the orientation unit vector is (0, 0, -1) — a unit vector in the
−z direction (z is positive-up).  Matching ``OrientationConstraint.gz``'s own
contract ("positive gz → field increases upward"), a downward-increasing F means
gz is negative.  Getting this sign right matters: a +z orientation would fight
the value constraints and bubble the field near every borehole.

Version 1 ships this constant orientation; a future refinement could derive the
local dip vector from adjacent section-contact slopes and project it onto the
horizon plane, producing a more accurate in-plane orientation at each
investigation.  That refinement is deferred: the vertical prior is correct for
flat-to-gently-dipping BE/NL stratigraphy and keeps the Stage-2 code
dependency-free (no NumPy required here).

Why the section-line projection formula is along/length
-------------------------------------------------------
A section line is parameterised as a 1-D coordinate ``along_m`` measured from
endpoint A.  Converting to map (x, y) is a simple linear interpolation:

  x = ax + (bx - ax) * (along_m / length)
  y = ay + (by - ay) * (along_m / length)

This is exact for a straight section line.  Curved section lines (polylines) are
not yet supported in v1; if ``along_m`` exceeds the section length the point is
clamped to the endpoint rather than extrapolated off the line.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass

from groundmodel.domain.services.strat_field.strat_types import (
    ControlPoint,
    OrientationConstraint,
    StratColumn,
    StratControlData,
)

# ---------------------------------------------------------------------------
# Input value objects (Stage 2 local — not shared with Stage 1 or 3)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ContactObservation:
    """One accepted contact in a single investigation column.

    Mirrors :class:`~groundmodel.domain.services.strat_field.stratigraphic_order.OrderInputUnit`
    but adds the spatial depth so the contact can be projected to an elevation.
    The ``contact_id`` is the primary key that links this observation to a
    :class:`~groundmodel.domain.services.strat_field.strat_types.Horizon` via
    the ``rank_by_contact_id`` index built from the StratColumn.

    Parameters
    ----------
    instance_key : str
        Resolver body identity — the same key used in Stage 1.
    formation_id : str
        Lithology identifier (e.g. ``"ZAND"``, ``"KLEI"``).
    contact_id : str
        ``formation_contact.id`` of the contact at the TOP of this unit.
        Resolved to a horizon rank via the StratColumn's contact_ids.
    top_depth_m : float
        Depth below the investigation's ground surface (metres, positive downward)
        to this unit's top contact.  The contact's elevation is computed as
        ``surface_elev_m - top_depth_m``.
    """

    instance_key: str
    formation_id: str
    contact_id: str
    top_depth_m: float


@dataclass(frozen=True)
class InvestigationColumn:
    """All accepted contacts from one borehole or CPT location.

    Parameters
    ----------
    investigation_id : str
        Domain identifier for the investigation (e.g. ``"bh-01"`` or a UUID).
    x : float
        Easting in metres (project CRS, Lambert-72 for BE/NL).
    y : float
        Northing in metres (project CRS).
    surface_elev_m : float
        Ground surface elevation in metres (positive upward, TAW/NAP datum).
        All contact elevations are derived as ``surface_elev_m - unit.top_depth_m``.
    units : tuple of ContactObservation
        Ordered top → bottom sequence of accepted contacts.  The topmost unit's
        contact maps to rank 0 (the surface horizon) and is skipped; all
        subsequent contacts map to internal horizons and become control points.
    """

    investigation_id: str
    x: float
    y: float
    surface_elev_m: float
    units: tuple[ContactObservation, ...]


@dataclass(frozen=True)
class SectionContact:
    """A user-drawn contact polyline on a cross-section.

    The polyline is stored as ``(along_m, elevation_m)`` samples along the
    section line.  Each sample is projected to map (x, y, z) coordinates and
    emitted as a :class:`ControlPoint` for the horizon identified by
    ``contact_id``.

    Parameters
    ----------
    section_ax : float
        Easting of the section's start point A (metres, project CRS).
    section_ay : float
        Northing of the section's start point A (metres, project CRS).
    section_bx : float
        Easting of the section's end point B (metres, project CRS).
    section_by : float
        Northing of the section's end point B (metres, project CRS).
    samples : tuple of (float, float)
        Polyline vertices as ``(along_m, elevation_m)`` pairs.
        ``along_m`` is the distance from point A along the section line.
        ``elevation_m`` is the elevation in metres (TAW/NAP datum).
    contact_id : str
        ``formation_contact.id`` that identifies which horizon this drawn
        contact constrains.  Resolved to a horizon rank via the StratColumn.
    """

    section_ax: float
    section_ay: float
    section_bx: float
    section_by: float
    samples: tuple[tuple[float, float], ...]
    contact_id: str


# ---------------------------------------------------------------------------
# Vertical gradient constant (v1 orientation prior)
# ---------------------------------------------------------------------------

# F increases WITH DEPTH (iso_value = rank, rank 0 shallowest → rank N deepest),
# so the gradient of F (direction of increasing F) points DOWNWARD: (0, 0, -1).
# See the "Why the gradient direction is vertical-DOWN" docstring section above —
# this is the sign the Stage-4 monotonicity gate ("F increases down a borehole")
# requires, and it matches OrientationConstraint.gz (negative gz = F up-decreasing).
_GRADIENT_DOWN: tuple[float, float, float] = (0.0, 0.0, -1.0)


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


def build_control_data(
    columns_with_xyz: Sequence[InvestigationColumn],
    section_contacts: Sequence[SectionContact],
    order: StratColumn,
) -> StratControlData:
    """Build the tagged 3D control data for the implicit potential-field solver.

    Converts accepted domain contacts (at investigation locations and on drawn
    section lines) into :class:`~groundmodel.domain.services.strat_field.strat_types.ControlPoint`
    objects tagged with the horizon rank that the potential field must equal at
    that location, plus
    :class:`~groundmodel.domain.services.strat_field.strat_types.OrientationConstraint`
    objects that encode the local gradient direction (vertical-up in v1).

    Parameters
    ----------
    columns_with_xyz : Sequence of InvestigationColumn
        Per-investigation columns ordered in any spatial order.  Each column
        carries x/y position, surface elevation, and accepted contacts.
    section_contacts : Sequence of SectionContact
        User-drawn contact polylines on cross-sections.  May be empty.
    order : StratColumn
        The global stratigraphic column produced by Stage 1
        (``build_stratigraphic_order``).  Provides the contact_id → rank
        index and is carried through unchanged to the output.

    Returns
    -------
    StratControlData
        A bundle of control points, orientation constraints, and the input
        StratColumn ready for Stage 3.

    Notes
    -----
    Only INTERNAL horizons (``1 <= rank <= N-1``) produce control points.
    Rank 0 (surface) is constrained by the DEM; rank N (floor) has no
    accepted contact_ids.  A ``contact_id`` not present in the order index
    is silently skipped — this is a defensive miss, not a data error, because
    contacts may have been deleted from the model after the order was built.
    """
    # Step 1 — build the contact_id → rank index from the StratColumn.
    #
    # Each Horizon carries a contact_ids tuple; every id in that tuple maps to
    # the horizon's rank.  The surface (rank 0) and floor (rank N = last horizon)
    # are included in this index, so the skip logic below is a single
    # "1 <= rank <= N-1" guard rather than a separate contact_id exclusion set.
    rank_by_contact_id: dict[str, int] = {}
    n_horizons = len(order.horizons)
    floor_rank = n_horizons - 1  # rank N — the FLOOR horizon (no contact_ids, but guard anyway)

    for horizon in order.horizons:
        for cid in horizon.contact_ids:
            rank_by_contact_id[cid] = horizon.rank

    control_points: list[ControlPoint] = []
    orientations: list[OrientationConstraint] = []

    # Step 2 — borehole / CPT control points.
    #
    # For each investigation column, convert each unit's top-contact to a 3D
    # ControlPoint.  Skip rank 0 (surface — DEM-constrained) and rank N (floor —
    # no contact_ids by construction).  Skip any contact_id absent from the index
    # (defensive miss: the contact was deleted from the model after the order was
    # built, or it belongs to a section not included in this solve).
    for col in columns_with_xyz:
        for unit in col.units:
            rank = rank_by_contact_id.get(unit.contact_id)
            if rank is None:
                # Defensive miss: contact_id not in the stratigraphic order.
                # Silently skip rather than crashing — the solver proceeds with
                # the remaining constraints, which is better than a hard abort.
                continue
            if not (1 <= rank < floor_rank):
                # Skip the surface horizon (rank 0) and the floor horizon (rank N).
                # The surface is constrained by the DEM at Stage 4; the floor
                # carries no contact_ids and would never reach here, but the guard
                # is explicit for clarity.
                continue

            z = col.surface_elev_m - unit.top_depth_m
            control_points.append(ControlPoint(x=col.x, y=col.y, z=z, horizon_rank=rank))

        # One vertical (down-pointing) orientation constraint per investigation,
        # anchored at the investigation's map position and surface elevation — the
        # one z guaranteed to exist even when the column has no accepted internal
        # contacts (no column-thickness arithmetic needed).
        orientations.append(
            OrientationConstraint(
                x=col.x,
                y=col.y,
                z=col.surface_elev_m,
                gx=_GRADIENT_DOWN[0],
                gy=_GRADIENT_DOWN[1],
                gz=_GRADIENT_DOWN[2],
            )
        )

    # Step 3 — section-drawn control points.
    #
    # Each SectionContact is a polyline in (along_m, elevation_m) space along a
    # straight section line from (ax, ay) to (bx, by).  Convert each sample to
    # map (x, y, z) via linear interpolation along the section direction.
    for sec in section_contacts:
        rank = rank_by_contact_id.get(sec.contact_id)
        if rank is None:
            # contact_id not in the order — defensive skip, same as above.
            continue
        if not (1 <= rank <= floor_rank - 1):
            # Surface / floor contacts from section drawings are also skipped.
            continue

        dx = sec.section_bx - sec.section_ax
        dy = sec.section_by - sec.section_ay
        section_length = math.sqrt(dx * dx + dy * dy)

        if section_length == 0.0:
            # Degenerate section (both endpoints identical) — no spatial extent,
            # skip to avoid division by zero.
            continue

        for along_m, elevation_m in sec.samples:
            # Clamp along_m to [0, length] so a sample slightly outside the
            # section endpoints does not extrapolate off the line into unsampled
            # territory.
            t = max(0.0, min(along_m, section_length)) / section_length
            x = sec.section_ax + dx * t
            y = sec.section_ay + dy * t
            control_points.append(ControlPoint(x=x, y=y, z=elevation_m, horizon_rank=rank))

    return StratControlData(
        points=tuple(control_points),
        orientations=tuple(orientations),
        column=order,
    )
