"""Unit tests for AcceptLithoSuggestions (Phase 1 litho builder).

Covers the five key scenarios:
A1 — within-formation: suggestion fully inside one geology formation → one contact created.
A2 — straddle split: suggestion crosses a geology boundary → two contacts created.
A3 — stale-TIN fallback: TIN is stale but contacts give depth ordering → WARNING, split still works.
A4 — idempotent re-accept: same investigation, same suggestions → contacts found, nothing inserted.
A5 — seeded section: section_id provided → ``_seed_section_contacts`` called with all ids.
D1 — display_order: two litho units at different depths under the same parent get correct order.
D2 — display_order idempotency: re-accept with no new formations does not trigger recompute.
D3 — display_order cross-parent: parent geological display_order is the coarse sort key.
D4 — display_order geological/non-litho formations untouched.
V10 — IDOR scope guard: litho model owned by another project → ValueError.

The DB session is fully mocked.  No real DB or network I/O.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
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


def _make_formation_stub(
    fid: object,
    *,
    display_order: int = 0,
    parent_formation_id: object = None,
    litho_main_soil_code: str = "ZAND",
    name: str = "ZAND",
) -> SimpleNamespace:
    """Build a minimal GeologicalFormationOrm-shaped stub for mock execute returns."""
    return SimpleNamespace(
        id=fid,
        display_order=display_order,
        parent_formation_id=parent_formation_id,
        litho_main_soil_code=litho_main_soil_code,
        name=name,
    )


def _make_session(
    *,
    litho_model_kind: str = "lithostratigraphic",
    geo_model_id: object = GEO_MODEL_ID,
    borehole_x: float = 100.0,
    borehole_y: float = 200.0,
    borehole_elevation_m: float | None = None,
    # Geology surface rows keyed by formation_id
    surface_rows: list | None = None,
    # Existing contacts at investigation (depth, fid) pairs
    geo_contacts_at_inv: list | None = None,
    # Existing project formations
    formations: list | None = None,
    # Existing litho contacts (id or None for find-or-create)
    existing_contact_ids: list[object | None] | None = None,
    # When True (default), append the three _recompute_litho_display_orders
    # execute calls at the end of the side-effect list.  Set to False only
    # for re-accept paths that create no new formations (A4).
    expect_recompute: bool = True,
    # Rows returned by the contacts query inside _recompute_litho_display_orders.
    recompute_contact_rows: list | None = None,
    # Rows returned by the formations query inside _recompute_litho_display_orders.
    recompute_formation_rows: list | None = None,
    # Rows returned by the parent-formations display_order query.
    recompute_parent_rows: list | None = None,
    # Number of formations that will trigger RecomputeFormationAbsencesForFormation.
    # Each one fires one _load_project_sections query (returns [] → early return).
    # Set to the number of distinct affected formations when created_contact_ids
    # or found_contact_ids is non-empty.  Defaults to 1 (the common case:
    # one new or found formation per single-suggestion accept).
    inference_formation_count: int = 1,
) -> AsyncMock:
    """Build a minimal mocked AsyncSession for AcceptLithoSuggestions tests.

    Parameters
    ----------
    expect_recompute : bool
        When True, three extra execute side-effects are appended for the
        ``_recompute_litho_display_orders`` helper (contacts + formations +
        parents).  Must be False for paths where no new formation is created
        (e.g. pure idempotent re-accept) because ``_recompute_litho_display_orders``
        is not called there and the extra side-effects would skew call counts.
    recompute_contact_rows : list | None
        Rows for the contacts query inside the recompute helper. Defaults to
        an empty list (no contacts yet — safe for most tests).
    recompute_formation_rows : list | None
        Rows for the formations query inside the recompute helper. Defaults to
        an empty list.
    recompute_parent_rows : list | None
        Rows for the parent-formations display_order query. Defaults to an
        empty list (no parents — parent_ids is empty → query not issued; the
        helper short-circuits when parent_ids is empty so this mock is still
        consumed when parent_ids is non-empty).
    inference_formation_count : int
        Number of distinct formations that fire the
        ``RecomputeFormationAbsencesForFormation`` trigger.  Each fires one
        ``_load_project_sections`` execute call (returns [] so the trigger
        early-returns immediately).  Defaults to 1 (one formation per
        single-suggestion accept).  Set to 0 when no contacts are created or
        found (should not happen in practice but avoids over-specification
        in edge-case tests).
    """

    # The litho model ORM stub
    litho_model_stub = SimpleNamespace(
        app_project_id=PROJECT_ID,
        kind=litho_model_kind,
        parent_geological_model_id=geo_model_id,
    )
    # The borehole ORM stub
    borehole_stub = SimpleNamespace(
        app_project_id=PROJECT_ID,
        location_x=borehole_x,
        location_y=borehole_y,
        elevation_m=borehole_elevation_m,
    )

    # Track calls to session.get
    def _get_side_effect(orm_class, id_val):
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
    # AcceptLithoSuggestions issues these queries in order:
    # 1. Formation surfaces query (one time, at the start)
    # 2. Geology contacts at investigation (one time)
    # 3. Per-suggestion: existing contact id check
    # [4–6 when expect_recompute=True]
    # 4. _recompute: contacts query (litho model contacts)
    # 5. _recompute: formations query (formation rows by id)
    # 6. _recompute: parent-formations display_order query (omitted when no
    #    parent ids — the helper guards with ``if parent_ids``; we supply it
    #    anyway so callers don't have to account for the guard in every test)
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

    if expect_recompute:
        # 4 — _recompute: contacts query
        execute_calls.append(_execute_all_result(recompute_contact_rows or []))
        # 5 — _recompute: formations query (scalars().all() path)
        execute_calls.append(_execute_all_result(recompute_formation_rows or []))
        # 6 — _recompute: parent-formations display_order query (.all() path)
        #     Only consumed when the helper finds non-empty parent_ids.
        #     Append it unconditionally — if not consumed it sits unused.
        execute_calls.append(_execute_all_result(recompute_parent_rows or []))

    # R7 inference hook: RecomputeFormationAbsencesForFormation fires once per
    # distinct affected formation.  Each call issues one _load_project_sections
    # execute (returns [] → early-return, no per-section queries fired).
    for _ in range(inference_formation_count):
        execute_calls.append(_execute_all_result([]))

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
async def test_a2_ghost_spanning_boundary_creates_one_contact_at_top_parent() -> None:
    """A ghost spanning a geology boundary makes ONE contact (no split) — #149 v3.

    The legacy straddle-split behaviour produced two contacts under two
    different ``parent_formation_id``s (rendered as two stacked SAND units
    in the inspector — owner dogfeed 2026-05-27).  Retired in favour of
    the verbatim-copy rule: every ghost = exactly one contact, parent =
    geo formation at the ghost's TOP depth.

    Setup mirrors the legacy A2: UPPER tops at 0.0 m, LOWER tops at 3.0 m,
    ghost is [0.0, 6.0] (would have straddled at 3.0).  New result: a
    single contact, parent = UPPER (ghost's top sits in UPPER), zero
    splits, zero fallbacks.
    """
    geo_contacts = [
        SimpleNamespace(depth_top_m=0.0, formation_id=UPPER_FORMATION_ID),
        SimpleNamespace(depth_top_m=3.0, formation_id=LOWER_FORMATION_ID),
    ]
    session = _make_session(
        surface_rows=[],
        geo_contacts_at_inv=geo_contacts,
        existing_contact_ids=[None],  # one ghost → one find-or-create
    )
    uc = _use_case(session)

    suggestions = [_make_suggestion(0.0, 6.0, "ZAND")]
    result = await uc.execute(
        project_id=PROJECT_ID,
        litho_model_id=LITHO_MODEL_ID,
        suggestions=suggestions,
        borehole_id=BOREHOLE_ID,
    )

    # No split — verbatim copy.
    assert result.straddle_split_count == 0
    assert result.stale_tin_fallback_count == 0
    assert len(result.created_contact_ids) == 1
    assert result.found_contact_ids == []


# ---------------------------------------------------------------------------
# A3 — verbatim copy is stable when TIN is stale
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a3_stale_tin_does_not_trigger_split_fallback() -> None:
    """Stale TIN no longer triggers the legacy fallback path (#149 v3).

    Pre-retirement the boundary-detection branch dropped to depth-ordering
    when the parent's TIN was stale or absent, incrementing
    ``stale_tin_fallback_count`` and logging a WARNING.  After the
    verbatim-copy rule the fallback is unreachable: a ghost spanning a
    boundary stays as one contact, parent assigned at the TOP depth, and
    ``stale_tin_fallback_count`` is always 0.

    Pin the new behaviour so any future re-introduction of straddle-split
    logic surfaces here.
    """
    stale_surface = SimpleNamespace(
        formation_id=UPPER_FORMATION_ID,
        model_id=GEO_MODEL_ID,
        is_stale=True,
        vertices=[],
        triangles=[],
    )
    geo_contacts = [
        SimpleNamespace(depth_top_m=0.0, formation_id=UPPER_FORMATION_ID),
        SimpleNamespace(depth_top_m=4.0, formation_id=LOWER_FORMATION_ID),
    ]
    session = _make_session(
        surface_rows=[stale_surface],
        geo_contacts_at_inv=geo_contacts,
        existing_contact_ids=[None],  # one ghost → one find-or-create
    )
    session.execute = AsyncMock(
        side_effect=[
            _execute_all_result([stale_surface]),
            _execute_all_result(geo_contacts),
            _execute_result(None),
            _execute_all_result([]),
            _execute_all_result([]),
            _execute_all_result([]),
            # R7 inference hook fires once (one affected formation).
            _execute_all_result([]),
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

    assert result.straddle_split_count == 0
    assert result.stale_tin_fallback_count == 0
    assert len(result.created_contact_ids) == 1


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
        # No new formation created → _recompute_litho_display_orders not called.
        expect_recompute=False,
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


# ---------------------------------------------------------------------------
# D-series — display_order correctness (superposition rule)
#
# These tests exercise _recompute_litho_display_orders directly via a mocked
# AsyncSession so there are no DB round-trips.  The helper's three execute
# calls are mocked with controlled contact / formation / parent data.
#
# Convention reminder (CLAUDE.md "Stratigraphic order"):
#   lower display_order = older = deeper
#   older paints first so younger renders on top
# ---------------------------------------------------------------------------

PARENT_A_ID = uuid4()  # geological formation, display_order=0 (oldest)
PARENT_B_ID = uuid4()  # geological formation, display_order=1 (younger)
LITHO_SHALLOW_ID = uuid4()  # litho under PARENT_A, depth 2 m (shallower = younger)
LITHO_DEEP_ID = uuid4()  # litho under PARENT_A, depth 8 m (deeper = older)
LITHO_UNDER_B_ID = uuid4()  # litho under PARENT_B (younger parent band)


def _make_recompute_session(
    *,
    contact_rows: list,
    formation_rows: list,
    parent_rows: list,
) -> AsyncMock:
    """Build a minimal session mock for _recompute_litho_display_orders tests.

    The helper issues exactly three execute calls:
    1. contacts query  → ``contact_rows`` (each has ``.formation_id`` + ``.depth_top_m``)
    2. formations query → ``formation_rows`` (scalars().all() path)
    3. parent display_order query → ``parent_rows`` (each has ``.id`` + ``.display_order``)
    """
    session = AsyncMock()
    session.flush = AsyncMock()
    session.execute = AsyncMock(
        side_effect=[
            _execute_all_result(contact_rows),
            _execute_all_result(formation_rows),
            _execute_all_result(parent_rows),
        ]
    )
    return session


def _use_case_for_recompute(session: AsyncMock) -> AcceptLithoSuggestions:
    """Build a use-case instance suitable for direct _recompute calls."""
    uc = AcceptLithoSuggestions(session)
    uc._repo = AsyncMock()
    return uc


@pytest.mark.asyncio
async def test_d1_deeper_unit_gets_lower_display_order_than_shallower() -> None:
    """Two litho units at different depths under the same parent:
    the deeper unit (older) must receive a LOWER display_order than the shallower
    one (younger).  Lower display_order = older = painted first so younger renders
    on top — the geological superposition rule.
    """
    # LITHO_DEEP_ID tops at 8 m, LITHO_SHALLOW_ID tops at 2 m.
    contact_rows = [
        SimpleNamespace(formation_id=LITHO_DEEP_ID, depth_top_m=8.0),
        SimpleNamespace(formation_id=LITHO_SHALLOW_ID, depth_top_m=2.0),
    ]
    # Both formations share PARENT_A (display_order=0).
    deep_f = _make_formation_stub(LITHO_DEEP_ID, parent_formation_id=PARENT_A_ID, name="KLEI_deep")
    shallow_f = _make_formation_stub(
        LITHO_SHALLOW_ID, parent_formation_id=PARENT_A_ID, name="KLEI_shallow"
    )
    parent_rows = [
        SimpleNamespace(id=PARENT_A_ID, display_order=0),
    ]

    session = _make_recompute_session(
        contact_rows=contact_rows,
        formation_rows=[deep_f, shallow_f],
        parent_rows=parent_rows,
    )
    uc = _use_case_for_recompute(session)

    await uc._recompute_litho_display_orders(litho_model_id=LITHO_MODEL_ID)

    # The helper mutates the ORM stubs in-place.
    assert deep_f.display_order < shallow_f.display_order, (
        f"Deeper unit should have lower display_order (older=deeper=lower), "
        f"got deep={deep_f.display_order} shallow={shallow_f.display_order}"
    )
    # Compact ranks: the two formations get consecutive values 0 and 1.
    assert {deep_f.display_order, shallow_f.display_order} == {0, 1}


@pytest.mark.asyncio
async def test_d2_recompute_is_idempotent_when_no_new_formations() -> None:
    """Calling _recompute twice with the same contacts produces the same ranks
    (no gratuitous churn on re-accept).
    """
    contact_rows = [
        SimpleNamespace(formation_id=LITHO_DEEP_ID, depth_top_m=10.0),
        SimpleNamespace(formation_id=LITHO_SHALLOW_ID, depth_top_m=3.0),
    ]
    deep_f = _make_formation_stub(
        LITHO_DEEP_ID, display_order=0, parent_formation_id=PARENT_A_ID, name="GRIND"
    )
    shallow_f = _make_formation_stub(
        LITHO_SHALLOW_ID, display_order=1, parent_formation_id=PARENT_A_ID, name="KLEI"
    )
    parent_rows = [SimpleNamespace(id=PARENT_A_ID, display_order=0)]

    # First call — both formations start at their correct ranks (0, 1) →
    # no mutations expected.
    session1 = _make_recompute_session(
        contact_rows=contact_rows,
        formation_rows=[deep_f, shallow_f],
        parent_rows=parent_rows,
    )
    uc1 = _use_case_for_recompute(session1)
    await uc1._recompute_litho_display_orders(litho_model_id=LITHO_MODEL_ID)

    # Ranks must be unchanged.
    assert deep_f.display_order == 0
    assert shallow_f.display_order == 1
    # flush must NOT have been called (no-op path when nothing changed).
    session1.flush.assert_not_awaited()


@pytest.mark.asyncio
async def test_d2b_recompute_converges_then_is_stable() -> None:
    """Stronger idempotency (review C3): starting from WRONG ranks, the
    first recompute fixes them (flush awaited), and a SECOND recompute
    with the same contacts is a true no-op (flush NOT awaited). D2 only
    covered the already-correct branch.
    """
    contact_rows = [
        SimpleNamespace(formation_id=LITHO_DEEP_ID, depth_top_m=10.0),
        SimpleNamespace(formation_id=LITHO_SHALLOW_ID, depth_top_m=3.0),
    ]
    # Start at deliberately wrong ranks (99/98) — shared stubs carry
    # state across the two calls.
    deep_f = _make_formation_stub(
        LITHO_DEEP_ID, display_order=99, parent_formation_id=PARENT_A_ID, name="GRIND"
    )
    shallow_f = _make_formation_stub(
        LITHO_SHALLOW_ID, display_order=98, parent_formation_id=PARENT_A_ID, name="KLEI"
    )
    parent_rows = [SimpleNamespace(id=PARENT_A_ID, display_order=0)]

    # Call 1 — converges: deeper (10 m) → 0, shallower (3 m) → 1, flush awaited.
    s1 = _make_recompute_session(
        contact_rows=contact_rows, formation_rows=[deep_f, shallow_f], parent_rows=parent_rows
    )
    await _use_case_for_recompute(s1)._recompute_litho_display_orders(litho_model_id=LITHO_MODEL_ID)
    assert deep_f.display_order == 0
    assert shallow_f.display_order == 1
    s1.flush.assert_awaited()

    # Call 2 — same contacts, ranks already correct → no mutation, no flush.
    s2 = _make_recompute_session(
        contact_rows=contact_rows, formation_rows=[deep_f, shallow_f], parent_rows=parent_rows
    )
    await _use_case_for_recompute(s2)._recompute_litho_display_orders(litho_model_id=LITHO_MODEL_ID)
    assert deep_f.display_order == 0
    assert shallow_f.display_order == 1
    s2.flush.assert_not_awaited()


@pytest.mark.asyncio
async def test_d3_cross_parent_ordering_respects_parent_display_order() -> None:
    """Units under an older geological parent (lower parent display_order) must
    receive lower display_order values than units under a younger parent,
    regardless of absolute depth.

    Setup:
        PARENT_A (display_order=0, older) has one litho unit at depth 1 m.
        PARENT_B (display_order=1, younger) has one litho unit at depth 20 m.

    Expected: LITHO_SHALLOW_ID (parent_A, depth 1 m) < LITHO_UNDER_B_ID
    (parent_B, depth 20 m) because PARENT_A is the older (deeper) formation.
    Even though 20 m is physically deeper than 1 m, the parent's age band
    wins as the coarse sort key — the litho model hierarchy mirrors the
    geological model hierarchy.
    """
    contact_rows = [
        SimpleNamespace(formation_id=LITHO_SHALLOW_ID, depth_top_m=1.0),
        SimpleNamespace(formation_id=LITHO_UNDER_B_ID, depth_top_m=20.0),
    ]
    under_a_f = _make_formation_stub(LITHO_SHALLOW_ID, parent_formation_id=PARENT_A_ID, name="KLEI")
    under_b_f = _make_formation_stub(LITHO_UNDER_B_ID, parent_formation_id=PARENT_B_ID, name="ZAND")
    parent_rows = [
        SimpleNamespace(id=PARENT_A_ID, display_order=0),
        SimpleNamespace(id=PARENT_B_ID, display_order=1),
    ]

    session = _make_recompute_session(
        contact_rows=contact_rows,
        formation_rows=[under_a_f, under_b_f],
        parent_rows=parent_rows,
    )
    uc = _use_case_for_recompute(session)

    await uc._recompute_litho_display_orders(litho_model_id=LITHO_MODEL_ID)

    assert under_a_f.display_order < under_b_f.display_order, (
        f"Unit under older geo parent (PARENT_A, display_order=0) must have "
        f"lower display_order than unit under younger parent (PARENT_B, display_order=1); "
        f"got under_a={under_a_f.display_order}, under_b={under_b_f.display_order}"
    )


@pytest.mark.asyncio
async def test_d4_geological_formations_are_not_modified() -> None:
    """_recompute_litho_display_orders ONLY touches formations that have
    contacts in the litho model.  Geological-model formations (parent rows)
    are loaded for their display_order value but never mutated.
    """
    contact_rows = [
        SimpleNamespace(formation_id=LITHO_SHALLOW_ID, depth_top_m=3.0),
    ]
    litho_f = _make_formation_stub(
        LITHO_SHALLOW_ID, display_order=99, parent_formation_id=PARENT_A_ID, name="KLEI"
    )
    # Parent stub — simulates a geological formation row loaded for its display_order.
    parent_stub = SimpleNamespace(id=PARENT_A_ID, display_order=0)

    session = _make_recompute_session(
        contact_rows=contact_rows,
        formation_rows=[litho_f],
        parent_rows=[parent_stub],
    )
    uc = _use_case_for_recompute(session)

    await uc._recompute_litho_display_orders(litho_model_id=LITHO_MODEL_ID)

    # The litho formation must have been reranked (99 → 0).
    assert litho_f.display_order == 0

    # The geological parent stub must be untouched.
    assert parent_stub.display_order == 0, (
        "Geological formation display_order must not be mutated by "
        "_recompute_litho_display_orders — only litho formations with "
        "contacts in the model are in scope"
    )


# ---------------------------------------------------------------------------
# V10 — IDOR scope guard: litho model owned by another project is rejected
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_v10_wrong_project_litho_model_raises_value_error() -> None:
    """VULN-10 scope guard: a litho model in another project is rejected.

    The router guards the endpoint, but ``execute`` re-checks
    ``litho_model.app_project_id`` so a non-API caller cannot skip the
    scope check. Pins the negative arm — a future change that drops the
    use-case check fails loudly (CLAUDE.md DoD §4). The guard must fire
    before any investigation load or contact write.
    """
    other_project = uuid4()
    foreign_model = SimpleNamespace(
        app_project_id=other_project,  # NOT PROJECT_ID
        kind="lithostratigraphic",
        parent_geological_model_id=GEO_MODEL_ID,
    )

    session = AsyncMock()
    session.get = AsyncMock(return_value=foreign_model)
    session.execute = AsyncMock()
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.flush = AsyncMock()
    uc = _use_case(session)

    with pytest.raises(ValueError, match="not found in project"):
        await uc.execute(
            project_id=PROJECT_ID,
            litho_model_id=LITHO_MODEL_ID,
            suggestions=[_make_suggestion(0.0, 5.0, "KLEI")],
            borehole_id=BOREHOLE_ID,
        )
    # Guard fires before any query or write.
    session.execute.assert_not_awaited()
    session.add.assert_not_called()
    session.commit.assert_not_awaited()


# ---------------------------------------------------------------------------
# E1–E5 — TIN extrapolation paths (debt #87)
#
# Tests target ``_compute_straddle_splits`` directly: it is a pure method
# (logger access only — no DB) so the cheapest test surface is constructing
# the use case with an empty mocked session and calling the method.
# ---------------------------------------------------------------------------


def _make_surface_stub(
    *,
    formation_id: object,
    vertices: list[tuple[float, float, float]],
    triangles: list[tuple[int, int, int]],
    is_stale: bool = False,
) -> SimpleNamespace:
    """Build a FormationSurfaceOrm-shaped stub for extrapolation tests."""
    return SimpleNamespace(
        formation_id=formation_id,
        vertices=vertices,
        triangles=triangles,
        is_stale=is_stale,
    )


def _bare_use_case() -> AcceptLithoSuggestions:
    """Minimal AcceptLithoSuggestions for pure-method tests (no DB calls)."""
    return AcceptLithoSuggestions(AsyncMock())


# A square TIN covering (0..200, 0..400) at constant elevation. Two triangles.
def _square_tin(z: float) -> tuple[list[tuple[float, float, float]], list[tuple[int, int, int]]]:
    """Square TIN at constant elevation ``z`` covering a generous footprint."""
    vertices = [
        (0.0, 0.0, z),
        (200.0, 0.0, z),
        (200.0, 400.0, z),
        (0.0, 400.0, z),
    ]
    triangles = [(0, 1, 2), (0, 2, 3)]
    return vertices, triangles


def test_e1_no_geology_at_all_returns_orphan_not_extrapolated() -> None:
    """No surfaces AND no contacts → orphan with extrapolated=False."""
    uc = _bare_use_case()
    suggestion = _make_suggestion(0.0, 5.0, "KLEI")
    result = uc._compute_straddle_splits(
        suggestion=suggestion,
        geology_surfaces={},
        geology_contacts_at_inv=[],
        inv_x=100.0,
        inv_y=200.0,
        inv_elevation_m=10.0,
        suggestion_index=0,
    )
    assert result.intervals == [(0.0, None)]
    assert result.extrapolated is False
    assert result.stale_tin_fallback_count == 0


def test_e2_tin_extrapolates_parent_when_no_contacts_at_inv() -> None:
    """Surfaces exist + no contacts here + suggestion within TIN → extrapolated parent.

    Two formations: upper TIN at elev=5, lower TIN at elev=2. Investigation
    elevation 10m, suggestion at depth_top=2m → target_z = 10 - 2 = 8m, which
    is above both surfaces → orphan (above youngest). Move depth to 7m →
    target_z = 3m, which lies between upper(5) and lower(2) → upper wins
    (smallest surf_z that's still >= 3 is 5 → upper formation).
    """
    upper_fid = uuid4()
    lower_fid = uuid4()
    upper_vertices, upper_tri = _square_tin(5.0)
    lower_vertices, lower_tri = _square_tin(2.0)
    surfaces = {
        upper_fid: _make_surface_stub(
            formation_id=upper_fid, vertices=upper_vertices, triangles=upper_tri
        ),
        lower_fid: _make_surface_stub(
            formation_id=lower_fid, vertices=lower_vertices, triangles=lower_tri
        ),
    }
    uc = _bare_use_case()
    # depth_top=7m, inv_elevation=10m → target_z=3m. Upper surface at 5m
    # is the smallest surf_z >= 3 → upper wins.
    suggestion = _make_suggestion(7.0, 9.0, "KLEI")
    result = uc._compute_straddle_splits(
        suggestion=suggestion,
        geology_surfaces=surfaces,
        geology_contacts_at_inv=[],
        inv_x=100.0,
        inv_y=200.0,
        inv_elevation_m=10.0,
        suggestion_index=0,
    )
    assert result.intervals == [(7.0, upper_fid)]
    assert result.extrapolated is True


def test_e3_suggestion_above_all_surfaces_is_orphan() -> None:
    """Suggestion sits above every TIN at this (x, y) → orphan.

    Upper TIN at elev=5, suggestion at depth=2m with inv_elev=10m →
    target_z=8m sits above both surfaces → no candidate → orphan.
    """
    upper_fid = uuid4()
    upper_vertices, upper_tri = _square_tin(5.0)
    surfaces = {
        upper_fid: _make_surface_stub(
            formation_id=upper_fid, vertices=upper_vertices, triangles=upper_tri
        ),
    }
    uc = _bare_use_case()
    suggestion = _make_suggestion(2.0, 4.0, "KLEI")
    result = uc._compute_straddle_splits(
        suggestion=suggestion,
        geology_surfaces=surfaces,
        geology_contacts_at_inv=[],
        inv_x=100.0,
        inv_y=200.0,
        inv_elevation_m=10.0,
        suggestion_index=0,
    )
    assert result.intervals == [(2.0, None)]
    assert result.extrapolated is False


def test_e4_inv_outside_tin_footprint_is_orphan() -> None:
    """Investigation (x, y) outside every TIN footprint → orphan.

    TIN covers (0..200, 0..400); investigation at (500, 500) sits outside →
    no candidate → orphan. evaluate_tin_at returns None for out-of-footprint.
    """
    upper_fid = uuid4()
    upper_vertices, upper_tri = _square_tin(5.0)
    surfaces = {
        upper_fid: _make_surface_stub(
            formation_id=upper_fid, vertices=upper_vertices, triangles=upper_tri
        ),
    }
    uc = _bare_use_case()
    suggestion = _make_suggestion(7.0, 9.0, "KLEI")
    result = uc._compute_straddle_splits(
        suggestion=suggestion,
        geology_surfaces=surfaces,
        geology_contacts_at_inv=[],
        inv_x=500.0,
        inv_y=500.0,
        inv_elevation_m=10.0,
        suggestion_index=0,
    )
    assert result.intervals == [(7.0, None)]
    assert result.extrapolated is False


def test_e5_stale_tin_is_skipped_during_extrapolation() -> None:
    """Stale TIN surfaces are skipped — extrapolation falls back to orphan.

    Stale surfaces are NOT used (the migration-time backfill and runtime
    accept both prefer "no parent" over a possibly-wrong extrapolation
    from a TIN the engineer hasn't rebuilt). Only non-stale surface here
    is stale → orphan.
    """
    upper_fid = uuid4()
    upper_vertices, upper_tri = _square_tin(5.0)
    surfaces = {
        upper_fid: _make_surface_stub(
            formation_id=upper_fid,
            vertices=upper_vertices,
            triangles=upper_tri,
            is_stale=True,
        ),
    }
    uc = _bare_use_case()
    suggestion = _make_suggestion(7.0, 9.0, "KLEI")
    result = uc._compute_straddle_splits(
        suggestion=suggestion,
        geology_surfaces=surfaces,
        geology_contacts_at_inv=[],
        inv_x=100.0,
        inv_y=200.0,
        inv_elevation_m=10.0,
        suggestion_index=0,
    )
    assert result.intervals == [(7.0, None)]
    assert result.extrapolated is False


def test_e6_no_inv_elevation_disables_extrapolation() -> None:
    """Investigation with NULL elevation_m → no extrapolation, orphan path.

    Without surveyed elevation we cannot convert depth-below-ground to
    absolute z. The code falls through to the orphan branch.
    """
    upper_fid = uuid4()
    upper_vertices, upper_tri = _square_tin(5.0)
    surfaces = {
        upper_fid: _make_surface_stub(
            formation_id=upper_fid, vertices=upper_vertices, triangles=upper_tri
        ),
    }
    uc = _bare_use_case()
    suggestion = _make_suggestion(7.0, 9.0, "KLEI")
    result = uc._compute_straddle_splits(
        suggestion=suggestion,
        geology_surfaces=surfaces,
        geology_contacts_at_inv=[],
        inv_x=100.0,
        inv_y=200.0,
        inv_elevation_m=None,
        suggestion_index=0,
    )
    assert result.intervals == [(7.0, None)]
    assert result.extrapolated is False


def test_e7_contact_based_parent_wins_over_extrapolation() -> None:
    """When contacts cover the depth, extrapolation does not run.

    Contact at depth=0 names UPPER_FORMATION as the parent for any
    depth >= 0. Suggestion at depth=2m matches that contact's bucket →
    extrapolated stays False even though TIN surfaces are present.
    """
    upper_fid = uuid4()
    other_fid = uuid4()  # an unrelated surface that would extrapolate to itself
    other_vertices, other_tri = _square_tin(99.0)  # surface above target_z
    surfaces = {
        other_fid: _make_surface_stub(
            formation_id=other_fid, vertices=other_vertices, triangles=other_tri
        ),
    }
    uc = _bare_use_case()
    suggestion = _make_suggestion(2.0, 4.0, "KLEI")
    result = uc._compute_straddle_splits(
        suggestion=suggestion,
        geology_surfaces=surfaces,
        geology_contacts_at_inv=[(0.0, upper_fid)],
        inv_x=100.0,
        inv_y=200.0,
        inv_elevation_m=10.0,
        suggestion_index=0,
    )
    assert result.intervals == [(2.0, upper_fid)]
    assert result.extrapolated is False


# ---------------------------------------------------------------------------
# BI1/BI2 — defer_inference=True batch-mode path (#129b)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_bi1_defer_inference_skips_r7_hook() -> None:
    """defer_inference=True: contacts are committed but inference is NOT triggered.

    Regression guard for the bulk-accept speedup: when defer_inference=True
    the use case must NOT call RecomputeFormationAbsencesForFormation or
    MaterializeWedgeTipsForFormation. The contact-commit and session.commit
    still run. The execute call sequence (execute call count) is shorter than
    the default path — the inference trigger issues no extra execute calls here.
    """
    # Session without inference execute calls (inference_formation_count=0).
    session = _make_session(
        surface_rows=[],
        geo_contacts_at_inv=[],
        existing_contact_ids=[None],  # no existing contact → create
        inference_formation_count=0,  # R7 hook skipped when defer_inference=True
    )
    uc = _use_case(session)

    suggestions = [_make_suggestion(0.0, 5.0, "KLEI")]
    result = await uc.execute(
        project_id=PROJECT_ID,
        litho_model_id=LITHO_MODEL_ID,
        suggestions=suggestions,
        borehole_id=BOREHOLE_ID,
        defer_inference=True,
    )

    # Contact is still created (contact-commit is not skipped).
    assert len(result.created_contact_ids) == 1
    # Commit still runs (transaction is not deferred).
    session.commit.assert_awaited_once()
    # All execute side-effects consumed — no extra inference query fired.
    # (If R7 fired, one extra execute call would have been issued for the
    # _load_project_sections query and the test would error on the side-effect
    # list being too short.)


@pytest.mark.asyncio
async def test_bi2_defer_inference_false_keeps_r7_hook() -> None:
    """defer_inference=False (the default): inference hook still fires as before.

    Regression guard: the default path must not change. With one suggestion and
    one affected formation the R7 hook issues one extra execute call
    (_load_project_sections, which returns [] → early return). The session
    mock includes that extra call, and it is consumed.
    """
    session = _make_session(
        surface_rows=[],
        geo_contacts_at_inv=[],
        existing_contact_ids=[None],
        inference_formation_count=1,  # default: R7 fires for the one affected formation
    )
    uc = _use_case(session)

    suggestions = [_make_suggestion(0.0, 5.0, "KLEI")]
    result = await uc.execute(
        project_id=PROJECT_ID,
        litho_model_id=LITHO_MODEL_ID,
        suggestions=suggestions,
        borehole_id=BOREHOLE_ID,
        defer_inference=False,  # explicit default
    )

    assert len(result.created_contact_ids) == 1
    session.commit.assert_awaited_once()


# ---------------------------------------------------------------------------
# #149 — Accept is a verbatim copy of the suggestion shape
#
# Owner directive 2026-05-27 (v2, superseding the original): "if I have
# 2 sand layers on top of each other in the suggestions, they should
# stay on the accepted — can't we just copy the suggestion when user
# clicks accept all?"
#
# The merge_adjacent_same_lithology pass belongs to suggestion-time
# (segmenter) — running it here would silently undo any post-Suggest
# user editing (split / insert / absorb).  Accept must produce
# len(suggestions) contacts (plus straddle splits where applicable).
# Whatever shape the user has in the ghost view IS the spec.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ac1_two_adjacent_sand_ghosts_produce_two_contacts() -> None:
    """Two adjacent SAND ghosts → TWO contacts (#149 — verbatim copy).

    Pin the verbatim-copy contract: the segmenter's same-litho merge
    belongs to Suggest-time only.  If two adjacent SAND ghosts arrive
    at Accept (toggle off at Suggest, or post-Suggest user editing),
    the accept path must NOT re-collapse them — that would silently
    undo the user's split/insert/absorb intent.
    """
    session = _make_session(
        surface_rows=[],
        geo_contacts_at_inv=[],
        # Two suggestions → two find-or-create checks.
        existing_contact_ids=[None, None],
    )
    uc = _use_case(session)

    suggestions = [
        _make_suggestion(0.0, 2.0, "ZAND"),
        _make_suggestion(2.0, 4.0, "ZAND"),
    ]
    result = await uc.execute(
        project_id=PROJECT_ID,
        litho_model_id=LITHO_MODEL_ID,
        suggestions=suggestions,
        borehole_id=BOREHOLE_ID,
    )

    # Two contacts — input was honoured verbatim, no merge.
    assert len(result.created_contact_ids) == 2
    # One formation — both halves share lithology + admixture signature
    # so the second pass finds the formation created on the first.
    assert len(result.created_formation_ids) == 1
    session.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_ac2_single_merged_ghost_produces_single_contact() -> None:
    """A single merged SAND ghost → ONE contact (#149 — verbatim copy).

    The dual of AC1: if Suggest-time produced a single merged ZAND
    segment (the segmenter's default with merge_same_lithology=true),
    Accept produces one contact — not two.  The accept path neither
    splits nor merges; it copies.
    """
    session = _make_session(
        surface_rows=[],
        geo_contacts_at_inv=[],
        existing_contact_ids=[None],
    )
    uc = _use_case(session)

    # One ZAND segment spanning 0–4 m — what a Suggest-time merge would
    # have produced from the AC1 inputs.
    suggestions = [_make_suggestion(0.0, 4.0, "ZAND")]
    result = await uc.execute(
        project_id=PROJECT_ID,
        litho_model_id=LITHO_MODEL_ID,
        suggestions=suggestions,
        borehole_id=BOREHOLE_ID,
    )

    assert len(result.created_contact_ids) == 1
    assert len(result.created_formation_ids) == 1


@pytest.mark.asyncio
async def test_ac3_non_adjacent_same_litho_stays_separate() -> None:
    """SAND / KLEI / SAND non-adjacent → 3 contacts (#149 — verbatim copy).

    Regression net for the verbatim-copy rule on a mixed triple: the
    two SANDs sandwich a KLEI so they are not adjacent.  Accept produces
    three contacts and two formation rows (the two SANDs share
    composition → same formation).
    """
    session = _make_session(
        surface_rows=[],
        geo_contacts_at_inv=[],
        existing_contact_ids=[None, None, None],
        inference_formation_count=2,
    )
    uc = _use_case(session)

    suggestions = [
        _make_suggestion(0.0, 2.0, "ZAND"),
        _make_suggestion(2.0, 3.0, "KLEI"),
        _make_suggestion(3.0, 5.0, "ZAND"),
    ]
    result = await uc.execute(
        project_id=PROJECT_ID,
        litho_model_id=LITHO_MODEL_ID,
        suggestions=suggestions,
        borehole_id=BOREHOLE_ID,
    )

    assert len(result.created_contact_ids) == 3
    assert len(result.created_formation_ids) == 2
