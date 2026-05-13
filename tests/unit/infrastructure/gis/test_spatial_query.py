"""Unit tests for the mixed-CRS spatial-query guard (debt #16).

These tests don't hit a real PostGIS instance — they verify the
SQL shape the helpers emit (so a future raw spatial query without
the guards is easy to spot in code review) and the validation
behaviour on bogus inputs.
"""

from __future__ import annotations

import pytest
from sqlalchemy import Column
from sqlalchemy.dialects import postgresql

from groundmodel.infrastructure.gis.spatial_query import (
    CANONICAL_QUERY_EPSG,
    assert_consistent_epsg,
    transformed_bbox_filter,
    transformed_distance_filter,
)


def _compile(expression) -> str:
    """Compile a SQLAlchemy clause against the PostgreSQL dialect."""
    return str(
        expression.compile(
            dialect=postgresql.dialect(),
            compile_kwargs={"literal_binds": True},
        )
    )


# ---------------------------------------------------------------------------
# transformed_bbox_filter
# ---------------------------------------------------------------------------


def test_bbox_filter_wraps_column_in_ST_Transform() -> None:
    """The column side ALWAYS goes through ``ST_Transform`` so mixed
    SRIDs in the column collapse to the bbox's SRID before the
    comparison."""
    col = Column("location")
    sql = _compile(transformed_bbox_filter(col, west=4.0, south=51.0, east=5.0, north=52.0))
    # Column wrapped, bbox built with explicit SRID, both sides in
    # CANONICAL_QUERY_EPSG (4326).
    assert "ST_Transform(location," in sql
    assert "ST_MakeEnvelope" in sql
    assert "ST_Within" in sql
    # Both sides of the predicate carry SRID 4326 — the very thing the
    # raw-query bug class would NOT do.
    assert str(CANONICAL_QUERY_EPSG) in sql


def test_bbox_filter_canonical_epsg_is_4326() -> None:
    """WGS84 is the documented canonical CRS for cross-row queries."""
    assert CANONICAL_QUERY_EPSG == 4326


def test_bbox_filter_explicit_bbox_epsg_propagates() -> None:
    """Passing a non-WGS84 ``bbox_epsg`` propagates to BOTH the
    transform target AND the envelope's SRID."""
    col = Column("location")
    sql = _compile(
        transformed_bbox_filter(
            col,
            west=200000,
            south=200000,
            east=210000,
            north=210000,
            bbox_epsg=31370,
        )
    )
    assert "ST_Transform(location, 31370)" in sql
    assert "31370" in sql


@pytest.mark.parametrize(
    "args, message_substring",
    [
        (dict(west=5.0, south=51.0, east=5.0, north=52.0), "west"),
        (dict(west=5.0, south=51.0, east=4.0, north=52.0), "west"),
        (dict(west=4.0, south=52.0, east=5.0, north=51.0), "south"),
        (dict(west=4.0, south=52.0, east=5.0, north=52.0), "south"),
    ],
)
def test_bbox_filter_rejects_degenerate_bbox(args, message_substring) -> None:
    col = Column("location")
    with pytest.raises(ValueError, match=message_substring):
        transformed_bbox_filter(col, **args)


@pytest.mark.parametrize(
    "args, label",
    [
        # Lambert72 metres masquerading as WGS84 degrees — the bug
        # the helper is designed to catch.
        (dict(west=200000.0, south=51.0, east=210000.0, north=52.0), "west"),
        (dict(west=4.0, south=200000.0, east=5.0, north=210000.0), "south"),
        # Wrong hemisphere / typo cases.
        (dict(west=-200.0, south=51.0, east=5.0, north=52.0), "west"),
        (dict(west=4.0, south=51.0, east=5.0, north=200.0), "north"),
    ],
)
def test_bbox_filter_rejects_non_wgs84_corners_when_bbox_epsg_is_wgs84(args, label) -> None:
    """The WGS84 range check fires when ``bbox_epsg`` defaults to 4326
    but the corners are outside [-180,180] × [-90,90] — almost certainly
    a CRS mix-up at the call site."""
    col = Column("location")
    with pytest.raises(ValueError, match=f"bbox {label}"):
        transformed_bbox_filter(col, **args)


def test_bbox_filter_allows_non_wgs84_corners_when_bbox_epsg_set() -> None:
    """Lambert72 metres are fine when the caller explicitly says so."""
    col = Column("location")
    # No raise.
    transformed_bbox_filter(
        col,
        west=200000,
        south=200000,
        east=210000,
        north=210000,
        bbox_epsg=31370,
    )


# ---------------------------------------------------------------------------
# transformed_distance_filter
# ---------------------------------------------------------------------------


def test_distance_filter_uses_geography_cast() -> None:
    """Geography cast forces the metric to metres regardless of source
    SRID — the right tool for proximity queries on mixed-CRS columns."""
    col = Column("location")
    sql = _compile(
        transformed_distance_filter(
            col,
            centre_longitude=4.5,
            centre_latitude=51.0,
            radius_metres=500.0,
        )
    )
    assert "ST_DWithin" in sql
    # Both column-side and centre-side go through a geography cast.
    assert sql.lower().count("cast") >= 2
    assert "ST_MakePoint" in sql
    # The radius lands as a literal at the end of ST_DWithin's args.
    assert "500.0" in sql


@pytest.mark.parametrize(
    "args, message",
    [
        (
            dict(centre_longitude=200.0, centre_latitude=51.0, radius_metres=500.0),
            "centre_longitude",
        ),
        (
            dict(centre_longitude=4.5, centre_latitude=200.0, radius_metres=500.0),
            "centre_latitude",
        ),
        (
            dict(centre_longitude=4.5, centre_latitude=51.0, radius_metres=0.0),
            "radius_metres",
        ),
        (
            dict(centre_longitude=4.5, centre_latitude=51.0, radius_metres=-1.0),
            "radius_metres",
        ),
    ],
)
def test_distance_filter_rejects_bad_inputs(args, message) -> None:
    col = Column("location")
    with pytest.raises(ValueError, match=message):
        transformed_distance_filter(col, **args)


# ---------------------------------------------------------------------------
# assert_consistent_epsg
# ---------------------------------------------------------------------------


def test_assert_consistent_epsg_returns_the_shared_value() -> None:
    assert assert_consistent_epsg([31370, 31370, 31370]) == 31370


def test_assert_consistent_epsg_skips_none() -> None:
    """Rows that legitimately lack a CRS (parser flagged NO_EPSG) shouldn't
    cause a false-positive mixed-CRS error."""
    assert assert_consistent_epsg([31370, None, 31370, None]) == 31370


def test_assert_consistent_epsg_returns_none_on_empty_input() -> None:
    assert assert_consistent_epsg([]) is None
    assert assert_consistent_epsg([None, None]) is None


def test_assert_consistent_epsg_raises_on_mixed() -> None:
    with pytest.raises(ValueError, match=r"Mixed EPSGs.*\[28992, 31370\]"):
        assert_consistent_epsg([31370, 28992, 31370])


def test_assert_consistent_epsg_message_mentions_helper() -> None:
    """The error message names the canonical recovery path — devs hitting
    this for the first time shouldn't have to read this module."""
    with pytest.raises(ValueError, match="transformed_bbox_filter"):
        assert_consistent_epsg([31370, 28992])
