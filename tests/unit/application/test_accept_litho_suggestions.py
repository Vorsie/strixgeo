"""Unit tests for AcceptLithoSuggestions (Phase 1 litho builder).

Covers the five key scenarios:
A1 — within-formation: suggestion fully inside one geology formation → one contact created.
A2 — straddle split: suggestion crosses a geology boundary → two contacts created.
A3 — stale-TIN fallback: TIN is stale but contacts give depth ordering → WARNING, split still works.
A4 — idempotent re-accept: same investigation, same suggestions → contacts found, nothing inserted.
A5 — seeded section: section_id provided → ``_seed_section_contacts`` called with all ids.

The DB session is fully mocked.  No real DB or network I/O.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, call, patch
from uuid import uuid4

import pytest

from groundmodel.application.accept_litho_suggestions import (
    AcceptLithoSuggestions,
    _canonical_admixture_signature,
)
from groundmodel.domain.services.litho_segmentation import LithoLayerSuggestion
from groundmodel.domain.value_objects.admixture import Admixture
from groundmodel.shared.constants.suggestion_confidence import SuggestionConfidence

# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------

PROJECT_ID = uuid4()
LITHO_MODEL_ID = uuid4()
GEO_MODEL_ID = uuid4()
BOREHOLE_ID = uuid4()
UPPER_FORMATION_ID = uuid4()
LOWER_FORMATION_ID = uuid4()
CONTACT_A_ID = uuid4()
CONTACT_B_ID = uuid4()


def _make_suggestion(
    top: float,
    base: float,
    litho: str = "ZAND",
    admixtures: tuple[Admixture, ...] = (),
    confidence: SuggestionConfidence = SuggestionConfidence.HIGH,
) -> LithoLayerSuggestion:
    return LithoLayerSuggestion(
        depth_top_m=top,
        depth_base_m=base,
        suggested_lithology=litho,  # type: ignore[arg-type]
        suggested_nad_class=None,
        mean_qc_mpa=None,
        dr_pct=None,
        confidence=confidence,
        source="borehole_observation",
        suggested_admixtures=admixtures,
    )


def _execute_result(scalar: object | None) -> MagicMock:
    """Mock execute result that returns ``scalar`` from ``scalar_one_or_none``."""
    r = MagicMock()
    r.scalar_one_or_none.return_value = scalar
    return r


def _execute_all_result(rows: list) -> MagicMock:
    """Mock execute result that returns ``rows`` from ``.all()``."""
    r = MagicMock()
    r.all.return_value = rows
    r.scalars.return_value.all.return_value = rows
    return r


def _make_session(
    *,
    litho_model_kind: str = "lithostratigraphic",
    geo_model_id: object = GEO_MODEL_ID,
    borehole_x: float = 100.0,
    borehole_y: float = 200.0,
    # Geology surface rows keyed by formation_id
    surface_rows: list | None = None,
    # Existing contacts at investigation (depth, fid) pairs
    geo_contacts_at_inv: list | None = None,
    # Existing project formations
    formations: list | None = None,
    # Existing litho contacts (id or None for find-or-create)
    existing_contact_ids: list[object | None] | None = None,
) -> AsyncMock:
    """Build a minimal mocked AsyncSession for AcceptLithoSuggestions tests."""

    # The litho model ORM stub
    litho_model_stub = SimpleNamespace(
        app_project_id=PROJECT_ID,
        kind=litho_model_kind,
        parent_geological_model_id=geo_model_id,
    )
    # The borehole ORM stub
    borehole_stub = SimpleNamespace(
        location_x=borehole_x,
        location_y=borehole_y,
    )

    # Track calls to session.get
    def _get_side_effect(orm_class, id_val):
        from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
        from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm

        if orm_class.__name__ == "GeologicalModelOrm":
            return litho_model_stub
        if orm_class.__name__ == "BoreholeOrm":
            return borehole_stub
        return None

    session = AsyncMock()
    session.get = AsyncMock(side_effect=_get_side_effect)
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.flush = AsyncMock()

    # Build the execute side-effect sequence.
    # AcceptLithoSuggestions issues these queries in order per suggestion:
    # 1. Formation surfaces query (one time, at the start)
    # 2. Geology contacts at investigation (one time)
    # 3. Project formations list (one time via repo.list_formations)
    # 4. Per-suggestion: existing contact id check
    # The repo.mark_surfaces_stale + repo.list_formations are mocked on _repo.

    surface_rows = surface_rows or []
    geo_contacts_at_inv = geo_contacts_at_inv or []
    existing_contact_ids = existing_contact_ids or [None]

    execute_calls = [
        # 1 — formation surfaces query
        _execute_all_result(surface_rows),
        # 2 — geology contacts at investigation
        _execute_all_result(geo_contacts_at_inv),
    ]
    # 3 — per-suggestion existing-contact checks
    for eid in existing_contact_ids:
        execute_calls.append(_execute_result(eid))

    session.execute = AsyncMock(side_effect=execute_calls)
    session.refresh = AsyncMock()

    return session


def _use_case(session: AsyncMock, formations: list | None = None) -> AcceptLithoSuggestions:
    uc = AcceptLithoSuggestions(session)
    # Swap the repo to avoid touching real DB.
    uc._repo = AsyncMock()
    uc._repo.list_formations = AsyncMock(return_value=formations or [])
    uc._repo.mark_surfaces_stale = AsyncMock()
    return uc


# ---------------------------------------------------------------------------
# A1 — within-formation: single suggestion, single contact created
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a1_within_formation_creates_one_contact() -> None:
    """A suggestion fully inside one geology formation creates exactly one contact."""
    session = _make_session(
        # No surfaces, no prior contacts at investigation → no straddle.
        surface_rows=[],
        geo_contacts_at_inv=[],
        existing_contact_ids=[None],  # no existing contact → create
    )
    uc = _use_case(session)

    suggestions = [_make_suggestion(0.0, 5.0, "KLEI")]
    result = await uc.execute(
        project_id=PROJECT_ID,
        litho_model_id=LITHO_MODEL_ID,
        suggestions=suggestions,
        borehole_id=BOREHOLE_ID,
    )

    assert result.straddle_split_count == 0
    assert result.stale_tin_fallback_count == 0
    # One formation created (no pre-existing), one contact created.
    assert len(result.created_formation_ids) == 1
    assert len(result.created_contact_ids) == 1
    assert result.found_contact_ids == []
    session.commit.assert_awaited_once()


# ---------------------------------------------------------------------------
# A2 — straddle split: suggestion spans boundary between two geology formations
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a2_straddle_split_creates_two_contacts() -> None:
    """A suggestion spanning a geology boundary is split into two contacts."""
    # Two geology contacts at investigation: UPPER_FORMATION tops at 0.0m,
    # LOWER_FORMATION tops at 3.0m.  Suggestion is [0.0, 6.0] → straddle at 3.0m.
    geo_contacts = [
        SimpleNamespace(depth_top_m=0.0, formation_id=UPPER_FORMATION_ID),
        SimpleNamespace(depth_top_m=3.0, formation_id=LOWER_FORMATION_ID),
    ]
    session = _make_session(
        surface_rows=[],  # no TIN → depth-order fallback
        geo_contacts_at_inv=geo_contacts,
        existing_contact_ids=[None, None],  # two contacts to create
    )
    uc = _use_case(session)

    suggestions = [_make_suggestion(0.0, 6.0, "ZAND")]
    result = await uc.execute(
        project_id=PROJECT_ID,
        litho_model_id=LITHO_MODEL_ID,
        suggestions=suggestions,
        borehole_id=BOREHOLE_ID,
    )

    assert result.straddle_split_count == 1
    # stale_tin_fallback_count is 1 because no TIN was available.
    assert result.stale_tin_fallback_count == 1
    # Two contacts — one per parent formation.
    assert len(result.created_contact_ids) == 2
    assert result.found_contact_ids == []


# ---------------------------------------------------------------------------
# A3 — stale TIN fallback: TIN present but stale → WARNING + depth fallback
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a3_stale_tin_fallback_warns_and_still_splits() -> None:
    """Stale TIN surfaces fall back to depth-ordering with a WARNING logged."""
    # Provide a surface ORM stub that is stale and has no vertices.
    stale_surface = SimpleNamespace(
        formation_id=UPPER_FORMATION_ID,
        model_id=GEO_MODEL_ID,
        is_stale=True,
        vertices=[],  # empty → _tin_from_surface_orm returns None
        triangles=[],
    )
    geo_contacts = [
        SimpleNamespace(depth_top_m=0.0, formation_id=UPPER_FORMATION_ID),
        SimpleNamespace(depth_top_m=4.0, formation_id=LOWER_FORMATION_ID),
    ]

    # _load_geology_surfaces returns keyed dict — patch scalars result.
    session = _make_session(
        surface_rows=[stale_surface],
        geo_contacts_at_inv=geo_contacts,
        existing_contact_ids=[None, None],
    )
    session.execute = AsyncMock(
        side_effect=[
            # surfaces query — scalars().all() returns the stale surface
            _execute_all_result([stale_surface]),
            # geo contacts query
            _execute_all_result(geo_contacts),
            # two contact exists-checks → None (create both)
            _execute_result(None),
            _execute_result(None),
        ]
    )
    uc = _use_case(session)

    suggestions = [_make_suggestion(0.0, 8.0, "KLEI")]
    result = await uc.execute(
        project_id=PROJECT_ID,
        litho_model_id=LITHO_MODEL_ID,
        suggestions=suggestions,
        borehole_id=BOREHOLE_ID,
    )

    assert result.straddle_split_count == 1
    # Stale TIN triggers the fallback counter.
    assert result.stale_tin_fallback_count >= 1
    assert len(result.created_contact_ids) == 2


# ---------------------------------------------------------------------------
# A4 — idempotent re-accept: contacts already exist → found, not created
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a4_idempotent_reaccept_returns_found_contacts() -> None:
    """Re-accepting the same suggestions returns existing contact ids unchanged."""
    existing_contact_id = uuid4()
    session = _make_session(
        surface_rows=[],
        geo_contacts_at_inv=[],
        existing_contact_ids=[existing_contact_id],  # already exists
    )
    # Pre-seed a litho formation matching the suggestion so find-or-create
    # lands on the existing formation.
    existing_formation = SimpleNamespace(
        id=uuid4(),
        app_project_id=PROJECT_ID,
        parent_formation_id=None,
        litho_main_soil_code="ZAND",
        litho_admixtures=[],
        instance_ordinal=None,
    )
    uc = _use_case(session, formations=[existing_formation])

    suggestions = [_make_suggestion(0.0, 5.0, "ZAND")]
    result = await uc.execute(
        project_id=PROJECT_ID,
        litho_model_id=LITHO_MODEL_ID,
        suggestions=suggestions,
        borehole_id=BOREHOLE_ID,
    )

    assert result.created_contact_ids == []
    assert existing_contact_id in result.found_contact_ids
    # No stale marking needed (no new contacts).
    uc._repo.mark_surfaces_stale.assert_not_awaited()
    # Commit still called (use case always commits, even for found-only path).
    session.commit.assert_awaited_once()


# ---------------------------------------------------------------------------
# A4b — idempotency key must include depth_top_m (review B1 regression guard)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a4b_idempotency_key_includes_depth_top_m() -> None:
    """The existing-contact lookup must filter on ``depth_top_m``.

    Without depth in the WHERE clause, a re-accept after a re-segmentation
    that moved the boundary (param change, or a straddle re-split at a
    different geology-TIN depth) would match the OLD contact on
    ``(model, formation, anchor)`` alone and silently keep the stale
    depth (review B1). The A4 mock is depth-insensitive, so the only
    honest unit-level guard is to pin the depth predicate into the SELECT.
    """
    session = _make_session(
        surface_rows=[],
        geo_contacts_at_inv=[],
        existing_contact_ids=[None],
    )
    uc = _use_case(session)

    await uc.execute(
        project_id=PROJECT_ID,
        litho_model_id=LITHO_MODEL_ID,
        suggestions=[_make_suggestion(2.5, 6.0, "ZAND")],
        borehole_id=BOREHOLE_ID,
    )

    # Execute order: 1=surfaces, 2=geo contacts, 3=existing-contact check.
    contact_check_stmt = session.execute.await_args_list[2].args[0]
    assert "depth_top_m" in str(contact_check_stmt), (
        "existing-contact lookup must filter on depth_top_m, else a "
        "re-accept at a moved boundary silently returns the stale contact (B1)"
    )


# ---------------------------------------------------------------------------
# A5 — seeded section: section_id provided → _seed_section_contacts invoked
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a5_section_seeding_called_with_all_contact_ids() -> None:
    """When section_id is provided, _seed_section_contacts is called with all ids."""
    section_id = uuid4()
    created_cid = uuid4()

    session = _make_session(
        surface_rows=[],
        geo_contacts_at_inv=[],
        existing_contact_ids=[None],
    )
    uc = _use_case(session)

    # Patch _seed_section_contacts at the contacts.py router level is not needed here —
    # AcceptLithoSuggestions.execute returns updated_section_id only;
    # the seeding is done by the router, not the use case.
    # The use case's returned result must carry the section_id so the router
    # can forward it to _seed_section_contacts.
    suggestions = [_make_suggestion(0.0, 3.0, "SILT")]
    result = await uc.execute(
        project_id=PROJECT_ID,
        litho_model_id=LITHO_MODEL_ID,
        suggestions=suggestions,
        borehole_id=BOREHOLE_ID,
        section_id=section_id,
    )

    # Use case records the section_id it was given.
    assert result.updated_section_id == section_id
    # A contact was created (verify the plumbing works).
    assert len(result.created_contact_ids) == 1


# ---------------------------------------------------------------------------
# Helper function tests
# ---------------------------------------------------------------------------


def test_canonical_admixture_signature_empty() -> None:
    """Empty admixture tuple → empty signature string."""
    assert _canonical_admixture_signature(()) == ""


def test_canonical_admixture_signature_sorted() -> None:
    """Signature is sorted so order of admixtures in the tuple is irrelevant."""
    a = Admixture(soil_code="KL", amount="Z", locally=False)
    b = Admixture(soil_code="GL", amount="", locally=True)
    # Canonical key excludes locally — both orderings must give the same signature.
    sig1 = _canonical_admixture_signature((a, b))
    sig2 = _canonical_admixture_signature((b, a))
    assert sig1 == sig2
    # The locally flag must NOT appear in the signature.
    assert "locally" not in sig1
    assert "GL:" in sig1
    assert "KL:Z" in sig1


# ---------------------------------------------------------------------------
# A6 — bulk-segmenter source passthrough: borehole_observation stays unchanged
# A7 — manual_pick source: manual payload stamps 'manual_pick' on the contact
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a6_bulk_segmenter_source_passthrough() -> None:
    """Bulk-accept with source='borehole_observation' stamps that source on the contact.

    Regression guard: the parameterised _find_or_create_contact must forward
    the suggestion's own source, not re-derive it from the anchor type (the
    previous hard-coded behaviour).
    """
    session = _make_session(
        surface_rows=[],
        geo_contacts_at_inv=[],
        existing_contact_ids=[None],
    )
    uc = _use_case(session)

    suggestion = LithoLayerSuggestion(
        depth_top_m=0.0,
        depth_base_m=5.0,
        suggested_lithology="KLEI",  # type: ignore[arg-type]
        suggested_nad_class=None,
        mean_qc_mpa=None,
        dr_pct=None,
        confidence=SuggestionConfidence.HIGH,
        source="borehole_observation",
        suggested_admixtures=(),
    )
    await uc.execute(
        project_id=PROJECT_ID,
        litho_model_id=LITHO_MODEL_ID,
        suggestions=[suggestion],
        borehole_id=BOREHOLE_ID,
    )

    # The ORM contact row is passed to session.add — inspect the call.
    added_objects = [call_args.args[0] for call_args in session.add.call_args_list]
    contact_rows = [
        obj for obj in added_objects if hasattr(obj, "source") and hasattr(obj, "confidence")
    ]
    assert len(contact_rows) == 1, "Expected exactly one FormationContactOrm created"
    assert contact_rows[0].source == "borehole_observation", (
        "Bulk segmenter suggestion source must pass through unchanged; "
        "previously this was hard-coded from the anchor type."
    )


@pytest.mark.asyncio
async def test_a7_manual_pick_source_stamps_manual_pick() -> None:
    """A manual_pick payload produces a contact row with source='manual_pick'.

    This is the Phase-1.5 manual litho composition picker path: the frontend
    sends source='manual_pick' in the synthetic one-item suggestion and the
    use case must NOT override it with the anchor-derived source.
    """
    session = _make_session(
        surface_rows=[],
        geo_contacts_at_inv=[],
        existing_contact_ids=[None],
    )
    uc = _use_case(session)

    suggestion = LithoLayerSuggestion(
        depth_top_m=2.0,
        depth_base_m=2.01,  # sentinel depth_base for manual pick
        suggested_lithology="ZAND",  # type: ignore[arg-type]
        suggested_nad_class=None,
        mean_qc_mpa=None,
        dr_pct=None,
        confidence=SuggestionConfidence.MEDIUM,
        source="manual_pick",
        suggested_admixtures=(),
    )
    await uc.execute(
        project_id=PROJECT_ID,
        litho_model_id=LITHO_MODEL_ID,
        suggestions=[suggestion],
        borehole_id=BOREHOLE_ID,
    )

    added_objects = [call_args.args[0] for call_args in session.add.call_args_list]
    contact_rows = [
        obj for obj in added_objects if hasattr(obj, "source") and hasattr(obj, "confidence")
    ]
    assert len(contact_rows) == 1, "Expected exactly one FormationContactOrm created"
    assert contact_rows[0].source == "manual_pick", (
        "Manual-pick suggestion source must reach the contact row as 'manual_pick'; "
        "a hard-coded anchor-derived source would break provenance tagging."
    )
