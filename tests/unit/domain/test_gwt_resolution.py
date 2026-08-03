"""The water table a derived value was computed under is always reportable.

The rule, in the engineer's own words: *every surface that shows something
derived from the water table must say which water table it used and where that
number came from* — a value I typed, a value the file recorded, or the app's
assumption when neither exists (Data Integrity Rule 1).

Three source states, one resolver: nothing may resolve a CPT's groundwater
depth by re-implementing the fallback locally.
"""

from __future__ import annotations

from groundmodel.domain.services.gwt_resolution import resolve_gwt
from groundmodel.domain.services.robertson_2015_constants import DEFAULT_GWT_DEPTH_M
from groundmodel.domain.value_objects.water_depth_source import WaterDepthSource


def test_no_recorded_water_table_is_reported_as_assumed() -> None:
    """No record at all → the project-wide assumption, labelled as assumed."""
    resolved = resolve_gwt(water_depth_m=None, water_depth_source=None)

    assert resolved.gwt_m == DEFAULT_GWT_DEPTH_M
    assert resolved.source == "assumed"


def test_a_value_from_the_file_is_reported_as_recorded() -> None:
    """A GEF-parsed water table is a measurement — 'recorded', not 'assumed'."""
    resolved = resolve_gwt(water_depth_m=1.8, water_depth_source=WaterDepthSource.GEF.value)

    assert resolved.gwt_m == 1.8
    assert resolved.source == "recorded"


def test_a_value_the_engineer_typed_is_reported_as_engineer() -> None:
    """An engineer-set water table is neither a measurement nor an assumption."""
    resolved = resolve_gwt(water_depth_m=2.5, water_depth_source=WaterDepthSource.ENGINEER.value)

    assert resolved.gwt_m == 2.5
    assert resolved.source == "engineer"


def test_a_legacy_row_with_a_depth_but_no_source_reads_as_recorded() -> None:
    """Rows written before the provenance column existed can only be file-derived.

    The migration backfills ``'gef'``, but a row that slipped through (or a
    test double built without the column) must not be reported as an
    assumption — the depth IS there, so it was recorded.
    """
    resolved = resolve_gwt(water_depth_m=0.9, water_depth_source=None)

    assert resolved.gwt_m == 0.9
    assert resolved.source == "recorded"
