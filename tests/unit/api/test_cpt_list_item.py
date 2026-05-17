"""Unit tests for ``CptListItem`` — specifically the additive ``start_date`` field.

These tests verify that:
1. ``start_date`` is present on the schema and optional (defaults to None).
2. A ``CptListItem`` constructed with a known ``file_date`` string round-trips
   the value without any re-parsing or conversion (Data Integrity Rule §2).
3. ``CptListItem`` construction succeeds even when ``start_date`` is absent
   (backwards-compatible default).

No DB, no I/O — pure Pydantic construction.
"""

from __future__ import annotations

import uuid

import pytest

from groundmodel.api.schemas.cpt.cpt_list_item import CptListItem

# Shared minimal kwargs for constructing a valid CptListItem without start_date.
_BASE = {
    "id": uuid.uuid4(),
    "name": "GEO-2026-001",
    "cpt_type": "CPTU",
    "max_depth_m": 20.0,
    "n_rows": 1000,
    "location_x": 200_000.0,
    "location_y": 200_000.0,
    "epsg": 31370,
    "elevation_m": 5.0,
    "z_epsg": 5710,
    "elevation_source": "dov",
}


class TestCptListItemStartDate:
    """Round-trip + default-None checks for the ``start_date`` field."""

    def test_start_date_defaults_to_none_when_omitted(self) -> None:
        """``CptListItem`` must be constructable without ``start_date``.

        The field is optional so older bundle snapshots (and GEF imports that
        do not carry a date) do not break deserialisation.
        """
        item = CptListItem(**_BASE)
        assert item.start_date is None

    def test_start_date_round_trips_dov_iso_string(self) -> None:
        """A DOV-style ISO date string passes through without modification.

        DOV ships dates as ``"YYYY-MM-DD"``; the field stores exactly that
        string. Consumers (the frontend) normalise it via ``parseInvestigationDate``.
        """
        item = CptListItem(**_BASE, start_date="2019-03-14")
        assert item.start_date == "2019-03-14"

    def test_start_date_round_trips_partial_date_string(self) -> None:
        """A year-only or slash-separated source value passes through as-is.

        The schema does NOT validate the format — it is a raw pass-through.
        Parsing/normalisation is a frontend responsibility.
        """
        for raw in ("2005", "2005/07/22", "22-07-2005"):
            item = CptListItem(**_BASE, start_date=raw)
            assert item.start_date == raw, f"Expected {raw!r}, got {item.start_date!r}"

    def test_start_date_none_explicit(self) -> None:
        """Explicitly passing ``None`` is accepted and round-trips correctly."""
        item = CptListItem(**_BASE, start_date=None)
        assert item.start_date is None

    def test_start_date_is_on_the_model(self) -> None:
        """``start_date`` must be listed in the model's field set."""
        assert "start_date" in CptListItem.model_fields

    @pytest.mark.parametrize("date_str", ["2019-03-14", "2000-01-01", None])
    def test_serialisation_round_trip(self, date_str: str | None) -> None:
        """``model_dump`` must echo the value back for all valid inputs."""
        item = CptListItem(**_BASE, start_date=date_str)
        dumped = item.model_dump()
        assert dumped["start_date"] == date_str
