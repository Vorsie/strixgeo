"""Unit tests for SeedLithoFromGeologicalModel.execute.

Tests cover:

Happy path:
- Parent geological model contacts are copied under the litho model_id.
- Created contacts carry source='geological_model_seed' and confidence='medium'.
- observation_id and observation_layer_id are None on created contacts.

Idempotency:
- Re-running skips any (formation_id, borehole_id) pair already in the litho model.
- ``found_contact_ids`` carries the existing contact id; ``skipped_existing`` increments.

Litho-excluded borehole filtering:
- Boreholes in the litho model's ``excluded_borehole_ids`` are skipped even if
  the parent model has contacts for them.
- The PARENT model's exclusion list is NOT applied (Architect Risk 3 correctness).

borehole_ids scope filter:
- When ``borehole_ids`` is provided, only those boreholes are seeded.
- Exclusions from litho's ``excluded_borehole_ids`` still apply on top.

Guard paths:
- Non-lithostratigraphic model raises ValueError.
- Litho model with null parent_geological_model_id raises ValueError.

Source/confidence/null-observation assertions are verified on the created ORM rows.

The DB session is mocked at the ``session.execute`` / ``session.add`` / ``session.get``
boundary; no real DB or network I/O is performed.  Style mirrors
test_auto_populate_contacts_from_stratigraphy.py.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from groundmodel.application.seed_litho_from_geological_model import (
    _SOURCE_LITERAL,
    SeedLithoFromGeologicalModel,
)

# ---------------------------------------------------------------------------
# Helpers — lightweight stand-ins for ORM rows
# ---------------------------------------------------------------------------


def _geo_model(
    *,
    parent_geological_model_id=None,
    excluded_borehole_ids=None,
    kind="geological",
):
    """Stub for a GeologicalModelOrm row (parent geological model)."""
    return SimpleNamespace(
        id=uuid4(),
        kind=kind,
        parent_geological_model_id=parent_geological_model_id,
        excluded_borehole_ids=excluded_borehole_ids or [],
    )


def _litho_model(
    *,
    parent_id,
    excluded_borehole_ids=None,
):
    """Stub for a GeologicalModelOrm row (lithostratigraphic model)."""
    return SimpleNamespace(
        id=uuid4(),
        kind="lithostratigraphic",
        parent_geological_model_id=parent_id,
        excluded_borehole_ids=excluded_borehole_ids or [],
    )


def _contact(
    *,
    model_id,
    formation_id=None,
    borehole_id=None,
    depth_top_m=1.5,
    cpt_id=None,
):
    """Stub for a FormationContactOrm row."""
    return SimpleNamespace(
        id=uuid4(),
        model_id=model_id,
        formation_id=formation_id or uuid4(),
        borehole_id=borehole_id,
        cpt_id=cpt_id,
        depth_top_m=depth_top_m,
        source="borehole_observation",
        confidence="high",
        observation_id=uuid4(),
        observation_layer_id=uuid4(),
    )


def _make_session(
    *,
    litho_model,
    parent_contacts,
    litho_existing_rows=None,
):
    """Build a mock session for a SeedLithoFromGeologicalModel run.

    Ordering of ``session.execute`` calls inside execute():
      1. parent model contacts SELECT (scalars().all())
      2. existing litho contacts SELECT (all())
      3. mark_surfaces_stale UPDATE(s) — intercepted by the patch

    ``session.get`` returns the litho_model stub.
    """
    if litho_existing_rows is None:
        litho_existing_rows = []

    parent_result = MagicMock()
    parent_result.scalars.return_value.all.return_value = parent_contacts

    existing_result = MagicMock()
    existing_result.all.return_value = litho_existing_rows

    # mark_surfaces_stale issues one UPDATE per model_id group; return
    # a rowcount stub for those calls.
    stale_update_result = MagicMock()
    stale_update_result.rowcount = 0

    call_count = 0

    async def side_effect(stmt, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return parent_result
        if call_count == 2:
            return existing_result
        # subsequent calls come from mark_surfaces_stale UPDATE
        return stale_update_result

    session = AsyncMock()
    session.execute = AsyncMock(side_effect=side_effect)
    session.get = AsyncMock(return_value=litho_model)
    session.add = MagicMock()
    session.flush = AsyncMock()
    session.commit = AsyncMock()

    return session


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_happy_path_copies_parent_contacts():
    """Parent contacts are copied under the litho model with correct provenance."""
    parent_id = uuid4()
    formation_id = uuid4()
    borehole_id = uuid4()

    litho = _litho_model(parent_id=parent_id)
    parent_contact = _contact(
        model_id=parent_id,
        formation_id=formation_id,
        borehole_id=borehole_id,
        depth_top_m=3.0,
    )

    session = _make_session(litho_model=litho, parent_contacts=[parent_contact])

    with patch(
        "groundmodel.infrastructure.db.repositories.geology_repository."
        "GeologyRepository.mark_surfaces_stale",
        new_callable=AsyncMock,
        return_value=0,
    ):
        outcome = await SeedLithoFromGeologicalModel(session).execute(
            project_id=uuid4(),
            model_id=litho.id,
            borehole_ids=None,
        )

    assert len(outcome.created_contact_ids) == 1
    assert outcome.skipped_existing == 0
    assert outcome.found_contact_ids == []

    # Verify the row was session.add()'d with correct fields
    added = session.add.call_args_list
    assert len(added) == 1
    new_row = added[0].args[0]
    assert new_row.model_id == litho.id
    assert new_row.formation_id == formation_id
    assert new_row.borehole_id == borehole_id
    assert new_row.depth_top_m == 3.0
    assert new_row.source == _SOURCE_LITERAL
    assert new_row.confidence == "medium"
    assert new_row.observation_id is None
    assert new_row.observation_layer_id is None
    assert new_row.notes is None
    assert new_row.cpt_id is None


# ---------------------------------------------------------------------------
# Source / confidence / null-observation assertions
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_created_contact_source_and_confidence():
    """Created contacts carry source='geological_model_seed' and confidence='medium'."""
    assert _SOURCE_LITERAL == "geological_model_seed"

    parent_id = uuid4()
    litho = _litho_model(parent_id=parent_id)
    parent_contact = _contact(
        model_id=parent_id,
        borehole_id=uuid4(),
        depth_top_m=0.0,
    )

    session = _make_session(litho_model=litho, parent_contacts=[parent_contact])

    with patch(
        "groundmodel.infrastructure.db.repositories.geology_repository."
        "GeologyRepository.mark_surfaces_stale",
        new_callable=AsyncMock,
        return_value=0,
    ):
        outcome = await SeedLithoFromGeologicalModel(session).execute(
            project_id=uuid4(),
            model_id=litho.id,
            borehole_ids=None,
        )

    assert len(outcome.created_contact_ids) == 1
    new_row = session.add.call_args_list[0].args[0]
    assert new_row.source == "geological_model_seed"
    assert new_row.confidence == "medium"
    assert new_row.observation_id is None
    assert new_row.observation_layer_id is None


# ---------------------------------------------------------------------------
# Idempotency
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_idempotency_skips_existing_pair():
    """Re-running skips (formation, borehole) pairs already in the litho model."""
    parent_id = uuid4()
    formation_id = uuid4()
    borehole_id = uuid4()
    existing_contact_id = uuid4()

    litho = _litho_model(parent_id=parent_id)
    parent_contact = _contact(
        model_id=parent_id,
        formation_id=formation_id,
        borehole_id=borehole_id,
    )

    # Existing litho contact row: (id, formation_id, borehole_id) tuple
    litho_existing_rows = [(existing_contact_id, formation_id, borehole_id)]

    session = _make_session(
        litho_model=litho,
        parent_contacts=[parent_contact],
        litho_existing_rows=litho_existing_rows,
    )

    with patch(
        "groundmodel.infrastructure.db.repositories.geology_repository."
        "GeologyRepository.mark_surfaces_stale",
        new_callable=AsyncMock,
        return_value=0,
    ):
        outcome = await SeedLithoFromGeologicalModel(session).execute(
            project_id=uuid4(),
            model_id=litho.id,
            borehole_ids=None,
        )

    # Nothing created; existing contact id in found_contact_ids
    assert outcome.created_contact_ids == []
    assert outcome.skipped_existing == 1
    assert existing_contact_id in outcome.found_contact_ids
    # session.add must NOT have been called
    session.add.assert_not_called()


# ---------------------------------------------------------------------------
# Litho-excluded borehole filtering (Architect Risk 3)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_litho_excluded_boreholes_are_skipped():
    """Boreholes in the litho model's excluded_borehole_ids are not seeded."""
    parent_id = uuid4()
    bh_included = uuid4()
    bh_excluded = uuid4()

    litho = _litho_model(parent_id=parent_id, excluded_borehole_ids=[bh_excluded])

    contact_included = _contact(model_id=parent_id, borehole_id=bh_included, depth_top_m=1.0)
    contact_excluded = _contact(model_id=parent_id, borehole_id=bh_excluded, depth_top_m=2.0)

    session = _make_session(
        litho_model=litho,
        parent_contacts=[contact_included, contact_excluded],
    )

    with patch(
        "groundmodel.infrastructure.db.repositories.geology_repository."
        "GeologyRepository.mark_surfaces_stale",
        new_callable=AsyncMock,
        return_value=0,
    ):
        outcome = await SeedLithoFromGeologicalModel(session).execute(
            project_id=uuid4(),
            model_id=litho.id,
            borehole_ids=None,
        )

    # Only the included borehole's contact is created
    assert len(outcome.created_contact_ids) == 1
    new_row = session.add.call_args_list[0].args[0]
    assert new_row.borehole_id == bh_included


