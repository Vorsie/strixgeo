"""``view_state.pdf_sheet`` — the cross-section PDF sheet's settings are accepted, junk is not.

The desktop's sheet preview dialog PATCHes its settings into the section's
``view_state`` (docs/superpowers/specs/2026-09-02-section-pdf-sheet-design.md,
"Settings and persistence"). ``SectionViewState`` forbids unknown keys, so the
block must be a typed member, not a free bag — found 2026-09-02 as a 422 on
every settings save.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from groundmodel.api.schemas.project.cross_section import SectionViewState


def _settings() -> dict:
    return {
        "fill": "litho",
        "scaleMode": "fit",
        "hScale": None,
        "vScale": None,
        "vex": 5.0,
        "spacing": 1.0,
        "fields": [
            {"label": "Project", "value": "Kaai 1712"},
            {"label": "Profiel", "value": "CS1"},
            {"label": "Opdrachtgever", "value": ""},
            {"label": "Datum · Auteur", "value": "2026-09-02"},
        ],
    }


def test_the_sheet_settings_block_is_accepted_beside_column_spacing() -> None:
    """A full settings block validates next to the existing column_spacing key."""
    state = SectionViewState.model_validate({"column_spacing": 0.5, "pdf_sheet": _settings()})
    assert state.pdf_sheet is not None
    assert state.pdf_sheet.fill == "litho"
    assert len(state.pdf_sheet.fields) == 4


def test_explicit_scales_carry_positive_denominators() -> None:
    """Explicit mode stores the typed 1:N denominators as positive numbers."""
    s = _settings()
    s.update({"scaleMode": "explicit", "hScale": 1000, "vScale": 200})
    state = SectionViewState.model_validate({"pdf_sheet": s})
    assert state.pdf_sheet is not None and state.pdf_sheet.hScale == 1000


@pytest.mark.parametrize(
    "mutation",
    [
        {"fill": "model"},
        {"scaleMode": "auto"},
        {"spacing": 1.5},
        {"vex": 0},
        {"fields": []},
        {"bogus": 1},
    ],
)
def test_junk_in_the_sheet_block_is_refused(mutation: dict) -> None:
    """An unknown fill, mode, out-of-range slider, wrong field count or extra key is a 422."""
    s = _settings()
    s.update(mutation)
    with pytest.raises(ValidationError):
        SectionViewState.model_validate({"pdf_sheet": s})
