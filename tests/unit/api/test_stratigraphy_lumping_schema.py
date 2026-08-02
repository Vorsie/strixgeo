"""Unit tests for the stratigraphy-lumping stage request schema.

Pins the two shapes the endpoint has to tell apart:

* ``{"lumping": {...}}`` — a real snapshot to stage.
* ``{"lumping": null}`` / ``{}`` — "no lumping map", which clears the
  slot. NULL is deliberately distinct from an empty ``map``.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from groundmodel.api.schemas.project.stratigraphy_lumping import (
    StratigraphyLumpingStageRequest,
)


def test_lumping_snapshot_round_trips() -> None:
    """A well-formed snapshot parses into the typed sub-object."""
    request = StratigraphyLumpingStageRequest.model_validate(
        {
            "lumping": {
                "schema_version": 1,
                "applied_at": "2026-08-02T09:15:00Z",
                "map": {"klei van boom": "Formatie van Boom"},
            }
        }
    )

    assert request.lumping is not None
    assert request.lumping.map == {"klei van boom": "Formatie van Boom"}


def test_explicit_null_is_accepted_and_means_clear() -> None:
    """``null`` is a legal value — it wipes the slot."""
    request = StratigraphyLumpingStageRequest.model_validate({"lumping": None})
    assert request.lumping is None


def test_omitted_field_defaults_to_none() -> None:
    """An empty body is the same as an explicit clear."""
    request = StratigraphyLumpingStageRequest.model_validate({})
    assert request.lumping is None


def test_empty_map_is_not_null() -> None:
    """An applied-but-groups-nothing map stays a snapshot, not NULL.

    The distinction matters downstream: NULL means the user never ran
    Fill from boreholes; an empty map means they ran it and grouped
    nothing.
    """
    request = StratigraphyLumpingStageRequest.model_validate(
        {"lumping": {"applied_at": "2026-08-02T09:15:00Z", "map": {}}}
    )
    assert request.lumping is not None
    assert request.lumping.map == {}


def test_oversized_map_is_rejected() -> None:
    """The shared ``StratigraphyLumping`` bounds still apply here.

    The endpoint reuses the bundle's validated sub-object rather than
    accepting a raw dict, so the DoS ceilings that protect the .gmproj
    restore path protect this write path too.
    """
    too_many = {str(i): "X" for i in range(2_001)}
    with pytest.raises(ValidationError):
        StratigraphyLumpingStageRequest.model_validate(
            {"lumping": {"applied_at": "2026-08-02T09:15:00Z", "map": too_many}}
        )