@pytest.mark.asyncio
async def test_parent_exclusions_are_not_applied():
    """The PARENT model's excluded_borehole_ids must NOT gate litho seeding.

    The litho model has no exclusions; the borehole IS in scope.  If the
    code accidentally used the parent model's exclusion list, this
    borehole would be skipped — but we never load the parent model here.
    """
    parent_id = uuid4()
    bh_id = uuid4()

    # litho has NO exclusions — the parent would have excluded bh_id,
    # but we never fetch the parent model in the use case.
    litho = _litho_model(parent_id=parent_id, excluded_borehole_ids=[])
    parent_contact = _contact(model_id=parent_id, borehole_id=bh_id)

    session = _make_session(litho_model=litho, parent_contacts=[parent_contact])

    with patch(
        "groundmodel.infrastructure.db.repositories.geology_repository."
        "GeologyRepository.mark_surfaces_stale",
        new_callable=AsyncMock,
        return_value=0,
    ):
        outcome = await SeedLithoFromGeologicalModel(session).execute(
            project_id=uuid4(),
            model_id=litho.id,
            borehole_ids=None,
        )

    # Borehole must be seeded (parent exclusions are irrelevant)
    assert len(outcome.created_contact_ids) == 1


# ---------------------------------------------------------------------------
# borehole_ids scope filter
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_borehole_ids_scope_limits_seeding():
    """When borehole_ids is provided, only those boreholes are seeded."""
    parent_id = uuid4()
    bh_a = uuid4()
    bh_b = uuid4()

    litho = _litho_model(parent_id=parent_id)
    contact_a = _contact(model_id=parent_id, borehole_id=bh_a)
    contact_b = _contact(model_id=parent_id, borehole_id=bh_b)

    session = _make_session(litho_model=litho, parent_contacts=[contact_a, contact_b])

    with patch(
        "groundmodel.infrastructure.db.repositories.geology_repository."
        "GeologyRepository.mark_surfaces_stale",
        new_callable=AsyncMock,
        return_value=0,
    ):
        # Only ask for bh_a
        outcome = await SeedLithoFromGeologicalModel(session).execute(
            project_id=uuid4(),
            model_id=litho.id,
            borehole_ids=[bh_a],
        )

    assert len(outcome.created_contact_ids) == 1
    new_row = session.add.call_args_list[0].args[0]
    assert new_row.borehole_id == bh_a


