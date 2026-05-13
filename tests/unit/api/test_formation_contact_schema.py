"""Schema-level tests for ``FormationContactUpdateRequest`` XOR rules.

These pin the partial-anchor-update validator without needing a DB —
the validator is pure Pydantic. Integration tests in
``tests/integration/api/test_geology.py`` cover the round-trip
behaviour against a real router + session.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from pydantic import ValidationError

from groundmodel.api.schemas.project.formation_contact import (
    FormationContactBatchUpdateEntry,
    FormationContactBatchUpdateRequest,
    FormationContactUpdateRequest,
)


def test_update_request_accepts_no_anchor_fields() -> None:
    """Patches that leave the anchor untouched go through unchanged."""
    req = FormationContactUpdateRequest(depth_top_m=3.0, notes="moved")
    assert req.depth_top_m == 3.0
    assert req.borehole_id is None
    assert req.cpt_id is None


def test_update_request_accepts_anchor_swap_both_fields_present() -> None:
    """borehole → cpt drag-re-anchor sends both fields, one null."""
    new_cpt = uuid4()
    req = FormationContactUpdateRequest(
        depth_top_m=4.5,
        borehole_id=None,
        cpt_id=new_cpt,
    )
    assert req.cpt_id == new_cpt
    assert req.borehole_id is None


def test_update_request_rejects_one_anchor_field_alone() -> None:
    """Sending only cpt_id (without borehole_id) is a partial anchor update."""
    with pytest.raises(ValidationError) as exc:
        FormationContactUpdateRequest(cpt_id=uuid4())
    assert "both borehole_id and cpt_id" in str(exc.value)


def test_update_request_rejects_one_anchor_field_null_alone() -> None:
    """Sending only borehole_id=null (without cpt_id) is still partial — reject.

    Pydantic distinguishes "not in the request" from "in the request as
    null" via ``model_fields_set``; the validator relies on that.
    """
    with pytest.raises(ValidationError):
        FormationContactUpdateRequest(borehole_id=None)


def test_update_request_rejects_both_anchors_non_null() -> None:
    """borehole_id AND cpt_id both set violates the XOR invariant."""
    with pytest.raises(ValidationError) as exc:
        FormationContactUpdateRequest(borehole_id=uuid4(), cpt_id=uuid4())
    assert "exactly one of" in str(exc.value)


def test_update_request_rejects_both_anchors_null() -> None:
    """borehole_id=null AND cpt_id=null leaves the row anchorless — reject."""
    with pytest.raises(ValidationError) as exc:
        FormationContactUpdateRequest(borehole_id=None, cpt_id=None)
    assert "exactly one of" in str(exc.value)


# ---------------------------------------------------------------------------
# Batch entry shape inherits the XOR validator
# ---------------------------------------------------------------------------


def test_batch_entry_inherits_xor_validator() -> None:
    """A batch entry with a partial anchor update is rejected the same way."""
    with pytest.raises(ValidationError):
        FormationContactBatchUpdateEntry(contact_id=uuid4(), cpt_id=uuid4())


def test_batch_request_requires_at_least_one_entry() -> None:
    """min_length=1 — no-op batch calls are rejected."""
    with pytest.raises(ValidationError):
        FormationContactBatchUpdateRequest(updates=[])


def test_batch_request_caps_at_500_entries() -> None:
    """max_length=500 keeps a single transaction bounded."""
    entries = [
        FormationContactBatchUpdateEntry(contact_id=uuid4(), depth_top_m=1.0) for _ in range(501)
    ]
    with pytest.raises(ValidationError):
        FormationContactBatchUpdateRequest(updates=entries)
