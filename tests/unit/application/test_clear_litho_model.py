"""Unit tests for ClearLithoModel (debt #94 bugfix; #133 contact-edge refactor).

The use case deletes contact-correlation edges, contacts, surfaces, and orphan
litho formations for a given lithostratigraphic model in a single transaction.

All DB interaction is mocked at the ``session.execute`` boundary.  Row-count
assertions verify the correct bulk-DELETE statements fire; the orphan-formation
guard is tested by controlling the post-contact-delete contact query response.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

import pytest

from groundmodel.application.clear_litho_model import ClearLithoModel, ClearLithoModelResult

PROJECT_ID: UUID = uuid4()
MODEL_ID: UUID = uuid4()


@pytest.fixture(autouse=True)
def _stub_sections(monkeypatch: pytest.MonkeyPatch) -> AsyncMock:
    """Stub ``CrossSectionRepository`` so the seeded-array prune stays inert.

    Clear runs ``prune_orphan_seeded_ids`` to sweep stale seeded ids after the
    deletes.  The delete-count tests below must remain about the bulk-DELETE
    statements only, so the prune is replaced with an ``AsyncMock`` here and
    exercised by its own test (``test_clear_prunes_orphan_seeded_ids``).
    ``raising=False`` keeps the fixture valid before the import lands (TDD red).
    """
    instance = AsyncMock()
    monkeypatch.setattr(
        "groundmodel.application.clear_litho_model.CrossSectionRepository",
        MagicMock(return_value=instance),
        raising=False,
    )
    return instance


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
    n_bodies: int = 0,
    surviving_fids: list[UUID],
    n_formations: int,
    surviving_fids_from_ll: list[UUID] | None = None,
) -> list:
    """Return ordered side-effects for the ``session.execute`` mock.

    The use case issues these ``session.execute`` calls in order:

    1. SELECT DISTINCT formation_id for candidate litho formations.
    2. DELETE LithoContactCorrelationEdge (edges-first, see use case).
    3. DELETE FormationContact.
    4. DELETE LithoLayer (Shape A — A4 cleanup, picks up
       pending/rejected layers the FC cascade left behind).
    5. DELETE FormationSurface.
    5b. DELETE BodyOrm (body rows with stale null-FK anchors after layer delete).
    6. SELECT DISTINCT surviving formation_id from formation_contact.
    7. SELECT DISTINCT surviving formation_id from litho_layer (A4 cleanup).
    8. DELETE GeologicalFormation (orphans only; skipped when no orphans).

    When ``candidate_fids`` is empty calls 6 + 7 + 8 are skipped.
    When all candidates are still referenced, call 8 is skipped.

    ``surviving_fids_from_ll`` defaults to empty — a formation referenced
    only by a pending/rejected layer on a sibling model survives.
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

    ll_survivors = surviving_fids_from_ll if surviving_fids_from_ll is not None else []
    effects: list = [
        _scalars_result(candidate_fids),  # 1 — candidate litho fids
        _rowcount_result(n_edges),  # 2 — DELETE edges (edges-first)
        _rowcount_result(n_contacts),  # 3 — DELETE contacts
        _rowcount_result(0),  # 4 — DELETE litho_layer (rowcount unused)
        _rowcount_result(n_surfaces),  # 5 — DELETE surfaces
        _rowcount_result(n_bodies),  # 5b — DELETE bodies
    ]
    if candidate_fids:
        effects.append(_scalars_result(surviving_fids))  # 6 — survivors from FC
        effects.append(_scalars_result(ll_survivors))  # 7 — survivors from LL
        combined = set(surviving_fids) | set(ll_survivors)
        if len(candidate_fids) > len(combined & set(candidate_fids)):
            # Some orphans exist — formation DELETE fires.
            effects.append(_rowcount_result(n_formations))  # 8 — DELETE formations
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

    assert result == ClearLithoModelResult(contacts=0, edges=0, surfaces=0, bodies=0, formations=0)


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
    # Only 6 execute calls: candidate-fid SELECT + 5 DELETEs (edges,
    # contacts, litho_layer, surfaces, bodies). No survivor SELECTs or
    # formation DELETE because candidate_fids was empty.
    assert session.execute.call_count == 6


@pytest.mark.asyncio
async def test_clear_prunes_orphan_seeded_ids(_stub_sections: AsyncMock) -> None:
    """After the deletes, Clear sweeps every section's stale seeded ids.

    This is the "clean slate on clear" rule: the contacts the clear just
    deleted (and any historical debris from earlier suggest→accept→delete
    cycles) must be removed from ``seeded_formation_contact_ids``.  The prune
    runs in the same session as the deletes (the caller commits once).
    """
    session = AsyncMock()
    session.execute = AsyncMock(
        side_effect=_make_execute_side_effects(
            candidate_fids=[F1, F2],
            n_contacts=4,
            n_edges=1,
            n_surfaces=2,
            surviving_fids=[],
            n_formations=2,
        )
    )
    uc = ClearLithoModel(session)
    await uc.execute(PROJECT_ID, MODEL_ID)

    _stub_sections.prune_orphan_seeded_ids.assert_awaited_once_with(PROJECT_ID)
