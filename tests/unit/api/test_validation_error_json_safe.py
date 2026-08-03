"""A rejected body containing NaN must still produce a readable 422 (audit F15/F16).

JSON lets a client send a bare ``NaN``. Pydantic rejects it, FastAPI echoes the
offending input back in the 422, and Starlette's strict JSON encoder then
refuses to render that echo — so the validation error escapes and the engineer
sees a 500 for input the API had already judged correctly.
"""

from __future__ import annotations

import json
import math

from groundmodel.api.validation_error_handler import json_safe


def test_a_nan_in_the_error_echo_becomes_renderable() -> None:
    """The scrubbed structure survives a strict JSON encoder."""
    errors = [
        {
            "type": "finite_number",
            "loc": ("body", "layers", 0, "depth_top_m"),
            "msg": "Input should be a finite number",
            "input": math.nan,
        }
    ]
    rendered = json.dumps(json_safe(errors), allow_nan=False)
    assert '"NaN"' in rendered


def test_infinities_are_spelled_out_not_dropped() -> None:
    """The engineer must be able to see WHICH bad number he sent."""
    assert json_safe({"a": math.inf, "b": -math.inf}) == {"a": "Infinity", "b": "-Infinity"}


def test_ordinary_values_pass_through_unchanged() -> None:
    """Scrubbing must not rewrite a normal validation error."""
    payload = {"loc": ["body", "name"], "msg": "Field required", "input": {"depth": 1.5}}
    assert json_safe(payload) == payload
