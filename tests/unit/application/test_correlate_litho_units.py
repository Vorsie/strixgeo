"""Unit tests for CorrelateLithoUnits (Phase-2 Slice 1).

Covers:
- Happy path: new edge inserted, ordinals resolved, was_created=True.
- Idempotent: existing edge returns was_created=False (no duplicate insert).
- Canonical ordering enforced (b < a supplied → stored as a < b).
- Cross-model / wrong-project rejection (ValueError).
- Self-loop rejection (ValueError).
- Different parent_formation_id rejection (ValueError).
- Different litho_main_soil_code rejection (ValueError).
- #57-class guard: execute() never writes seeded_formation_contact_ids
  and takes no section_id parameter.

No DB or network I/O — session and repository are AsyncMock.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

import pytest

from groundmodel.application.correlate_litho_units import CorrelateLithoUnits

_PROJECT = UUID("00000000-0000-0000-0000-000000000001")
_MODEL = UUID("00000000-0000-0000-0000-000000000002")
_FA = UUID("10000000-0000-0000-0000-000000000000")
_FB = UUID("20000000-0000-0000-0000-000000000000")
_PARENT = UUID("00000000-0000-0000-0000-000000000099")
_SOIL = "ZAND"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_model(project_id: UUID = _PROJECT) -> MagicMock:
    m = MagicMock()
    m.app_project_id = project_id
    return m


def _make_formation(
    fid: UUID,
    project_id: UUID = _PROJECT,
    parent: UUID = _PARENT,
    soil: str = _SOIL,
) -> MagicMock:
    f = MagicMock()
    f.id = fid
    f.app_project_id = project_id
    f.parent_formation_id = parent
    f.litho_main_soil_code = soil
    f.instance_ordinal = None
    f.instance_ordinal_locked = False
    return f


def _scalar_result(value: object) -> MagicMock:
    r = MagicMock()
    r.scalar_one_or_none.return_value = value
    r.scalars.return_value.all.return_value = []
    # run_resolver's depth query is now a single GROUP BY read via .all()
    # (review S2) — make every result also satisfy .all() → [].
    r.all.return_value = []
    return r


def _scalars_result(values: list) -> MagicMock:
    r = MagicMock()
    r.scalar_one_or_none.return_value = None
    r.scalars.return_value.all.return_value = values
    r.all.return_value = []
    return r


def _use_case(session: AsyncMock) -> CorrelateLithoUnits:
    uc = CorrelateLithoUnits(session)
    uc._repo = AsyncMock()
    uc._repo.mark_surfaces_stale = AsyncMock(return_value=0)
    return uc


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_self_loop_raises() -> None:
    """formation_a_id == formation_b_id → ValueError before any DB access."""
    session = AsyncMock()
    uc = _use_case(session)
    with pytest.raises(ValueError, match="itself"):
        await uc.execute(
            project_id=_PROJECT,
            model_id=_MODEL,
            formation_a_id=_FA,
            formation_b_id=_FA,
        )
    session.get.assert_not_called()


@pytest.mark.asyncio
async def test_model_not_in_project_raises() -> None:
    """Model belonging to a different project → ValueError."""
    session = AsyncMock()
    other_project = UUID("00000000-0000-0000-0000-000000000099")
    session.get = AsyncMock(return_value=_make_model(project_id=other_project))
    uc = _use_case(session)
    with pytest.raises(ValueError, match="not found in project"):
        await uc.execute(
            project_id=_PROJECT,
            model_id=_MODEL,
            formation_a_id=_FA,
            formation_b_id=_FB,
        )


@pytest.mark.asyncio
async def test_formation_not_in_project_raises() -> None:
    """Formation belonging to a different project → ValueError."""
    session = AsyncMock()
    other_project = UUID("00000000-0000-0000-0000-000000000099")

    def _get(cls, pk):  # noqa: ANN001
        from groundmodel.infrastructure.db.models.geological_formation_orm import (
            GeologicalFormationOrm,
        )
        from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm

        if cls is GeologicalModelOrm:
            return _make_model(_PROJECT)
        if cls is GeologicalFormationOrm and pk == _FA:
            return _make_formation(_FA, project_id=other_project)
        return _make_formation(pk, project_id=_PROJECT)

    session.get = AsyncMock(side_effect=_get)
    uc = _use_case(session)
    with pytest.raises(ValueError, match="not found in project"):
        await uc.execute(
            project_id=_PROJECT,
            model_id=_MODEL,
            formation_a_id=_FA,
            formation_b_id=_FB,
        )


@pytest.mark.asyncio
async def test_different_parent_raises() -> None:
    """Formations with different parent_formation_id → ValueError."""
    session = AsyncMock()
    other_parent = UUID("00000000-0000-0000-0000-000000000088")

    from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
    from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm

    def _get(cls, pk):  # noqa: ANN001
        if cls is GeologicalModelOrm:
            return _make_model()
        if cls is GeologicalFormationOrm and pk == _FA:
            return _make_formation(_FA, parent=_PARENT)
        return _make_formation(pk, parent=other_parent)

    session.get = AsyncMock(side_effect=_get)
    uc = _use_case(session)
    with pytest.raises(ValueError, match="parent_formation_id"):
        await uc.execute(
            project_id=_PROJECT,
            model_id=_MODEL,
            formation_a_id=_FA,
            formation_b_id=_FB,
        )


@pytest.mark.asyncio
async def test_different_soil_code_raises() -> None:
    """Formations with different litho_main_soil_code → ValueError."""
    session = AsyncMock()

    from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
    from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm

    def _get(cls, pk):  # noqa: ANN001
        if cls is GeologicalModelOrm:
            return _make_model()
        if cls is GeologicalFormationOrm and pk == _FA:
            return _make_formation(_FA, soil="ZAND")
        return _make_formation(pk, soil="KLEI")

    session.get = AsyncMock(side_effect=_get)
    uc = _use_case(session)
    with pytest.raises(ValueError, match="litho_main_soil_code"):
        await uc.execute(
            project_id=_PROJECT,
            model_id=_MODEL,
            formation_a_id=_FA,
            formation_b_id=_FB,
        )


@pytest.mark.asyncio
async def test_canonical_ordering_enforced() -> None:
    """When b < a is supplied, the inserted edge stores (b, a) not (a, b).

    We supply _FB < _FA is false in this fixture, but to test canonical
    ordering: supply them reversed (_FB, _FA) and assert the edge is
    stored with min(_FA,_FB) as formation_a_id.
    """
    # _FA = "10..." < _FB = "20..." so canonical = (_FA, _FB).
    # We supply them as (formation_a=_FB, formation_b=_FA) — reversed.
    inserted: list = []

    session = AsyncMock()

    from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm

    def _get(cls, pk):  # noqa: ANN001
        if cls is GeologicalModelOrm:
            return _make_model()
        return _make_formation(pk)

    session.get = AsyncMock(side_effect=_get)

    # No existing edge.
    no_edge = _scalar_result(None)
    # Resolver: no formations loaded (simplify — we test canonical ordering, not resolver).
    empty = _scalars_result([])

    # existence-check + run_resolver's (formations, depth GROUP BY, edges)
    # + inference trigger: 2 × _load_project_sections (one per formation,
    # returns [] → early return from RecomputeFormationAbsencesForFormation).
    execute_results = [no_edge, empty, empty, empty, empty, empty]
    session.execute = AsyncMock(side_effect=execute_results)
    session.flush = AsyncMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()

    def _add(obj: object) -> None:
        inserted.append(obj)

    session.add = _add
    uc = _use_case(session)

    # Supply reversed order: _FB > _FA.
    result = await uc.execute(
        project_id=_PROJECT,
        model_id=_MODEL,
        formation_a_id=_FB,  # reversed
        formation_b_id=_FA,
    )
    # The inserted edge must have canonical ordering.
    assert len(inserted) == 1
    edge = inserted[0]
    assert edge.formation_a_id == _FA  # min
    assert edge.formation_b_id == _FB  # max
    assert result.was_created is True


@pytest.mark.asyncio
async def test_idempotent_existing_edge_returns_false() -> None:
    """When the edge already exists, was_created=False and no new insert.

    Blocker 3 fix: inference now runs on idempotent re-call too (same path
    as the new-edge branch). The mock must supply the additional execute
    calls consumed by RecomputeFormationAbsencesForFormation._load_project_sections
    (one per formation — both return [] so the inference early-returns).
    """
    inserted: list = []

    session = AsyncMock()

    from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm

    def _get(cls, pk):  # noqa: ANN001
        if cls is GeologicalModelOrm:
            return _make_model()
        return _make_formation(pk)

    session.get = AsyncMock(side_effect=_get)

    existing_edge = MagicMock()
    existing_edge.id = UUID("00000000-0000-0000-0000-000000000055")

    # existence-check + run_resolver's (formations, depth GROUP BY, edges)
    # + inference trigger: 2 × _load_project_sections (one per formation,
    # returns [] → early return from RecomputeFormationAbsencesForFormation).
    edge_result = _scalar_result(existing_edge)
    empty = _scalars_result([])
    session.execute = AsyncMock(side_effect=[edge_result, empty, empty, empty, empty, empty])
    session.flush = AsyncMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    session.add = lambda obj: inserted.append(obj)

    uc = _use_case(session)
    result = await uc.execute(
        project_id=_PROJECT,
        model_id=_MODEL,
        formation_a_id=_FA,
        formation_b_id=_FB,
    )
    assert result.was_created is False
    assert result.edge.id == existing_edge.id
    assert len(inserted) == 0  # no new insert


@pytest.mark.asyncio
async def test_no_section_id_and_no_seeded_ids_in_execute() -> None:
    """CorrelateLithoUnits.execute() signature has no section_id parameter.

    Structural #57 guard: correlations are model-level.  The method
    signature must not accept a section_id argument, and the result must
    not carry seeded_formation_contact_ids or updated_section.
    """
    import inspect

    sig = inspect.signature(CorrelateLithoUnits.execute)
    assert "section_id" not in sig.parameters, (
        "execute() must not have a section_id parameter — correlations are model-level "
        "(#57 structural guard)"
    )

    # Verify the result dataclass lacks section artefacts.
    import dataclasses

    from groundmodel.application.correlate_litho_units import CorrelateResult

    field_names = {f.name for f in dataclasses.fields(CorrelateResult)}
    assert "seeded_formation_contact_ids" not in field_names
    assert "updated_section" not in field_names
    assert "section_id" not in field_names
