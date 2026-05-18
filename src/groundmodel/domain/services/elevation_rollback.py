"""Pure provenance logic for the elevation rollback column (debt #21).

``set_elevation`` on both ``CptRepository`` and ``BoreholeRepository``
shares the exact same decision: stamp ``MANUAL`` when a value is set,
restore-or-null when it is cleared. This module is the single source of
that decision so the two repositories cannot drift.

The rollback behaviour:

* Setting a value always stamps ``MANUAL`` (so the refresh-on-duplicate
  import path never overwrites a manual correction — debt #8).
* The **first** manual override of a real imported (``DOV`` / ``GEF``)
  Z snapshots that upstream triple — value, vertical CRS, source —
  into the ``original_*`` slots.
* Clearing the value restores that snapshot when one exists (and
  *consumes* it, so a later re-edit snapshots afresh from the restored
  value), giving the user a graceful "undo my typo back to the
  surveyed Z" instead of dropping the row to the no-Z state.
* Clearing with no snapshot (a pure-manual or never-imported row)
  returns the row to the ``NONE`` / no-Z state — the pre-#21 behaviour.

This module is pure: no DB, no I/O, no logging. The caller pre-resolves
the default vertical EPSG (that lookup lives in infrastructure, which
domain must not import) and passes it in.
"""

from __future__ import annotations

from dataclasses import dataclass

from groundmodel.domain.value_objects.elevation_source import ElevationSource

# Sources that represent a real upstream value worth snapshotting before
# a manual override. MANUAL is the user's own value (nothing upstream to
# roll back to); NONE means no Z was ever recorded.
_IMPORTED_SOURCES = frozenset({ElevationSource.DOV.value, ElevationSource.GEF.value})


@dataclass(frozen=True)
class ElevationState:
    """The full elevation-provenance state of a CPT / borehole row.

    Mirrors the six columns the repositories read and write:
    ``elevation_m`` / ``z_epsg`` / ``elevation_source`` plus the
    rollback snapshot triple ``original_elevation_m`` /
    ``original_z_epsg`` / ``original_elevation_source``.

    Attributes
    ----------
    elevation_m : float | None
        Current surface elevation, or ``None`` when no Z is recorded.
    z_epsg : int | None
        Vertical CRS EPSG paired with ``elevation_m``.
    source : str
        ``ElevationSource`` value for ``elevation_m``.
    original_elevation_m : float | None
        Snapshotted upstream elevation, set on the first manual
        override of an imported Z; ``None`` when no snapshot is held.
    original_z_epsg : int | None
        Snapshotted upstream vertical CRS.
    original_source : str | None
        Snapshotted upstream source (always ``dov`` or ``gef`` when a
        snapshot is held); ``None`` means "no snapshot".
    """

    elevation_m: float | None
    z_epsg: int | None
    source: str
    original_elevation_m: float | None
    original_z_epsg: int | None
    original_source: str | None


def resolve_elevation_change(
    current: ElevationState,
    *,
    new_elevation_m: float | None,
    new_z_epsg: int | None,
    default_z_epsg: int,
) -> ElevationState:
    """Compute the new elevation state for a set-or-clear request.

    Parameters
    ----------
    current : ElevationState
        The row's current six-field provenance state.
    new_elevation_m : float | None
        The requested elevation. ``None`` means "clear".
    new_z_epsg : int | None
        Caller-supplied vertical CRS, or ``None`` to fall back to
        ``default_z_epsg`` (only consulted when setting a value).
    default_z_epsg : int
        The canonical vertical EPSG for the row's horizontal CRS,
        pre-resolved by the caller (infrastructure lookup).

    Returns
    -------
    ElevationState
        The state the caller must write back onto the row. All six
        fields are authoritative — the caller assigns each.
    """
    if new_elevation_m is not None:
        resolved_z = new_z_epsg if new_z_epsg is not None else default_z_epsg
        first_override_of_import = (
            current.original_source is None
            and current.source in _IMPORTED_SOURCES
            and current.elevation_m is not None
        )
        if first_override_of_import:
            # Snapshot the upstream triple before stamping MANUAL.
            return ElevationState(
                elevation_m=new_elevation_m,
                z_epsg=resolved_z,
                source=ElevationSource.MANUAL.value,
                original_elevation_m=current.elevation_m,
                original_z_epsg=current.z_epsg,
                original_source=current.source,
            )
        # Already snapshotted, or nothing upstream worth keeping —
        # carry the existing snapshot (if any) through untouched.
        return ElevationState(
            elevation_m=new_elevation_m,
            z_epsg=resolved_z,
            source=ElevationSource.MANUAL.value,
            original_elevation_m=current.original_elevation_m,
            original_z_epsg=current.original_z_epsg,
            original_source=current.original_source,
        )

    # Clearing.
    if current.original_source is not None:
        # Restore the snapshot and consume it so a subsequent edit
        # snapshots afresh from the just-restored upstream value.
        return ElevationState(
            elevation_m=current.original_elevation_m,
            z_epsg=current.original_z_epsg,
            source=current.original_source,
            original_elevation_m=None,
            original_z_epsg=None,
            original_source=None,
        )
    # No snapshot — pre-#21 behaviour: drop to the no-Z state.
    return ElevationState(
        elevation_m=None,
        z_epsg=None,
        source=ElevationSource.NONE.value,
        original_elevation_m=None,
        original_z_epsg=None,
        original_source=None,
    )
