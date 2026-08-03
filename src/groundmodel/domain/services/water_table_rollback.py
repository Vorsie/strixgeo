"""Pure provenance logic for the water-table rollback snapshot.

The clear affordance on the Parameters inspector's water-table line offers to
put the value back "the way it was".  For that offer to be TRUE, something has
to remember what it was: the first engineer override otherwise overwrites
``water_depth_m`` in place and the file's number is recoverable only by
re-importing the file.  ``docs/ux.md`` is explicit that copy on a destructive
path is part of the safety rail — a promise the code cannot keep is worse than
no promise.

This is deliberately the SAME shape as ``elevation_rollback`` (debt #21), the
other engineer-editable provenance column:

* Setting a value always stamps ``ENGINEER`` (so the refresh-on-duplicate
  import path never overwrites engineer judgement — the whole Robertson
  normalisation hangs off this number).
* The **first** override of a value that came from the file snapshots that
  pair — depth and source — into the ``original_*`` slots.
* Clearing restores the snapshot when one is held, and *consumes* it, so a
  later re-edit snapshots afresh from the just-restored file value.
* Clearing with no snapshot (a DOV CPT, or a value the engineer invented)
  returns the row to "nothing recorded", where every consumer falls back to
  ``DEFAULT_GWT_DEPTH_M`` and labels the result ASSUMED.

Where it deliberately DIFFERS from the elevation twin: a held snapshot is
signalled by ``original_water_depth_m is not None``, not by the source token.
A row written before the provenance column existed carries a depth with a NULL
source — ``resolve_gwt`` reads that as ``recorded`` — and the one class of row
that predates the column must not be the one class that cannot be undone.

This module is pure: no DB, no I/O, no logging.
"""

from __future__ import annotations

from dataclasses import dataclass

from groundmodel.domain.value_objects.water_depth_source import WaterDepthSource


@dataclass(frozen=True)
class WaterTableState:
    """The full water-table provenance state of a CPT row.

    Mirrors the four columns the repository reads and writes.

    Attributes
    ----------
    water_depth_m : float | None
        Current depth to groundwater below ground surface in metres
        (positive down), or ``None`` when nothing is recorded.
    source : str | None
        ``WaterDepthSource`` value for ``water_depth_m``; ``None`` means
        nothing is recorded (or a legacy row written before the column
        existed, which ``resolve_gwt`` reads as file-derived).
    original_water_depth_m : float | None
        Snapshotted pre-override depth, captured on the first engineer
        override of a recorded value; ``None`` when no snapshot is held.
    original_source : str | None
        Snapshotted pre-override source token.  May legitimately be ``None``
        even while a snapshot IS held (the legacy-row case above), which is
        why the depth — not this field — is the snapshot sentinel.
    """

    water_depth_m: float | None
    source: str | None
    original_water_depth_m: float | None
    original_source: str | None


def resolve_water_table_change(
    current: WaterTableState,
    *,
    new_water_depth_m: float | None,
) -> WaterTableState:
    """Compute the new water-table state for a set-or-clear request.

    Parameters
    ----------
    current : WaterTableState
        The row's current four-field provenance state.
    new_water_depth_m : float | None
        The requested depth below ground surface in metres.  ``None`` means
        "clear" — restore the snapshot if one is held, otherwise return the
        row to "nothing recorded".

    Returns
    -------
    WaterTableState
        The state the caller must write back onto the row.  All four fields
        are authoritative — the caller assigns each.
    """
    if new_water_depth_m is not None:
        first_override_of_a_record = (
            current.original_water_depth_m is None
            and current.water_depth_m is not None
            and current.source != WaterDepthSource.ENGINEER.value
        )
        if first_override_of_a_record:
            # Snapshot the pair the file (or a legacy import) put there,
            # before stamping ENGINEER over it.
            return WaterTableState(
                water_depth_m=new_water_depth_m,
                source=WaterDepthSource.ENGINEER.value,
                original_water_depth_m=current.water_depth_m,
                original_source=current.source,
            )
        # Already snapshotted, or nothing worth keeping (a row that never had
        # a recorded depth) — carry the existing snapshot through untouched so
        # a second edit still rolls back to the FILE's value, not to the first
        # thing the engineer typed.
        return WaterTableState(
            water_depth_m=new_water_depth_m,
            source=WaterDepthSource.ENGINEER.value,
            original_water_depth_m=current.original_water_depth_m,
            original_source=current.original_source,
        )

    # Clearing.
    if current.original_water_depth_m is not None:
        return WaterTableState(
            water_depth_m=current.original_water_depth_m,
            source=current.original_source,
            original_water_depth_m=None,
            original_source=None,
        )
    return WaterTableState(
        water_depth_m=None,
        source=None,
        original_water_depth_m=None,
        original_source=None,
    )
