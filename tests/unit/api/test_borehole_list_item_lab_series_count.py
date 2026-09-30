"""The borehole list carries the raw lab-test count per borehole (additive).

Owner dogfeed 2026-09-30: "add mechanical test icon to test in the borehole
overview". The Data stage's borehole rows need to know, without one request per
row, whether a borehole carries a raw lab test (oedometer / triaxial series):
``BoreholeListItem.lab_series_count``. Additive and optional — an answer that
does not count (the elevation PATCH) leaves it ``None``, never a false ``0``.
"""

from __future__ import annotations

from datetime import date
from uuid import uuid4

from groundmodel.api.schemas.borehole.borehole_list_item import BoreholeListItem


def _item(**extra: object) -> BoreholeListItem:
    """A list item with the required header columns."""
    return BoreholeListItem(
        id=uuid4(),
        name="GEO-25/022-B17",
        test_id="GEO-25/022-B17",
        location_x=109140.9,
        location_y=188761.0,
        epsg=31370,
        elevation_m=6.1,
        z_epsg=5710,
        elevation_source="dov",
        drill_method=None,
        borehole_type=None,
        total_depth_m=20.0,
        start_date=date(2025, 3, 1),
        n_drill_segments=1,
        n_field_log_intervals=4,
        **extra,
    )


def test_the_count_is_carried_when_the_list_counted_it() -> None:
    """The list fills in the count."""
    assert _item(lab_series_count=3).model_dump()["lab_series_count"] == 3


def test_an_answer_that_did_not_count_says_none_not_zero() -> None:
    """Additive: old payload shapes still validate, and say nothing about lab tests."""
    assert _item().lab_series_count is None
