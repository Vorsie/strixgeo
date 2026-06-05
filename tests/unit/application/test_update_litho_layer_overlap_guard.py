"""UpdateLithoLayer's translation of the no-overlap constraint violation.

The ``litho_layer_accepted_no_overlap`` exclusion constraint (migration
f7a8b9c0d1e2) is the hard guarantee — it fires at COMMIT if an edit leaves a
layer overlapping an accepted sibling on the same investigation (the
litho-layer-vs-contact desync class; dogfeed 2026-06-05). The use case must
turn that one DB violation into a clean ``LithoLayerOverlapError`` (→ 409 at
the API) while letting every other integrity error propagate untouched.

These are unit tests: the commit is mocked to raise the relevant
``IntegrityError``, so the translation is verified deterministically without
depending on the FC↔LL trigger chain to manufacture an overlap end-to-end.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from sqlalchemy.exc import IntegrityError

from groundmodel.application.update_litho_layer import UpdateLithoLayer
from groundmodel.shared.exceptions import LithoLayerOverlapError


def _use_case_with_commit_error(commit_error: Exception) -> tuple[UpdateLithoLayer, AsyncMock]:
    """Build an UpdateLithoLayer whose repo finds a row and whose commit raises."""
    session = AsyncMock()
    session.commit = AsyncMock(side_effect=commit_error)
    use_case = UpdateLithoLayer(session)
    # The row exists (truthy) so execute reaches the commit.
    use_case._repo = MagicMock()
    use_case._repo.update_layer = AsyncMock(return_value=MagicMock())
    return use_case, session


async def test_overlap_constraint_violation_becomes_domain_error() -> None:
    """A commit that violates the no-overlap exclusion → LithoLayerOverlapError + rollback."""
    layer_id = uuid4()
    err = IntegrityError(
        "UPDATE litho_layer ...",
        {},
        Exception(
            'conflicting key value violates exclusion constraint "litho_layer_accepted_no_overlap"'
        ),
    )
    use_case, session = _use_case_with_commit_error(err)

    with pytest.raises(LithoLayerOverlapError) as exc_info:
        await use_case.execute(layer_id, {"depth_top_m": 4.5})

    assert exc_info.value.layer_id == layer_id
    session.rollback.assert_awaited_once()


async def test_unrelated_integrity_error_propagates_unchanged() -> None:
    """A different integrity violation is NOT swallowed — it propagates as-is."""
    err = IntegrityError(
        "UPDATE litho_layer ...",
        {},
        Exception('violates foreign key constraint "fk_litho_layer_formation_id"'),
    )
    use_case, session = _use_case_with_commit_error(err)

    with pytest.raises(IntegrityError):
        await use_case.execute(uuid4(), {"formation_id": str(uuid4())})

    # Rolled back, but NOT translated into the domain-specific overlap error.
    session.rollback.assert_awaited_once()