@pytest.mark.asyncio
async def test_borehole_ids_and_litho_exclusion_combined():
    """borehole_ids scope AND litho exclusion both apply: intersection is effective."""
    parent_id = uuid4()
    bh_a = uuid4()
    bh_b = uuid4()  # in borehole_ids but excluded by litho model

    litho = _litho_model(parent_id=parent_id, excluded_borehole_ids=[bh_b])
    contact_a = _contact(model_id=parent_id, borehole_id=bh_a)
    contact_b = _contact(model_id=parent_id, borehole_id=bh_b)

    session = _make_session(litho_model=litho, parent_contacts=[contact_a, contact_b])

    with patch(
        "groundmodel.infrastructure.db.repositories.geology_repository."
        "GeologyRepository.mark_surfaces_stale",
        new_callable=AsyncMock,
        return_value=0,
    ):
        outcome = await SeedLithoFromGeologicalModel(session).execute(
            project_id=uuid4(),
            model_id=litho.id,
            borehole_ids=[bh_a, bh_b],  # both requested, but bh_b excluded
        )

    # Only bh_a survives
    assert len(outcome.created_contact_ids) == 1
    new_row = session.add.call_args_list[0].args[0]
    assert new_row.borehole_id == bh_a


# ---------------------------------------------------------------------------
# Guard paths
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_non_litho_model_raises_value_error():
    """A geological model (kind='geological') must be rejected with ValueError."""
    geo_model = _geo_model()  # kind='geological'

    session = AsyncMock()
    session.get = AsyncMock(return_value=geo_model)

    use_case = SeedLithoFromGeologicalModel(session)

    with pytest.raises(ValueError, match="kind="):
        await use_case.execute(
            project_id=uuid4(),
            model_id=geo_model.id,
            borehole_ids=None,
        )


