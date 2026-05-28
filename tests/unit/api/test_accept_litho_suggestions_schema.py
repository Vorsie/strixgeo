"""Schema-level tests for ``AcceptLithoSuggestionsRequest`` and
``BatchAcceptLithoSuggestionsRequest`` — specifically the new
``straddle_min_piece_thickness_m`` field (debt #157).

Pure Pydantic validation — no DB, no I/O.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from pydantic import ValidationError

# Avoid E501 on the long module path — import via the package then alias.
import groundmodel.api.schemas.project.litho_suggestion.batch_accept_litho_suggestions_request as _b
from groundmodel.api.schemas.project.litho_suggestion.accept_litho_suggestions_request import (
    AcceptLithoSuggestionsRequest,
)
from groundmodel.api.schemas.project.litho_suggestion.litho_layer_suggestion_item import (
    LithoLayerSuggestionItem,
)

BatchAcceptLithoSuggestionsRequest = _b.BatchAcceptLithoSuggestionsRequest

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_CPT_ID = uuid4()
_SUGGESTION = LithoLayerSuggestionItem(
    depth_top_m=0.0,
    depth_base_m=1.0,
    suggested_lithology="ZAND",  # type: ignore[arg-type]
    suggested_admixtures=[],
    suggested_nad_class=None,
    mean_qc_mpa=None,
    dr_pct=None,
    confidence="high",  # type: ignore[arg-type]
    source="cpt_robertson_2015",
)


def _accept_kwargs(**extra) -> dict:
    """Minimal valid kwargs for ``AcceptLithoSuggestionsRequest``."""
    return {"cpt_id": _CPT_ID, "suggestions": [_SUGGESTION], **extra}


# ---------------------------------------------------------------------------
# AcceptLithoSuggestionsRequest — straddle_min_piece_thickness_m
# ---------------------------------------------------------------------------


def test_accept_request_straddle_defaults_to_020() -> None:
    """``straddle_min_piece_thickness_m`` defaults to 0.20 when absent."""
    req = AcceptLithoSuggestionsRequest(**_accept_kwargs())
    assert req.straddle_min_piece_thickness_m == pytest.approx(0.20)


def test_accept_request_straddle_accepts_valid_value() -> None:
    """A valid in-range value is accepted verbatim."""
    req = AcceptLithoSuggestionsRequest(**_accept_kwargs(straddle_min_piece_thickness_m=0.50))
    assert req.straddle_min_piece_thickness_m == pytest.approx(0.50)


def test_accept_request_straddle_rejects_below_minimum() -> None:
    """Values below 0.01 m are rejected (ge=0.01)."""
    with pytest.raises(ValidationError, match="straddle_min_piece_thickness_m"):
        AcceptLithoSuggestionsRequest(**_accept_kwargs(straddle_min_piece_thickness_m=0.0))


def test_accept_request_straddle_rejects_above_maximum() -> None:
    """Values above 5.0 m are rejected (le=5.0)."""
    with pytest.raises(ValidationError, match="straddle_min_piece_thickness_m"):
        AcceptLithoSuggestionsRequest(**_accept_kwargs(straddle_min_piece_thickness_m=5.1))


# ---------------------------------------------------------------------------
# BatchAcceptLithoSuggestionsRequest — straddle_min_piece_thickness_m
# ---------------------------------------------------------------------------


def test_batch_accept_request_straddle_defaults_to_020() -> None:
    """``straddle_min_piece_thickness_m`` defaults to 0.20 on the batch schema."""
    req = BatchAcceptLithoSuggestionsRequest(anchors=[])
    assert req.straddle_min_piece_thickness_m == pytest.approx(0.20)


def test_batch_accept_request_straddle_accepts_valid_value() -> None:
    """A valid in-range value is accepted verbatim on the batch schema."""
    req = BatchAcceptLithoSuggestionsRequest(anchors=[], straddle_min_piece_thickness_m=1.0)
    assert req.straddle_min_piece_thickness_m == pytest.approx(1.0)


def test_batch_accept_request_straddle_rejects_below_minimum() -> None:
    """Values below 0.01 m are rejected on the batch schema."""
    with pytest.raises(ValidationError, match="straddle_min_piece_thickness_m"):
        BatchAcceptLithoSuggestionsRequest(anchors=[], straddle_min_piece_thickness_m=0.005)


def test_batch_accept_request_straddle_rejects_above_maximum() -> None:
    """Values above 5.0 m are rejected on the batch schema."""
    with pytest.raises(ValidationError, match="straddle_min_piece_thickness_m"):
        BatchAcceptLithoSuggestionsRequest(anchors=[], straddle_min_piece_thickness_m=6.0)


# ---------------------------------------------------------------------------
# AcceptLithoSuggestionsRequest — couple_tolerance_m (#162)
# ---------------------------------------------------------------------------


def test_accept_request_couple_tolerance_defaults_to_020() -> None:
    """``couple_tolerance_m`` defaults to 0.20 when absent."""
    req = AcceptLithoSuggestionsRequest(**_accept_kwargs())
    assert req.couple_tolerance_m == pytest.approx(0.20)


def test_accept_request_couple_tolerance_accepts_valid_value() -> None:
    """A valid in-range value is accepted verbatim."""
    req = AcceptLithoSuggestionsRequest(**_accept_kwargs(couple_tolerance_m=0.50))
    assert req.couple_tolerance_m == pytest.approx(0.50)


def test_accept_request_couple_tolerance_rejects_below_minimum() -> None:
    """Values below 0.01 m are rejected (ge=0.01)."""
    with pytest.raises(ValidationError, match="couple_tolerance_m"):
        AcceptLithoSuggestionsRequest(**_accept_kwargs(couple_tolerance_m=0.0))


def test_accept_request_couple_tolerance_rejects_above_maximum() -> None:
    """Values above 5.0 m are rejected (le=5.0)."""
    with pytest.raises(ValidationError, match="couple_tolerance_m"):
        AcceptLithoSuggestionsRequest(**_accept_kwargs(couple_tolerance_m=6.0))


# ---------------------------------------------------------------------------
# BatchAcceptLithoSuggestionsRequest — couple_tolerance_m (#162)
# ---------------------------------------------------------------------------


def test_batch_accept_request_couple_tolerance_defaults_to_020() -> None:
    """``couple_tolerance_m`` defaults to 0.20 on the batch schema."""
    req = BatchAcceptLithoSuggestionsRequest(anchors=[])
    assert req.couple_tolerance_m == pytest.approx(0.20)


def test_batch_accept_request_couple_tolerance_accepts_valid_value() -> None:
    """A valid in-range value is accepted verbatim on the batch schema."""
    req = BatchAcceptLithoSuggestionsRequest(anchors=[], couple_tolerance_m=0.50)
    assert req.couple_tolerance_m == pytest.approx(0.50)


def test_batch_accept_request_couple_tolerance_rejects_below_minimum() -> None:
    """Values below 0.01 m are rejected on the batch schema."""
    with pytest.raises(ValidationError, match="couple_tolerance_m"):
        BatchAcceptLithoSuggestionsRequest(anchors=[], couple_tolerance_m=0.0)


def test_batch_accept_request_couple_tolerance_rejects_above_maximum() -> None:
    """Values above 5.0 m are rejected on the batch schema."""
    with pytest.raises(ValidationError, match="couple_tolerance_m"):
        BatchAcceptLithoSuggestionsRequest(anchors=[], couple_tolerance_m=6.0)
