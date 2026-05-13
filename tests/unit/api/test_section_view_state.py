"""Regression tests for SectionViewState strict typing (debt #24).

The cross-section ``view_state`` JSONB column accepts a bag of
display-preference keys. Previously the API accepted any keys —
a client shipping ``snap_to_stratigrahpy`` (typo) silently
persisted junk. Now the PATCH body goes through Pydantic
``SectionViewState`` with ``extra='forbid'`` so typos are
surfaced as 422.

Tests below exercise the model directly — no DB, no HTTP.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from groundmodel.api.schemas.project.cross_section import (
    CptChannels,
    CrossSectionUpdateRequest,
    SectionViewState,
)


def test_section_view_state_rejects_unknown_top_level_key() -> None:
    """A typo on the known ``snap_to_stratigraphy`` key surfaces."""
    with pytest.raises(ValidationError) as exc_info:
        SectionViewState(snap_to_stratigrahpy=True)  # missing 'g'
    # Pydantic's "extra fields not permitted" error mentions the
    # bad key by name — the user gets a meaningful 422 detail.
    assert "snap_to_stratigrahpy" in str(exc_info.value)


def test_section_view_state_rejects_unknown_nested_key() -> None:
    """A typo on a nested CPT-channel key surfaces too."""
    with pytest.raises(ValidationError) as exc_info:
        SectionViewState(cpt_channels={"qceee": True})
    assert "qceee" in str(exc_info.value)


def test_section_view_state_rejects_wrong_type() -> None:
    """``column_spacing`` is a number, not a string."""
    with pytest.raises(ValidationError):
        SectionViewState(column_spacing="wide")  # type: ignore[arg-type]


def test_section_view_state_rejects_out_of_range_column_spacing() -> None:
    """``column_spacing`` is bounded to [0.0, 1.0]."""
    with pytest.raises(ValidationError):
        SectionViewState(column_spacing=1.5)
    with pytest.raises(ValidationError):
        SectionViewState(column_spacing=-0.1)


def test_section_view_state_accepts_known_keys() -> None:
    """All four known top-level keys, all valid."""
    vs = SectionViewState(
        cpt_channels={"qc": True, "rf": False},
        borehole_channels={"geotech": True},
        column_spacing=0.7,
        snap_to_stratigraphy=True,
    )
    assert vs.snap_to_stratigraphy is True
    assert vs.column_spacing == 0.7
    assert isinstance(vs.cpt_channels, CptChannels)
    assert vs.cpt_channels.qc is True
    assert vs.cpt_channels.rf is False


def test_section_view_state_accepts_empty_object() -> None:
    """Empty object passes — it's the "clear the bag" sentinel."""
    SectionViewState()  # no error


def test_section_view_state_accepts_partial_cpt_channels() -> None:
    """Single-channel toggle survives strict typing."""
    vs = SectionViewState(cpt_channels={"qTotal": False})
    assert vs.cpt_channels is not None
    assert vs.cpt_channels.qTotal is False


def test_cross_section_update_request_typo_rejected() -> None:
    """End-to-end via the actual PATCH request schema."""
    with pytest.raises(ValidationError):
        CrossSectionUpdateRequest(
            view_state={"snap_to_stratigrahpy": True},  # type: ignore[dict-item]
        )


def test_cross_section_update_request_partial_accepted() -> None:
    """A valid partial view_state body parses cleanly."""
    req = CrossSectionUpdateRequest(
        view_state={"cpt_channels": {"qc": True}},  # type: ignore[dict-item]
    )
    assert req.view_state is not None
    assert req.view_state.cpt_channels is not None
    assert req.view_state.cpt_channels.qc is True


def test_cross_section_update_request_view_state_optional() -> None:
    """``view_state`` omitted entirely → ``None`` (do-not-touch sentinel)."""
    req = CrossSectionUpdateRequest()
    assert req.view_state is None
