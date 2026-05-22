"""Unit tests for ClearLithoModel (debt #94 bugfix).

The use case deletes contacts, edges, surfaces, and orphan litho formations
for a given lithostratigraphic model in a single transaction.

All DB interaction is mocked at the ``session.execute`` boundary.  Row-count
assertions verify the correct bulk-DELETE statements fire; the orphan-formation
guard is tested by controlling the post-contact-delete contact query response.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, call, patch
from uuid import UUID, uuid4

import pytest

from groundmodel.application.clear_litho_model import ClearLithoModel, ClearLithoModelResult

PROJECT_ID: UUID = uuid4()
MODEL_ID: UUID = uuid4()

# Three litho formation ids that the model's contacts point at.
F1: UUID = uuid4()
F2: UUID = uuid4()
F3: UUID = uuid4()  # shared — survives because another model still has a contact


def _make_execute_side_effects(
    *,
    candidate_fids: list[UUID],
    n_contacts: int,
    n_edges: int,
    n_surfaces: int,
    surviving_fids: list[UUID],
    n_formations: int,
) -> list:
    """Return ordered side-effects for the ``session.execute`` mock.

    The use case issues exactly 6 ``session.execute`` calls (in order):

    1. SELECT DISTINCT formation_id for candidate litho formations.
    2. DELETE FormationContact.
    3. DELETE LithoCorrelationEdge.
    4. DELETE FormationSurface.
    5. SELECT DISTINCT surviving formation_id (post-contact-delete).
    6. DELETE GeologicalFormation (orphans only; skipped when candidate_fids is empty).

    When ``candidate_fids`` is empty call 5 + 6 are skipped.
    When all candidates are still referenced, call 6 is skipped.
    """

    def _scalars_result(values: list) -> MagicMock:
        """Mock that mimics ``(await session.execute(stmt)).scalars().all()``."""
        scalars = MagicMock()
        scalars.all.return_value = values
        result = MagicMock()
        result.scalars.return_value = scalars
        return result

    def _rowcount_result(n: int) -> MagicMock:
        """Mock that mimics ``result.rowcount``."""
        result = MagicMock()
        result.rowcount = n
        return result

    effects: list = [
        _scalars_result(candidate_fids),  # 1 — candidate litho fids
        _rowcount_result(n_contacts),  # 2 — DELETE contacts
        _rowcount_result(n_edges),  # 3 — DELETE edges
        _rowcount_result(n_surfaces),  # 4 — DELETE surfaces
    ]
    if candidate_fids:
        effects.append(_scalars_result(surviving_fids))  # 5 — surviving fids
        if len(candidate_fids) > len(surviving_fids):
            # Some orphans exist — formation DELETE fires.
            effects.append(_rowcount_result(n_formations))  # 6 — DELETE formations
    return effects


@pytest.mark.asyncio
async def test_happy_path_all_orphans_deleted() -> None:
    """All litho formations become orphans after the contact delete — all removed."""
    session = AsyncMock()
    session.execute = AsyncMock(
        side_effect=_make_execute_side_effects(
            candidate_fids=[F1, F2],
            n_contacts=4,
            n_edges=1,
            n_surfaces=2,
            surviving_fids=[],  # all orphaned after contact delete
            n_formations=2,
        )
    )
    uc = ClearLithoModel(session)
    result = await uc.execute(PROJECT_ID, MODEL_ID)

    assert isinstance(result, ClearLithoModelResult)
    assert result.contacts == 4
    assert result.edges == 1
    assert result.surfaces == 2
    assert result.formations == 2


@pytest.mark.asyncio
async def test_shared_formation_preserved() -> None:
    """F3 still has contacts in another model — it must not be deleted."""
    session = AsyncMock()
    session.execute = AsyncMock(
        side_effect=_make_execute_side_effects(
            candidate_fids=[F1, F2, F3],
            n_contacts=6,
            n_edges=2,
            n_surfaces=3,
            surviving_fids=[F3],  # F3 is referenced by another model
            n_formations=2,  # only F1 + F2 deleted
        )
    )
    uc = ClearLithoModel(session)
    result = await uc.execute(PROJECT_ID, MODEL_ID)

    assert result.contacts == 6
    assert result.edges == 2
    assert result.surfaces == 3
    assert result.formations == 2  # F3 was skipped


@pytest.mark.asyncio
async def test_empty_model_is_idempotent_no_op() -> None:
    """A model with no contacts at all returns all-zero counts."""
    session = AsyncMock()
    session.execute = AsyncMock(
        side_effect=_make_execute_side_effects(
            candidate_fids=[],  # no litho formations referenced
            n_contacts=0,
            n_edges=0,
            n_surfaces=0,
            surviving_fids=[],
            n_formations=0,
        )
    )
    uc = ClearLithoModel(session)
    result = await uc.execute(PROJECT_ID, MODEL_ID)

    assert result == ClearLithoModelResult(contacts=0, edges=0, surfaces=0, formations=0)


@pytest.mark.asyncio
async def test_geological_formations_not_touched() -> None:
    """Geological formations (litho_main_soil_code IS NULL) are excluded from candidates.

    The use case's step-1 SELECT filters on ``litho_main_soil_code IS NOT
    NULL`` so geological rows never enter the candidate set and therefore
    never reach the formation DELETE.  This test verifies only 4 execute
    calls fire when the project has no litho formations (the candidate set
    comes back empty from the DB side).
    """
    session = AsyncMock()
    # Simulate: the formation_id query (filtered to litho_main_soil_code IS NOT NULL)
    # returns empty — all contacts reference geological formations only.
    session.execute = AsyncMock(
        side_effect=_make_execute_side_effects(
            candidate_fids=[],
            n_contacts=3,  # contacts existed but pointed at geo formations
            n_edges=0,
            n_surfaces=1,
            surviving_fids=[],
            n_formations=0,
        )
    )
    uc = ClearLithoModel(session)
    result = await uc.execute(PROJECT_ID, MODEL_ID)

    assert result.contacts == 3
    assert result.formations == 0
    # Only 4 execute calls: candidate-fid SELECT + 3 DELETEs (no survivor
    # SELECT or formation DELETE because candidate_fids was empty).
    assert session.execute.call_count == 4