@pytest.mark.asyncio
async def test_litho_model_without_parent_raises_value_error():
    """A lithostratigraphic model with null parent_geological_model_id raises ValueError."""
    # Simulate a mal-formed litho model that somehow has no parent (shouldn't
    # happen through the API, but the use case must guard against it defensively).
    orphan_litho = SimpleNamespace(
        id=uuid4(),
        kind="lithostratigraphic",
        parent_geological_model_id=None,
        excluded_borehole_ids=[],
    )

    session = AsyncMock()
    session.get = AsyncMock(return_value=orphan_litho)

    use_case = SeedLithoFromGeologicalModel(session)

    with pytest.raises(ValueError, match="parent_geological_model_id"):
        await use_case.execute(
            project_id=uuid4(),
            model_id=orphan_litho.id,
            borehole_ids=None,
        )


# ---------------------------------------------------------------------------
# S5 — empty borehole_ids means "no scope", NOT "all boreholes"
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_empty_borehole_ids_creates_nothing():
    """``borehole_ids=[]`` is an explicit empty scope → zero contacts created.

    Regression for the endpoint over-seed bug: ``[]`` must NOT be treated as
    "all boreholes" (that would seed the entire parent model project-wide for
    a section with no in-corridor boreholes).
    """
    parent_id = uuid4()
    litho = _litho_model(parent_id=parent_id)
    parent_contact = _contact(model_id=parent_id, borehole_id=uuid4())

    session = _make_session(litho_model=litho, parent_contacts=[parent_contact])

    with patch(
        "groundmodel.infrastructure.db.repositories.geology_repository."
        "GeologyRepository.mark_surfaces_stale",
        new_callable=AsyncMock,
        return_value=0,
    ):
        outcome = await SeedLithoFromGeologicalModel(session).execute(
            project_id=uuid4(),
            model_id=litho.id,
            borehole_ids=[],  # explicit empty scope
        )

    assert outcome.created_contact_ids == []
    assert outcome.skipped_existing == 0
    session.add.assert_not_called()


# ---------------------------------------------------------------------------
# B3 — idempotent re-run must mark NO surface stale
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_idempotent_rerun_marks_no_surface_stale():
    """A re-run that creates zero contacts must not stale any surface.

    On-click build contract (CLAUDE.md): a surface is stale only when its
    contact set actually changed.  ``mark_surfaces_stale`` must receive an
    empty key set when every (formation, borehole) pair already exists —
    NOT the full in-scope formation set re-derived from the parent.
    """
    parent_id = uuid4()
    formation_id = uuid4()
    borehole_id = uuid4()
    existing_contact_id = uuid4()

    litho = _litho_model(parent_id=parent_id)
    parent_contact = _contact(
        model_id=parent_id, formation_id=formation_id, borehole_id=borehole_id
    )
    # The pair already exists in the litho model → fully skipped.
    litho_existing_rows = [(existing_contact_id, formation_id, borehole_id)]

    session = _make_session(
        litho_model=litho,
        parent_contacts=[parent_contact],
        litho_existing_rows=litho_existing_rows,
    )

    captured_keys: list = []

    async def _capture(keys):
        captured_keys.extend(list(keys))
        return 0

    with patch(
        "groundmodel.infrastructure.db.repositories.geology_repository."
        "GeologyRepository.mark_surfaces_stale",
        new_callable=AsyncMock,
        side_effect=_capture,
    ):
        outcome = await SeedLithoFromGeologicalModel(session).execute(
            project_id=uuid4(),
            model_id=litho.id,
            borehole_ids=None,
        )

    assert outcome.created_contact_ids == []
    # The bug: this would be [(litho.id, formation_id)] if touched_formations
    # were re-derived from parent_contacts instead of accumulated on create.
    assert captured_keys == [], f"idempotent re-run must stale no surface; got {captured_keys}"
