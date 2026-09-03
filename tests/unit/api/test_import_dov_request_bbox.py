"""The two DOV import request schemas reject a bad bounding box at parse time.

Rule (Codex row 4): a reversed / degenerate / oversized bbox must be a 422 —
pydantic turns a ``ValueError`` raised in the model validator into the request's
422, so a construction-time ``ValidationError`` here is that 422 at the boundary.
Both the CPT and borehole schemas share ONE validator, so both are exercised.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from groundmodel.api.schemas.borehole.import_borehole_dov_request import (
    ImportBoreholeDovRequest,
)
from groundmodel.api.schemas.cpt.import_dov_request import ImportDovRequest

_SCHEMAS = [ImportDovRequest, ImportBoreholeDovRequest]


@pytest.mark.parametrize("schema", _SCHEMAS)
def test_valid_small_bbox_constructs(schema) -> None:
    """A small Belgian box constructs cleanly on both schemas."""
    schema(west=4.30, south=50.80, east=4.50, north=51.00)


@pytest.mark.parametrize("schema", _SCHEMAS)
def test_reversed_east_west_is_422(schema) -> None:
    """east <= west raises ValidationError naming east/west on both schemas."""
    with pytest.raises(ValidationError) as excinfo:
        schema(west=4.50, south=50.80, east=4.30, north=51.00)
    text = str(excinfo.value).lower()
    assert "east" in text and "west" in text


@pytest.mark.parametrize("schema", _SCHEMAS)
def test_degenerate_bbox_is_422(schema) -> None:
    """A zero-width box raises ValidationError on both schemas."""
    with pytest.raises(ValidationError):
        schema(west=4.30, south=50.80, east=4.30, north=51.00)


@pytest.mark.parametrize("schema", _SCHEMAS)
def test_oversized_bbox_is_422_naming_limit(schema) -> None:
    """A continent-sized box raises ValidationError naming the 625 km² limit."""
    with pytest.raises(ValidationError) as excinfo:
        schema(west=3.0, south=50.0, east=5.0, north=51.5)
    assert "625" in str(excinfo.value)
