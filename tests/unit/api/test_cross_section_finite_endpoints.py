"""A section's endpoints must be real numbers (audit F15).

A section whose endpoint is NaN cannot be repaired — the distinct-endpoints
guard is an equality test and ``NaN != NaN``, so the zero-length check waves it
through, every later projection / snapshot / export computes with NaN, and the
only way out is deleting the section. JSON carries a bare ``NaN`` literal and
Pydantic v2 accepts it into a ``float`` by default, so the block has to be
declared on the field.

Model-level tests — no DB, no HTTP.
"""

from __future__ import annotations

import math

import pytest
from pydantic import ValidationError

from groundmodel.api.schemas.project.cross_section import (
    CrossSectionCreateRequest,
    CrossSectionUpdateRequest,
)


def _create_kwargs(**overrides: object) -> dict:
    """Valid create body, with the named fields overridden."""
    body = {
        "name": "A-A'",
        "start_x": 150000.0,
        "start_y": 200000.0,
        "end_x": 150500.0,
        "end_y": 200500.0,
        "epsg": 31370,
    }
    body.update(overrides)
    return body


@pytest.mark.parametrize("field", ["start_x", "start_y", "end_x", "end_y"])
def test_creating_a_section_with_a_nan_endpoint_is_rejected(field: str) -> None:
    """A NaN endpoint is refused at the door, not persisted as a broken section."""
    with pytest.raises(ValidationError):
        CrossSectionCreateRequest(**_create_kwargs(**{field: float("nan")}))


@pytest.mark.parametrize("value", [float("inf"), float("-inf")])
def test_creating_a_section_with_an_infinite_endpoint_is_rejected(value: float) -> None:
    """Infinity is the same class of unusable coordinate as NaN."""
    with pytest.raises(ValidationError):
        CrossSectionCreateRequest(**_create_kwargs(end_x=value))


def test_a_nan_endpoint_would_otherwise_slip_past_the_zero_length_guard() -> None:
    """Names the reason the field-level block is needed: NaN != NaN.

    The existing guard rejects a zero-length section by comparing the endpoints.
    NaN is never equal to itself, so a section whose start and end are BOTH NaN
    passes a check whose whole job is stopping unusable geometry.
    """
    assert not (math.nan == math.nan)  # noqa: PLR0124 — the point of the test


def test_patching_an_endpoint_to_nan_is_rejected() -> None:
    """PATCH is the other door into the same columns and must be shut too."""
    with pytest.raises(ValidationError):
        CrossSectionUpdateRequest(start_x=float("nan"))


def test_patching_a_depth_clamp_to_nan_is_rejected() -> None:
    """A NaN depth clamp silently disables the window it is supposed to define."""
    with pytest.raises(ValidationError):
        CrossSectionUpdateRequest(min_depth_m=float("nan"))


def test_ordinary_finite_endpoints_still_validate() -> None:
    """The guard must not cost the normal case anything."""
    request = CrossSectionCreateRequest(**_create_kwargs())
    assert request.start_x == 150000.0
    assert request.end_y == 200500.0
