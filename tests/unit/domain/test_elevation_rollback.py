"""Unit tests for the elevation rollback decision (debt #21).

Pure-function tests — no DB, no I/O. Covers the snapshot-on-first-
override, restore-on-clear, consume-and-re-snapshot, and the pre-#21
no-snapshot fall-throughs.
"""

from __future__ import annotations

from groundmodel.domain.services.elevation_rollback import (
    ElevationState,
    resolve_elevation_change,
)
from groundmodel.domain.value_objects.elevation_source import ElevationSource

_NONE = ElevationState(
    elevation_m=None,
    z_epsg=None,
    source=ElevationSource.NONE.value,
    original_elevation_m=None,
    original_z_epsg=None,
    original_source=None,
)


def _imported(value: float, z: int, source: str) -> ElevationState:
    """An import-stamped row with no snapshot yet."""
    return ElevationState(
        elevation_m=value,
        z_epsg=z,
        source=source,
        original_elevation_m=None,
        original_z_epsg=None,
        original_source=None,
    )


def test_set_on_none_row_stamps_manual_no_snapshot() -> None:
    """Setting a value on a never-imported row → MANUAL, no snapshot."""
    result = resolve_elevation_change(
        _NONE, new_elevation_m=4.2, new_z_epsg=None, default_z_epsg=5710
    )
    assert result.elevation_m == 4.2
    assert result.z_epsg == 5710
    assert result.source == ElevationSource.MANUAL.value
    assert result.original_source is None
    assert result.original_elevation_m is None


def test_first_override_of_dov_import_snapshots_upstream() -> None:
    """First manual override of a DOV Z snapshots the upstream triple."""
    current = _imported(7.42, 5710, ElevationSource.DOV.value)
    result = resolve_elevation_change(
        current, new_elevation_m=9.0, new_z_epsg=None, default_z_epsg=5710
    )
    assert result.elevation_m == 9.0
    assert result.source == ElevationSource.MANUAL.value
    # Upstream DOV triple preserved for a future Clear.
    assert result.original_elevation_m == 7.42
    assert result.original_z_epsg == 5710
    assert result.original_source == ElevationSource.DOV.value


def test_second_manual_edit_keeps_original_snapshot() -> None:
    """Editing an already-overridden row keeps the first snapshot."""
    snapped = ElevationState(
        elevation_m=9.0,
        z_epsg=5710,
        source=ElevationSource.MANUAL.value,
        original_elevation_m=7.42,
        original_z_epsg=5710,
        original_source=ElevationSource.DOV.value,
    )
    result = resolve_elevation_change(
        snapped, new_elevation_m=11.0, new_z_epsg=None, default_z_epsg=5710
    )
    assert result.elevation_m == 11.0
    # Snapshot unchanged — still the original DOV value, not 9.0.
    assert result.original_elevation_m == 7.42
    assert result.original_source == ElevationSource.DOV.value


def test_clear_with_snapshot_restores_and_consumes_it() -> None:
    """Clearing restores the snapshot and clears it (so re-edit re-snaps)."""
    snapped = ElevationState(
        elevation_m=9.0,
        z_epsg=5710,
        source=ElevationSource.MANUAL.value,
        original_elevation_m=7.42,
        original_z_epsg=5710,
        original_source=ElevationSource.GEF.value,
    )
    result = resolve_elevation_change(
        snapped, new_elevation_m=None, new_z_epsg=None, default_z_epsg=5710
    )
    # Restored to the upstream GEF value + source.
    assert result.elevation_m == 7.42
    assert result.z_epsg == 5710
    assert result.source == ElevationSource.GEF.value
    # Snapshot consumed.
    assert result.original_source is None
    assert result.original_elevation_m is None


def test_clear_without_snapshot_returns_to_none() -> None:
    """Pre-#21 behaviour: clearing a pure-manual row drops to NONE."""
    manual = ElevationState(
        elevation_m=3.0,
        z_epsg=5710,
        source=ElevationSource.MANUAL.value,
        original_elevation_m=None,
        original_z_epsg=None,
        original_source=None,
    )
    result = resolve_elevation_change(
        manual, new_elevation_m=None, new_z_epsg=None, default_z_epsg=5710
    )
    assert result.elevation_m is None
    assert result.z_epsg is None
    assert result.source == ElevationSource.NONE.value
    assert result.original_source is None


def test_re_edit_after_restore_snapshots_again() -> None:
    """After a restore, editing again snapshots the restored upstream value."""
    restored = _imported(7.42, 5710, ElevationSource.DOV.value)
    result = resolve_elevation_change(
        restored, new_elevation_m=12.5, new_z_epsg=None, default_z_epsg=5710
    )
    assert result.elevation_m == 12.5
    assert result.source == ElevationSource.MANUAL.value
    assert result.original_elevation_m == 7.42
    assert result.original_source == ElevationSource.DOV.value


def test_explicit_z_epsg_overrides_default_on_set() -> None:
    """A caller-supplied z_epsg wins over the derived default."""
    result = resolve_elevation_change(
        _NONE, new_elevation_m=4.2, new_z_epsg=5709, default_z_epsg=5710
    )
    assert result.z_epsg == 5709


def test_imported_row_with_null_value_not_snapshotted() -> None:
    """A DOV row that never carried a Z (value None) has nothing to snap."""
    no_z_dov = ElevationState(
        elevation_m=None,
        z_epsg=None,
        source=ElevationSource.DOV.value,
        original_elevation_m=None,
        original_z_epsg=None,
        original_source=None,
    )
    result = resolve_elevation_change(
        no_z_dov, new_elevation_m=6.0, new_z_epsg=None, default_z_epsg=5710
    )
    assert result.source == ElevationSource.MANUAL.value
    assert result.original_source is None
