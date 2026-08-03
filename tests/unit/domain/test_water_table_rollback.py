"""The engineer's water table can be undone back to what the file said.

The rule, in the engineer's own words: *if I type a water table over one the
file recorded, clearing my value must give me the file's number back — not the
app's assumption.*  Until this landed, the clear button's own copy ("back to
the file value or the assumption") promised a restoration the code could not
perform: the first override overwrote ``water_depth_m`` in place, and the
file's number was recoverable only by re-importing the file.

This is the collar-elevation contract (debt #21,
``domain.services.elevation_rollback``) applied to the second engineer-editable
provenance column, and it is deliberately the SAME shape: snapshot on the first
override of a recorded value, restore-and-consume on clear.
"""

from __future__ import annotations

from groundmodel.domain.services.water_table_rollback import (
    WaterTableState,
    resolve_water_table_change,
)
from groundmodel.domain.value_objects.water_depth_source import WaterDepthSource

_NOTHING_RECORDED = WaterTableState(
    water_depth_m=None,
    source=None,
    original_water_depth_m=None,
    original_source=None,
)


def _from_file(depth_m: float) -> WaterTableState:
    """A CPT whose water table came from the GEF header, never edited."""
    return WaterTableState(
        water_depth_m=depth_m,
        source=WaterDepthSource.GEF.value,
        original_water_depth_m=None,
        original_source=None,
    )


def test_the_first_override_of_a_recorded_value_keeps_the_file_number() -> None:
    """WT1 — typing over the file's 1.80 m stores 1.80 m for the undo."""
    after = resolve_water_table_change(_from_file(1.8), new_water_depth_m=3.25)

    assert after.water_depth_m == 3.25
    assert after.source == WaterDepthSource.ENGINEER.value
    assert after.original_water_depth_m == 1.8
    assert after.original_source == WaterDepthSource.GEF.value


def test_clearing_gives_the_file_value_back() -> None:
    """WT2 — the promise the clear button makes: the file's number returns."""
    overridden = resolve_water_table_change(_from_file(1.8), new_water_depth_m=3.25)

    cleared = resolve_water_table_change(overridden, new_water_depth_m=None)

    assert cleared.water_depth_m == 1.8
    assert cleared.source == WaterDepthSource.GEF.value
    # The snapshot is CONSUMED: a later re-edit snapshots afresh from the
    # just-restored file value, so the undo never goes stale by one round.
    assert cleared.original_water_depth_m is None
    assert cleared.original_source is None


def test_a_second_override_does_not_overwrite_the_snapshot() -> None:
    """WT3 — typing 3.25 then 4.10 still rolls back to the file's 1.80 m."""
    first = resolve_water_table_change(_from_file(1.8), new_water_depth_m=3.25)
    second = resolve_water_table_change(first, new_water_depth_m=4.1)

    assert second.original_water_depth_m == 1.8, "the second edit ate the file value"
    assert resolve_water_table_change(second, new_water_depth_m=None).water_depth_m == 1.8


def test_clearing_a_value_the_file_never_had_returns_to_nothing_recorded() -> None:
    """WT4 — no snapshot (a DOV CPT) → back to the honest 'assumed' state."""
    typed = resolve_water_table_change(_NOTHING_RECORDED, new_water_depth_m=2.0)
    assert typed.original_water_depth_m is None, "there was nothing to snapshot"

    cleared = resolve_water_table_change(typed, new_water_depth_m=None)

    assert cleared.water_depth_m is None
    assert cleared.source is None


def test_a_legacy_row_without_a_provenance_token_is_still_restorable() -> None:
    """WT5 — a pre-provenance row carries a depth the parser wrote; keep it.

    ``resolve_gwt`` reads a NULL source beside a depth as ``recorded``, so the
    override path must treat it as a file value too — otherwise the one class
    of row that predates the column is the one class that cannot be undone.
    """
    legacy = WaterTableState(
        water_depth_m=2.4,
        source=None,
        original_water_depth_m=None,
        original_source=None,
    )

    overridden = resolve_water_table_change(legacy, new_water_depth_m=5.0)
    cleared = resolve_water_table_change(overridden, new_water_depth_m=None)

    assert cleared.water_depth_m == 2.4
    assert cleared.source is None


def test_clearing_when_nothing_was_ever_set_is_a_no_op() -> None:
    """WT6 — clearing an already-empty row must not invent a snapshot."""
    cleared = resolve_water_table_change(_NOTHING_RECORDED, new_water_depth_m=None)

    assert cleared == _NOTHING_RECORDED
