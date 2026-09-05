"""Unit tests for AutoPopulateContactsFromStratigraphy.execute and shared helpers.

Tests cover:

Shared derivation (``_derive_layer_names_and_key``):
- formal + informal → name=informal, regional_ref=formal, key=formal
- informal-only → name=informal, regional_ref=None, key=name
- formal, no informal counterpart → name=formal fallback, regional_ref=formal, key=formal

Stable key consistency:
- formal+informal with diverging working names across boreholes merge on same key
  (the root-cause divergence case)

``scan_stratigraphy_candidates`` key/regional_ref fields:
- formal+informal returns correct key and regional_ref
- informal-only returns key == name, regional_ref == None

``AutoPopulateContactsFromStratigraphy.execute`` with ``selected_keys``:
- subset selected → only matching layers create formations, others skipped
- selected_keys=None → all layers processed (existing behaviour preserved)

Orphan suppression:
- orphaned contact (observation_layer_id=None) is purged before idempotency
  check when selected_keys is provided, allowing re-creation

§10 on-click build contract:
- auto-populate must NOT trigger Delaunay / TIN recompute (no
  RecomputeFormationSurface call); instead it calls mark_surfaces_stale on
  formations that already have a surface row, and skips brand-new formations
  (no surface row to mark stale yet).

``normalize_formation_key`` — typographic-only (2026-05-17 reversal):
- NFKC + casefold + collapse non-alnum runs; no colon-strip; no lid-van reduction.

The DB session is mocked at the ``session.execute`` / ``session.add`` boundary;
no real DB or network I/O is performed.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
    _derive_layer_names_and_key,
    normalize_formation_key,
    scan_stratigraphy_candidates,
)
from groundmodel.domain.value_objects.observation_type import ObservationType

# ---------------------------------------------------------------------------
# Helpers — lightweight stand-ins for ORM rows
# ---------------------------------------------------------------------------


def _layer(
    *,
    top_m: float,
    base_m: float,
    description: str | None = "Boom Klei",
) -> SimpleNamespace:
    """Build a minimal observation-layer stub."""
    return SimpleNamespace(
        id=uuid4(),
        top_m=top_m,
        base_m=base_m,
        description=description,
    )


def _observation(kind: ObservationType, layers: list) -> SimpleNamespace:
    """Build a minimal observation stub (includes ``id`` for execute path)."""
    return SimpleNamespace(
        id=uuid4(),
        observation_type=kind.value,
        layers=layers,
    )


def _borehole(observations: list) -> SimpleNamespace:
    """Build a minimal borehole stub."""
    return SimpleNamespace(
        id=uuid4(),
        observations=observations,
    )


def _make_session(boreholes: list) -> AsyncMock:
    """Build a mock session whose ``execute`` returns the given boreholes."""
    result_mock = MagicMock()
    result_mock.scalars.return_value.all.return_value = boreholes

    session = AsyncMock()
    session.execute = AsyncMock(return_value=result_mock)
    return session


# ---------------------------------------------------------------------------
# _derive_layer_names_and_key — shared derivation
# ---------------------------------------------------------------------------


def test_derive_formal_with_informal_counterpart():
    """Formal primary + informal counterpart → informal name, formal regional_ref, key=formal."""
    name, regional_ref, key = _derive_layer_names_and_key(
        primary_is_formal=True,
        primary_desc="HyEg",
        counterpart_desc="Boom Klei",
    )
    assert name == "Boom Klei"
    assert regional_ref == "HyEg"
    assert key == "hyeg"  # key = normalize_formation_key(regional_ref)


def test_derive_formal_no_counterpart():
    """Formal primary with no counterpart → name falls back to formal, key=formal."""
    name, regional_ref, key = _derive_layer_names_and_key(
        primary_is_formal=True,
        primary_desc="HyEg",
        counterpart_desc=None,
    )
    assert name == "HyEg"
    assert regional_ref == "HyEg"
    assert key == "hyeg"


def test_derive_informal_only():
    """Informal-only primary → name=informal, regional_ref=None, key=name."""
    name, regional_ref, key = _derive_layer_names_and_key(
        primary_is_formal=False,
        primary_desc="Alluvium",
        counterpart_desc=None,
    )
    assert name == "Alluvium"
    assert regional_ref is None
    assert key == "alluvium"  # key = normalize_formation_key(name) when no regional_ref


def test_derive_informal_with_counterpart_ignored():
    """Informal primary — counterpart_desc is irrelevant (no formal observation source)."""
    # When walking the informal stream as primary there is no formal stream;
    # counterpart_desc should not affect name or regional_ref.
    name, regional_ref, key = _derive_layer_names_and_key(
        primary_is_formal=False,
        primary_desc="Zand",
        counterpart_desc="Unexpected counterpart",
    )
    assert name == "Zand"
    assert regional_ref is None
    assert key == "zand"


# ---------------------------------------------------------------------------
# scan_stratigraphy_candidates — key / regional_ref fields
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_scan_formal_informal_returns_key_and_regional_ref():
    """Formal+informal borehole → candidate carries key=formal code, regional_ref=formal."""
    project_id = uuid4()
    # Synthetic non-DOV formal code so this legacy test stays focused on the
    # (name, regional_ref, key) derivation mechanics — a real DOV code now
    # resolves via the #59 lexicon (covered by the C-series below).
    formal_layer = _layer(top_m=2.0, base_m=10.0, description="XxFm")
    informal_layer = _layer(top_m=2.0, base_m=10.0, description="Boom Klei")
    bh = _borehole(
        [
            _observation(ObservationType.FORMAL_STRATIGRAPHY, [formal_layer]),
            _observation(ObservationType.INFORMAL_STRATIGRAPHY, [informal_layer]),
        ]
    )

    session = _make_session([bh])
    candidates, collisions = await scan_stratigraphy_candidates(
        session, project_id=project_id, borehole_ids=[bh.id]
    )

    assert len(candidates) == 1
    assert collisions == []
    c = candidates[0]
    assert c.name == "Boom Klei"
    assert c.regional_ref == "XxFm"
    assert c.key == "xxfm"
    assert c.borehole_count == 1


@pytest.mark.asyncio
async def test_scan_informal_only_key_equals_name():
    """Informal-only borehole → candidate key == name, regional_ref is None."""
    project_id = uuid4()
    informal_layer = _layer(top_m=0.0, base_m=5.0, description="Alluvium")
    bh = _borehole(
        [
            _observation(ObservationType.INFORMAL_STRATIGRAPHY, [informal_layer]),
        ]
    )

    session = _make_session([bh])
    candidates, collisions = await scan_stratigraphy_candidates(
        session, project_id=project_id, borehole_ids=[bh.id]
    )

    assert len(candidates) == 1
    assert collisions == []
    c = candidates[0]
    assert c.name == "Alluvium"
    assert c.regional_ref is None
    assert c.key == "alluvium"


@pytest.mark.asyncio
async def test_scan_same_formal_code_different_informal_names_merge():
    """Two boreholes share a formal code but use different working names.

    The discover scan MUST merge these into ONE candidate keyed on the formal
    code, not two separate candidates keyed on the differing working names.
    This is the exact divergence case that caused the discover-execute mismatch.
    """
    project_id = uuid4()

    # bh1: formal XxFm / informal "Boom Klei"
    bh1 = _borehole(
        [
            _observation(
                ObservationType.FORMAL_STRATIGRAPHY,
                [_layer(top_m=2.0, base_m=10.0, description="XxFm")],
            ),
            _observation(
                ObservationType.INFORMAL_STRATIGRAPHY,
                [_layer(top_m=2.0, base_m=10.0, description="Boom Klei")],
            ),
        ]
    )
    # bh2: same formal XxFm but different informal working name "Rupel Klei"
    bh2 = _borehole(
        [
            _observation(
                ObservationType.FORMAL_STRATIGRAPHY,
                [_layer(top_m=3.0, base_m=12.0, description="XxFm")],
            ),
            _observation(
                ObservationType.INFORMAL_STRATIGRAPHY,
                [_layer(top_m=3.0, base_m=12.0, description="Rupel Klei")],
            ),
        ]
    )

    session = _make_session([bh1, bh2])
    candidates, collisions = await scan_stratigraphy_candidates(
        session, project_id=project_id, borehole_ids=[bh1.id, bh2.id]
    )

    # Must be ONE candidate (merged on formal key "XxFm"), NOT two.
    assert len(candidates) == 1
    assert collisions == []
    c = candidates[0]
    assert c.key == "xxfm"
    assert c.regional_ref == "XxFm"
    assert c.borehole_count == 2
    # name comes from the first borehole encountered
    assert c.name in ("Boom Klei", "Rupel Klei")


# ---------------------------------------------------------------------------
# execute — selected_keys filter
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_execute_selected_keys_filters_unselected_layers():
    """When selected_keys is provided, only layers whose key is in the set
    trigger formation/contact creation; others are silently skipped."""
    from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
        AutoPopulateContactsFromStratigraphy,
    )

    project_id = uuid4()
    model_id = uuid4()

    # One borehole with two informal layers (no formal, so key == name)
    layer_kept = _layer(top_m=0.0, base_m=5.0, description="Boom Klei")
    layer_skipped = _layer(top_m=5.0, base_m=15.0, description="Diest Zand")
    bh = _borehole(
        [
            _observation(ObservationType.INFORMAL_STRATIGRAPHY, [layer_kept, layer_skipped]),
        ]
    )

    # Build a session mock that handles multiple execute() calls:
    # 1. borehole load
    # 2. orphan delete (skipped — no surviving formation ids for new session)
    # 3. existing formations load (empty)
    # 4. max display_order
    # 5. existing contacts load (empty)
    bh_result = MagicMock()
    bh_result.scalars.return_value.all.return_value = [bh]

    empty_formations_result = MagicMock()
    empty_formations_result.scalars.return_value.all.return_value = []

    max_order_result = MagicMock()
    max_order_result.scalar_one.return_value = 0

    empty_contacts_result = MagicMock()
    empty_contacts_result.all.return_value = []

    call_count = 0

    async def side_effect(stmt, **kwargs):
        nonlocal call_count
        call_count += 1
        # call 1: borehole load
        if call_count == 1:
            return bh_result
        # call 2: formations load
        if call_count == 2:
            return empty_formations_result
        # call 3: max display_order
        if call_count == 3:
            return max_order_result
        # call 4: contacts load
        if call_count == 4:
            return empty_contacts_result
        # fallback
        return empty_contacts_result

    session = AsyncMock()
    session.execute = AsyncMock(side_effect=side_effect)
    session.add = MagicMock()
    session.new = []
    session.flush = AsyncMock()
    session.commit = AsyncMock()

    with patch(
        "groundmodel.infrastructure.db.repositories.geology_repository.GeologyRepository.mark_surfaces_stale",
        new_callable=AsyncMock,
        return_value=0,
    ) as mock_mark_stale:
        use_case = AutoPopulateContactsFromStratigraphy(session)
        outcome = await use_case.execute(
            project_id=project_id,
            model_id=model_id,
            borehole_ids=[bh.id],
            selected_keys=["Boom Klei"],  # only Boom Klei selected
        )

    # Should have created 1 formation + 1 contact (Boom Klei only)
    assert len(outcome.created_formation_ids) == 1
    assert len(outcome.created_contact_ids) == 1
    # The formation added via session.add should be GeologicalFormationOrm — verify
    # at least one add happened (formation + contact = 2 adds)
    assert session.add.call_count >= 2
    # §10 on-click build contract: mark_surfaces_stale called (no Delaunay).
    mock_mark_stale.assert_called_once()


@pytest.mark.asyncio
async def test_execute_selected_keys_none_processes_all():
    """When selected_keys is None, all layers are processed (existing behaviour)."""
    from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
        AutoPopulateContactsFromStratigraphy,
    )

    project_id = uuid4()
    model_id = uuid4()

    layer_a = _layer(top_m=0.0, base_m=5.0, description="Boom Klei")
    layer_b = _layer(top_m=5.0, base_m=15.0, description="Diest Zand")
    bh = _borehole(
        [
            _observation(ObservationType.INFORMAL_STRATIGRAPHY, [layer_a, layer_b]),
        ]
    )

    bh_result = MagicMock()
    bh_result.scalars.return_value.all.return_value = [bh]

    empty_formations_result = MagicMock()
    empty_formations_result.scalars.return_value.all.return_value = []

    max_order_result = MagicMock()
    max_order_result.scalar_one.return_value = 0

    empty_contacts_result = MagicMock()
    empty_contacts_result.all.return_value = []

    call_count = 0

    async def side_effect(stmt, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return bh_result
        if call_count == 2:
            return empty_formations_result
        if call_count == 3:
            return max_order_result
        if call_count == 4:
            return empty_contacts_result
        return empty_contacts_result

    session = AsyncMock()
    session.execute = AsyncMock(side_effect=side_effect)
    session.add = MagicMock()
    session.new = []
    session.flush = AsyncMock()
    session.commit = AsyncMock()

    with patch(
        "groundmodel.infrastructure.db.repositories.geology_repository.GeologyRepository.mark_surfaces_stale",
        new_callable=AsyncMock,
        return_value=0,
    ) as mock_mark_stale:
        use_case = AutoPopulateContactsFromStratigraphy(session)
        outcome = await use_case.execute(
            project_id=project_id,
            model_id=model_id,
            borehole_ids=[bh.id],
            selected_keys=None,  # process all
        )

    # Both layers processed → 2 formations + 2 contacts
    assert len(outcome.created_formation_ids) == 2
    assert len(outcome.created_contact_ids) == 2
    # §10 on-click build contract: mark_surfaces_stale called (no Delaunay).
    mock_mark_stale.assert_called_once()


@pytest.mark.asyncio
async def test_execute_pins_antropogeen_youngest_when_a_sibling_is_uncatalogued():
    """Owner ruling (2026-09-05): Antropogeen is the youngest formation
    whenever it is present, regardless of which boreholes log it.

    Reproduces the "Fill from boreholes" bug: Pleistoceen has no G3Dv3
    catalog entry by name, so the all-or-nothing catalog gate drops the
    batch to the mean-depth heuristic and discards Antropogeen's known
    age_rank 0. Here Antropogeen's only observed top (2.0 m) is deeper
    than Pleistoceen's (0.0 m), so pure mean-depth would rank Antropogeen
    OLDEST (lowest display_order) — Antropogeen below Pleistoceen. The
    anthropogenic pin must instead give Antropogeen the highest
    display_order (youngest).
    """
    from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
        AutoPopulateContactsFromStratigraphy,
    )
    from groundmodel.infrastructure.db.models.geological_formation_orm import (
        GeologicalFormationOrm,
    )

    project_id = uuid4()
    model_id = uuid4()

    bh_pleistoceen = _borehole(
        [
            _observation(
                ObservationType.INFORMAL_STRATIGRAPHY,
                [_layer(top_m=0.0, base_m=5.0, description="Pleistoceen")],
            )
        ]
    )
    bh_antropogeen = _borehole(
        [
            _observation(
                ObservationType.INFORMAL_STRATIGRAPHY,
                [_layer(top_m=2.0, base_m=5.0, description="Antropogeen")],
            )
        ]
    )

    bh_result = MagicMock()
    bh_result.scalars.return_value.all.return_value = [bh_pleistoceen, bh_antropogeen]
    empty_formations_result = MagicMock()
    empty_formations_result.scalars.return_value.all.return_value = []
    max_order_result = MagicMock()
    max_order_result.scalar_one.return_value = -1  # coalesce default → base 0
    empty_contacts_result = MagicMock()
    empty_contacts_result.all.return_value = []

    call_count = 0

    async def side_effect(stmt, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return bh_result
        if call_count == 2:
            return empty_formations_result
        if call_count == 3:
            return max_order_result
        if call_count == 4:
            return empty_contacts_result
        return empty_contacts_result

    # session.new must reflect the rows execute() actually adds, so the
    # ordering block (which iterates session.new) can set display_order.
    added_objects: list = []
    session = AsyncMock()
    session.execute = AsyncMock(side_effect=side_effect)
    session.add = MagicMock(side_effect=added_objects.append)
    session.new = added_objects
    session.flush = AsyncMock()
    session.commit = AsyncMock()

    with patch(
        "groundmodel.infrastructure.db.repositories.geology_repository.GeologyRepository.mark_surfaces_stale",
        new_callable=AsyncMock,
        return_value=0,
    ):
        use_case = AutoPopulateContactsFromStratigraphy(session)
        await use_case.execute(
            project_id=project_id,
            model_id=model_id,
            borehole_ids=[bh_pleistoceen.id, bh_antropogeen.id],
            selected_keys=None,
        )

    formations = {f.name: f for f in added_objects if isinstance(f, GeologicalFormationOrm)}
    assert set(formations) == {"Pleistoceen", "Antropogeen"}
    # Higher display_order = younger. Antropogeen must outrank Pleistoceen.
    assert formations["Antropogeen"].display_order > formations["Pleistoceen"].display_order


@pytest.mark.asyncio
async def test_execute_create_missing_formations_false_skips_unmatched():
    """Sections "Seed from stratigraphy" path (create_missing_formations=False).

    CLAUDE.md explicit-content invariant (owner directive 2026-05-17): Seed
    places contacts only for formations the user already curated and NEVER
    creates one. With no existing project formations, every in-corridor
    borehole layer is reported in ``skipped_not_in_model`` — zero formations
    and zero contacts are minted. This is the "Seed added Formatie van Ieper
    / a second Roubaix" regression guard.
    """
    from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
        AutoPopulateContactsFromStratigraphy,
    )

    project_id = uuid4()
    model_id = uuid4()

    layer_a = _layer(top_m=0.0, base_m=5.0, description="Boom Klei")
    layer_b = _layer(top_m=5.0, base_m=15.0, description="Diest Zand")
    bh = _borehole([_observation(ObservationType.INFORMAL_STRATIGRAPHY, [layer_a, layer_b])])

    bh_result = MagicMock()
    bh_result.scalars.return_value.all.return_value = [bh]
    empty_formations_result = MagicMock()
    empty_formations_result.scalars.return_value.all.return_value = []
    max_order_result = MagicMock()
    max_order_result.scalar_one.return_value = 0
    empty_contacts_result = MagicMock()
    empty_contacts_result.all.return_value = []

    call_count = 0

    async def side_effect(stmt, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return bh_result
        if call_count == 2:
            return empty_formations_result
        if call_count == 3:
            return max_order_result
        return empty_contacts_result

    session = AsyncMock()
    session.execute = AsyncMock(side_effect=side_effect)
    session.add = MagicMock()
    session.new = []
    session.flush = AsyncMock()
    session.commit = AsyncMock()

    with patch(
        "groundmodel.infrastructure.db.repositories.geology_repository.GeologyRepository.mark_surfaces_stale",
        new_callable=AsyncMock,
        return_value=0,
    ):
        use_case = AutoPopulateContactsFromStratigraphy(session)
        outcome = await use_case.execute(
            project_id=project_id,
            model_id=model_id,
            borehole_ids=[bh.id],
            selected_keys=None,  # unfiltered Seed path
            create_missing_formations=False,  # Seed never creates
        )

    assert outcome.created_formation_ids == []
    assert outcome.created_contact_ids == []
    assert outcome.skipped_not_in_model == 2
    # No GeologicalFormationOrm was ever added (the contract).
    session.add.assert_not_called()


# ---------------------------------------------------------------------------
# §10 on-click build contract — no TIN, stale-flip for pre-existing surfaces
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_auto_populate_does_not_build_tin_marks_existing_surfaces_stale():
    """§10 contract: auto-populate must NOT trigger Delaunay/TIN recompute.

    After the run:
    - contacts and formations are created;
    - mark_surfaces_stale is called (not RecomputeFormationSurface.execute_many);
    - brand-new formations (no pre-existing surface row) result in a
      mark_surfaces_stale call that returns 0 — the repo no-ops when
      no surface row exists for that (model, formation) pair, leaving the
      formation to render via the connect-the-dots fallback until Build fires.
    """
    from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
        AutoPopulateContactsFromStratigraphy,
    )

    project_id = uuid4()
    model_id = uuid4()

    layer = _layer(top_m=0.0, base_m=8.0, description="Boom Klei")
    bh = _borehole(
        [
            _observation(ObservationType.INFORMAL_STRATIGRAPHY, [layer]),
        ]
    )

    bh_result = MagicMock()
    bh_result.scalars.return_value.all.return_value = [bh]

    empty_formations_result = MagicMock()
    empty_formations_result.scalars.return_value.all.return_value = []

    max_order_result = MagicMock()
    max_order_result.scalar_one.return_value = 0

    empty_contacts_result = MagicMock()
    empty_contacts_result.all.return_value = []

    call_count = 0

    async def side_effect(stmt, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return bh_result
        if call_count == 2:
            return empty_formations_result
        if call_count == 3:
            return max_order_result
        if call_count == 4:
            return empty_contacts_result
        return empty_contacts_result

    session = AsyncMock()
    session.execute = AsyncMock(side_effect=side_effect)
    session.add = MagicMock()
    session.new = []
    session.flush = AsyncMock()
    session.commit = AsyncMock()

    # Brand-new formation → no surface row exists → mark_surfaces_stale is a
    # no-op (returns 0). Confirms the repo path is taken, NOT Delaunay.
    with patch(
        "groundmodel.infrastructure.db.repositories.geology_repository.GeologyRepository.mark_surfaces_stale",
        new_callable=AsyncMock,
        return_value=0,  # repo returns 0 when no surface row exists to flip
    ) as mock_mark_stale:
        use_case = AutoPopulateContactsFromStratigraphy(session)
        outcome = await use_case.execute(
            project_id=project_id,
            model_id=model_id,
            borehole_ids=[bh.id],
        )

    # Contact + formation created.
    assert len(outcome.created_formation_ids) == 1
    assert len(outcome.created_contact_ids) == 1
    # mark_surfaces_stale was called exactly once (not RecomputeFormationSurface).
    mock_mark_stale.assert_called_once()
    # The call receives one (model_id, formation_id) pair — the touched formation.
    call_args = mock_mark_stale.call_args
    pairs = list(call_args[0][0])  # first positional arg is the generator
    assert len(pairs) == 1
    assert pairs[0][0] == model_id


# ---------------------------------------------------------------------------
# normalize_formation_key — typographic-only (2026-05-17 reversal)
#
# The colon-strip and lid-van reduction steps have been REMOVED.  The
# function now only collapses byte-distinct but visually identical forms
# (NFKC + casefold + non-alnum run → single space).  "Formatie van Aalter -
# Lid van Oedelem" and "Lid van Oedelem" remain DISTINCT keys; the user
# decides equivalence manually via the lumping tool.
# ---------------------------------------------------------------------------


def test_normalize_collapses_typographic_variants_only():
    """Typographic variants of the SAME string (dash variants, NBSP,
    double spaces, mixed case) must map to ONE key.

    After the 2026-05-17 reversal, the key for a colon-bearing description
    is the WHOLE string lowercased (colon is treated as punctuation collapsed
    to space), NOT the post-colon tail.
    """
    canonical = normalize_formation_key("Paleogeen: Formatie van Aalter - Lid van Oedelem")
    # Typographic variants of the EXACT same string must produce the same key.
    variants = [
        "Paleogeen: Formatie van Aalter – Lid van Oedelem",  # en-dash (U+2013)
        "Paleogeen: Formatie van Aalter  -  Lid  van Oedelem",  # double spaces
        "Paleogeen:\xa0Formatie van Aalter - Lid van Oedelem",  # NBSP after colon (U+00A0)
        "PALEOGEEN: FORMATIE VAN AALTER - LID VAN OEDELEM",  # upper-case
        "  Paleogeen: Formatie van Aalter - Lid van Oedelem  ",  # outer ws
    ]
    for v in variants:
        assert normalize_formation_key(v) == canonical, v


def test_normalize_colon_is_not_stripped():
    """After the 2026-05-17 reversal, colons are NOT stripped.

    'Paleogeen: Formatie van Aalter' and 'Tertiair: Formatie van Aalter'
    produce DIFFERENT keys because they contain different text before the
    colon.  The machine no longer decides they refer to the same unit.
    """
    key_paleo = normalize_formation_key("Paleogeen: Formatie van Aalter - Lid van Oedelem")
    key_tertiary = normalize_formation_key(
        "Tertiair - Eoceen: Formatie van Aalter - Lid van Oedelem"
    )
    # These are DISTINCT — the chrono-prefix divergence is intentionally kept.
    assert key_paleo != key_tertiary

    # The whole string including the colon-containing prefix is the key.
    assert normalize_formation_key("Quartair") == "quartair"
    assert normalize_formation_key("Ma") == "ma"


def test_normalize_no_colon_uses_whole_string():
    """No colon → the whole string is the identity (just folded)."""
    assert normalize_formation_key("Quartair") == "quartair"
    assert normalize_formation_key("Ma") == "ma"


def test_normalize_lid_van_strings_are_distinct():
    """After the 2026-05-17 reversal, 'Tertiair: Lid van Oedelem' and
    'Paleogeen: Formatie van Aalter - Lid van Oedelem' produce DIFFERENT
    keys.  The machine no longer reduces them to 'lid van oedelem'.

    Equivalence across these strings is the user's responsibility via the
    manual lumping tool.
    """
    key_a = normalize_formation_key("Tertiair: Lid van Oedelem")
    key_b = normalize_formation_key("Paleogeen: Formatie van Aalter - Lid van Oedelem")
    assert key_a != key_b

    # Each is a typographically stable key of itself.
    assert key_a == normalize_formation_key("TERTIAIR: LID VAN OEDELEM")
    assert key_b == normalize_formation_key("PALEOGEEN: FORMATIE VAN AALTER - LID VAN OEDELEM")


def test_normalize_distinct_strings_stay_separate():
    """Two different formation names with no typographic overlap stay separate."""
    assert normalize_formation_key(
        "Formatie van Aalter - Lid van Oedelem"
    ) != normalize_formation_key("Formatie van Aalter - Lid van Vlierzele")


def test_normalize_informal_names_unchanged():
    """Plain informal names (no colon) are normalised to lowercased collapsed forms."""
    assert normalize_formation_key("Quartair") == "quartair"
    assert normalize_formation_key("Boom Klei") == "boom klei"
    assert (
        normalize_formation_key("Formatie van Maldegem of Formatie van Aalter")
        == "formatie van maldegem of formatie van aalter"
    )
    assert normalize_formation_key("HyEg") == "hyeg"
    assert normalize_formation_key("Alluvium") == "alluvium"
    assert normalize_formation_key("Zand") == "zand"


# ---------------------------------------------------------------------------
# execute — server-side delete of unselected formations (Fix 1 / da98053)
# ---------------------------------------------------------------------------


def _formation_stub(
    *,
    name: str,
    regional_ref: str | None = None,
    display_order: int = 0,
) -> SimpleNamespace:
    """Minimal GeologicalFormationOrm-shaped stub for the delete tests."""
    from uuid import uuid4 as _uuid4

    return SimpleNamespace(
        id=_uuid4(),
        name=name,
        regional_ref=regional_ref,
        display_order=display_order,
    )


def _make_session_with_formations(
    boreholes: list,
    existing_formations: list,
    *,
    in_model_formations: list | None = None,
) -> AsyncMock:
    """Mock session that serves *existing_formations* on the formations-load call.

    Parameters
    ----------
    boreholes : list
        Borehole stubs returned on the first execute() call.
    existing_formations : list
        Formation stubs returned on the formations-load call.
    in_model_formations : list or None, optional
        Subset of ``existing_formations`` that have contacts in the model under
        test.  These ids populate the contacts-load result so that
        ``model_formation_ids`` is built correctly after the B1 fix.  When
        ``None`` (the default), ALL ``existing_formations`` are treated as
        belonging to this model — preserving the pre-B1 test semantics for
        tests that don't need cross-model isolation.

    Call sequence inside execute() when ``selected_keys`` is provided and
    the orphan-purge step is skipped (no matching surviving formation ids):
      1. borehole load
      2. formations load
      3. max display_order
      4. contacts load  ← serves synthetic rows for *in_model_formations*
      5+. formation DELETE — generic mock
    """
    bh_result = MagicMock()
    bh_result.scalars.return_value.all.return_value = boreholes

    formations_result = MagicMock()
    formations_result.scalars.return_value.all.return_value = existing_formations

    max_order_result = MagicMock()
    max_order_result.scalar_one.return_value = max(
        (f.display_order for f in existing_formations), default=0
    )

    # Build synthetic contact rows: (id, observation_layer_id, borehole_id, formation_id).
    # One row per in-model formation, enough for model_formation_ids to be populated.
    model_scope = in_model_formations if in_model_formations is not None else existing_formations
    contacts_result = MagicMock()
    contacts_result.all.return_value = [(uuid4(), None, uuid4(), f.id) for f in model_scope]

    call_count = 0

    async def side_effect(stmt, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return bh_result
        if call_count == 2:
            return formations_result
        if call_count == 3:
            return max_order_result
        # Calls 4 and 5 are either (orphan DELETE, contacts load) or
        # (contacts load, formation DELETE), depending on whether the orphan-purge
        # step fires (it fires when any existing formation's key IS in selected_keys).
        # Returning contacts_result for both calls is safe: the DELETE result is
        # discarded (only rowcount is used), and the contacts SELECT gets the right
        # rows on whichever call it lands on.
        if call_count in (4, 5):
            return contacts_result
        # Remaining calls: formation DELETE — generic mock.
        generic = MagicMock()
        generic.all.return_value = []
        generic.scalars.return_value.all.return_value = []
        generic.scalar_one.return_value = 0
        return generic

    session = AsyncMock()
    session.execute = AsyncMock(side_effect=side_effect)
    session.add = MagicMock()
    session.new = []
    session.flush = AsyncMock()
    session.commit = AsyncMock()
    return session


@pytest.mark.asyncio
async def test_execute_unselected_formation_deleted():
    """When selected_keys is provided and an existing formation canonical key is
    NOT in the selected set, it is deleted and its id appears in
    ``deleted_formation_ids``.

    Root cause fixed (da98053 freeze): the old client-side ``.toLowerCase()``
    diverged from ``normalize_formation_key()`` for names with dashes / colons /
    spaces, so the entire freshly-created formation list was wrongly classified as
    unselected and queued for deletion, hard-freezing the UI for minutes.
    """
    from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
        AutoPopulateContactsFromStratigraphy,
    )

    project_id = uuid4()
    model_id = uuid4()

    old_formation = _formation_stub(name="Diest Zand")

    session = _make_session_with_formations(boreholes=[], existing_formations=[old_formation])

    with patch(
        "groundmodel.infrastructure.db.repositories.geology_repository.GeologyRepository.mark_surfaces_stale",
        new_callable=AsyncMock,
        return_value=0,
    ):
        use_case = AutoPopulateContactsFromStratigraphy(session)
        outcome = await use_case.execute(
            project_id=project_id,
            model_id=model_id,
            borehole_ids=[],
            selected_keys=["Boom Klei"],  # "diest zand" not in selected set
            mode="overwrite",
        )

    assert old_formation.id in outcome.deleted_formation_ids
    assert len(outcome.deleted_formation_ids) == 1
    assert len(outcome.created_formation_ids) == 0


@pytest.mark.asyncio
async def test_execute_selected_canonical_variant_not_deleted():
    """A formation whose canonical key IS in selected_keys must not be deleted
    even when its raw ``regional_ref`` uses dashes and punctuation.

    After the 2026-05-17 typographic-only reversal, the canonical key for
    ``"Paleogeen: Formatie van Aalter - Lid van Oedelem"`` is the full
    typographically-normalised string (``"paleogeen formatie van aalter lid
    van oedelem"``), NOT the former ``"lid van oedelem"`` reduction.

    Passing the correct typographic key in ``selected_keys`` must protect
    the formation from deletion.
    """
    from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
        AutoPopulateContactsFromStratigraphy,
    )

    project_id = uuid4()
    model_id = uuid4()

    regional_ref = "Paleogeen: Formatie van Aalter - Lid van Oedelem"
    formation = _formation_stub(
        name="Boom Klei",
        regional_ref=regional_ref,
    )

    session = _make_session_with_formations(boreholes=[], existing_formations=[formation])

    # Canonical key is the full typographic normalisation of the regional_ref.
    # Using normalize_formation_key ensures the test stays in sync with the
    # implementation rather than hardcoding the expected string twice.
    expected_key = normalize_formation_key(regional_ref)

    with patch(
        "groundmodel.infrastructure.db.repositories.geology_repository.GeologyRepository.mark_surfaces_stale",
        new_callable=AsyncMock,
        return_value=0,
    ):
        use_case = AutoPopulateContactsFromStratigraphy(session)
        outcome = await use_case.execute(
            project_id=project_id,
            model_id=model_id,
            borehole_ids=[],
            selected_keys=[expected_key],
            mode="overwrite",
        )

    assert formation.id not in outcome.deleted_formation_ids
    assert len(outcome.deleted_formation_ids) == 0


@pytest.mark.asyncio
async def test_execute_deleted_ids_returned_in_outcome():
    """``deleted_formation_ids`` carries every unselected formation deleted.

    Two unselected formations and one selected formation: outcome must carry
    exactly the two unselected ids; the selected id must be absent.
    """
    from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
        AutoPopulateContactsFromStratigraphy,
    )

    project_id = uuid4()
    model_id = uuid4()

    kept = _formation_stub(name="Boom Klei")
    deleted_a = _formation_stub(name="Diest Zand")
    deleted_b = _formation_stub(name="Quartair")

    session = _make_session_with_formations(
        boreholes=[],
        existing_formations=[kept, deleted_a, deleted_b],
    )

    with patch(
        "groundmodel.infrastructure.db.repositories.geology_repository.GeologyRepository.mark_surfaces_stale",
        new_callable=AsyncMock,
        return_value=0,
    ):
        use_case = AutoPopulateContactsFromStratigraphy(session)
        outcome = await use_case.execute(
            project_id=project_id,
            model_id=model_id,
            borehole_ids=[],
            selected_keys=["boom klei"],  # only "boom klei" canonical key
            mode="overwrite",
        )

    assert set(outcome.deleted_formation_ids) == {deleted_a.id, deleted_b.id}
    assert kept.id not in outcome.deleted_formation_ids
    assert len(outcome.created_formation_ids) == 0


@pytest.mark.asyncio
async def test_execute_sibling_model_formation_not_deleted():
    """B1 regression: a formation whose ONLY contacts belong to a DIFFERENT
    model_id must never appear in ``deleted_formation_ids``, even when its
    canonical key is NOT in ``selected_keys``.

    Before B1 the delete candidate set was scoped to ``app_project_id`` only,
    so sibling-model formations were silently CASCADE-deleted alongside their
    contacts and surfaces.

    Scenario:
      - ``sibling_formation``: only has contacts in ``other_model_id`` (not in
        the model under test).  Its key is NOT in selected_keys.
        → must NOT be deleted.
      - ``in_model_formation``: has a contact in the model under test.  Its key
        IS in selected_keys.
        → must NOT be deleted.
      - ``unselected_in_model_formation``: has a contact in the model under
        test.  Its key is NOT in selected_keys.
        → MUST be deleted.
    """
    from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
        AutoPopulateContactsFromStratigraphy,
    )

    project_id = uuid4()
    model_id = uuid4()

    sibling_formation = _formation_stub(name="Sibling Only Formation")
    in_model_formation = _formation_stub(name="Boom Klei")
    unselected_in_model = _formation_stub(name="Diest Zand")

    # ``in_model_formations`` lists only the two formations that have contacts
    # in the model under test; sibling_formation is intentionally absent so the
    # contacts-load result (call 4) does NOT include its id in model_formation_ids.
    session = _make_session_with_formations(
        boreholes=[],
        existing_formations=[sibling_formation, in_model_formation, unselected_in_model],
        in_model_formations=[in_model_formation, unselected_in_model],
    )

    with patch(
        "groundmodel.infrastructure.db.repositories.geology_repository.GeologyRepository.mark_surfaces_stale",
        new_callable=AsyncMock,
        return_value=0,
    ):
        use_case = AutoPopulateContactsFromStratigraphy(session)
        outcome = await use_case.execute(
            project_id=project_id,
            model_id=model_id,
            borehole_ids=[],
            # Only "boom klei" is selected; "diest zand" and "sibling only formation"
            # are not in the set.
            selected_keys=["boom klei"],
            mode="overwrite",
        )

    # The in-this-model unselected formation IS deleted.
    assert unselected_in_model.id in outcome.deleted_formation_ids
    # The sibling-model-only formation is NOT deleted (no contacts in this model).
    assert sibling_formation.id not in outcome.deleted_formation_ids
    # The selected in-model formation is NOT deleted.
    assert in_model_formation.id not in outcome.deleted_formation_ids
    assert len(outcome.deleted_formation_ids) == 1


# ---------------------------------------------------------------------------
# execute — add / overwrite mode (2026-08-03 data-loss ruling)
#
# The owner opened "Fill from boreholes" to ADD one unit and lost four saved
# geological units, because passing ``selected_keys`` implied "delete
# everything else".  The ruling: Apply asks "add to existing model, or
# overwrite model", and ADD is the safe default so an omitted field can
# never mass-delete.
#
# The tests below are phrased in the ruling's own words, not the impl's.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_execute_add_mode_never_deletes_an_unselected_formation():
    """In ADD mode a formation the user did not select is left alone.

    The user picked one unit to add; the four units already in the model that
    are not in that selection must still be there afterwards.
    """
    from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
        AutoPopulateContactsFromStratigraphy,
    )

    project_id = uuid4()
    model_id = uuid4()

    untouched = _formation_stub(name="Diest Zand")

    session = _make_session_with_formations(boreholes=[], existing_formations=[untouched])

    with patch(
        "groundmodel.infrastructure.db.repositories.geology_repository.GeologyRepository.mark_surfaces_stale",
        new_callable=AsyncMock,
        return_value=0,
    ):
        use_case = AutoPopulateContactsFromStratigraphy(session)
        outcome = await use_case.execute(
            project_id=project_id,
            model_id=model_id,
            borehole_ids=[],
            selected_keys=["Boom Klei"],  # "diest zand" deliberately unselected
            mode="add",
        )

    assert outcome.deleted_formation_ids == []
    assert outcome.deleted_formation_names == []
    assert outcome.mode == "add"


@pytest.mark.asyncio
async def test_execute_without_a_mode_defaults_to_add_and_deletes_nothing():
    """Omitting the mode is the same as asking to add — nothing is deleted.

    An old client that never learned about the mode field must not be able to
    mass-delete the user's model by omission.
    """
    from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
        AutoPopulateContactsFromStratigraphy,
    )

    project_id = uuid4()
    model_id = uuid4()

    untouched = _formation_stub(name="Diest Zand")

    session = _make_session_with_formations(boreholes=[], existing_formations=[untouched])

    with patch(
        "groundmodel.infrastructure.db.repositories.geology_repository.GeologyRepository.mark_surfaces_stale",
        new_callable=AsyncMock,
        return_value=0,
    ):
        use_case = AutoPopulateContactsFromStratigraphy(session)
        outcome = await use_case.execute(
            project_id=project_id,
            model_id=model_id,
            borehole_ids=[],
            selected_keys=["Boom Klei"],
            # no mode argument at all
        )

    assert outcome.deleted_formation_ids == []
    assert outcome.mode == "add"


@pytest.mark.asyncio
async def test_execute_overwrite_mode_names_the_formations_it_deleted():
    """In OVERWRITE mode the outcome names what died, not just its ids.

    A toast that says "removes 4 units" without naming them is useless to the
    engineer deciding whether to go through with it.
    """
    from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
        AutoPopulateContactsFromStratigraphy,
    )

    project_id = uuid4()
    model_id = uuid4()

    kept = _formation_stub(name="Boom Klei")
    doomed_a = _formation_stub(name="Diest Zand")
    doomed_b = _formation_stub(name="Quartair")

    session = _make_session_with_formations(
        boreholes=[],
        existing_formations=[kept, doomed_a, doomed_b],
    )

    with patch(
        "groundmodel.infrastructure.db.repositories.geology_repository.GeologyRepository.mark_surfaces_stale",
        new_callable=AsyncMock,
        return_value=0,
    ):
        use_case = AutoPopulateContactsFromStratigraphy(session)
        outcome = await use_case.execute(
            project_id=project_id,
            model_id=model_id,
            borehole_ids=[],
            selected_keys=["boom klei"],
            mode="overwrite",
        )

    assert set(outcome.deleted_formation_ids) == {doomed_a.id, doomed_b.id}
    assert set(outcome.deleted_formation_names) == {"Diest Zand", "Quartair"}
    assert outcome.mode == "overwrite"


# ---------------------------------------------------------------------------
# scan_stratigraphy_candidates — manual_map + collision detection
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_scan_manual_map_merges_candidates():
    """Passing manual_map folds two distinct raw keys under one effective key.

    Two informal layers "Holoceen veen" and "Vlaamse Vallei" in the SAME
    borehole are both mapped to "Holoceen". The scan must return ONE candidate
    for "Holoceen" (borehole_count=1) and emit ONE LumpingCollision.
    """
    from groundmodel.application.stratigraphy_bridge import (
        normalize_formation_key,
    )

    project_id = uuid4()
    bh = _borehole(
        [
            _observation(
                ObservationType.INFORMAL_STRATIGRAPHY,
                [
                    _layer(top_m=0.0, base_m=2.0, description="Holoceen veen"),
                    _layer(top_m=2.0, base_m=8.0, description="Vlaamse Vallei"),
                ],
            )
        ]
    )

    # Both raw keys map to "Holoceen".
    manual_map = {
        normalize_formation_key("Holoceen veen"): "Holoceen",
        normalize_formation_key("Vlaamse Vallei"): "Holoceen",
    }

    session = _make_session([bh])
    candidates, collisions = await scan_stratigraphy_candidates(
        session, project_id=project_id, borehole_ids=[bh.id], manual_map=manual_map
    )

    # Only ONE effective candidate ("Holoceen").
    assert len(candidates) == 1
    c = candidates[0]
    assert c.name == "Holoceen"
    assert c.key == normalize_formation_key("Holoceen")
    assert c.borehole_count == 1

    # Exactly one collision — the borehole had two layers colliding on "Holoceen".
    assert len(collisions) == 1
    col = collisions[0]
    assert col.borehole_id == bh.id
    assert col.target_formation_key == normalize_formation_key("Holoceen")
    assert col.target_formation_name == "Holoceen"
    # Both raw descriptions contributed.
    assert set(col.colliding_raw_names) == {"Holoceen veen", "Vlaamse Vallei"}
    # Shallowest top wins: top_m=0.0 < top_m=2.0.
    assert col.kept_top_m == 0.0
    assert col.dropped_count == 1


@pytest.mark.asyncio
async def test_scan_no_collision_when_different_boreholes():
    """Two boreholes each with ONE layer lumped to "Holoceen" — no collision.

    A collision requires ≥2 layers resolving to the same key WITHIN one
    borehole.  Across boreholes is the normal multi-borehole scenario.
    """
    from groundmodel.application.stratigraphy_bridge import (
        normalize_formation_key,
    )

    project_id = uuid4()
    bh1 = _borehole(
        [
            _observation(
                ObservationType.INFORMAL_STRATIGRAPHY,
                [_layer(top_m=0.0, base_m=3.0, description="Holoceen veen")],
            )
        ]
    )
    bh2 = _borehole(
        [
            _observation(
                ObservationType.INFORMAL_STRATIGRAPHY,
                [_layer(top_m=0.0, base_m=4.0, description="Vlaamse Vallei")],
            )
        ]
    )
    manual_map = {
        normalize_formation_key("Holoceen veen"): "Holoceen",
        normalize_formation_key("Vlaamse Vallei"): "Holoceen",
    }

    session = _make_session([bh1, bh2])
    candidates, collisions = await scan_stratigraphy_candidates(
        session,
        project_id=project_id,
        borehole_ids=[bh1.id, bh2.id],
        manual_map=manual_map,
    )

    assert len(candidates) == 1
    assert candidates[0].borehole_count == 2
    # No collision — each borehole contributes exactly one "Holoceen" layer.
    assert collisions == []


@pytest.mark.asyncio
async def test_scan_no_manual_map_no_collision():
    """Without a manual_map, no collision can occur regardless of borehole content."""
    project_id = uuid4()
    bh = _borehole(
        [
            _observation(
                ObservationType.INFORMAL_STRATIGRAPHY,
                [
                    _layer(top_m=0.0, base_m=2.0, description="Holoceen veen"),
                    _layer(top_m=2.0, base_m=8.0, description="Vlaamse Vallei"),
                ],
            )
        ]
    )

    session = _make_session([bh])
    candidates, collisions = await scan_stratigraphy_candidates(
        session, project_id=project_id, borehole_ids=[bh.id]
    )

    # Two distinct keys — no merge, no collision.
    assert len(candidates) == 2
    assert collisions == []


# ---------------------------------------------------------------------------
# execute — manual_map collision safeguard (shallowest-wins rule)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_execute_collision_keeps_shallowest_emits_warning():
    """When manual lumping causes two layers in one borehole to share a key,
    only the shallowest contact is created and a LumpingCollision is returned.

    Scenario: borehole has "Holoceen veen" (top 0.0 m) and "Vlaamse Vallei"
    (top 2.0 m); both mapped to "Holoceen". The write path must create exactly
    ONE contact (at 0.0 m) and report one collision warning.
    """
    from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
        AutoPopulateContactsFromStratigraphy,
        normalize_formation_key,
    )

    project_id = uuid4()
    model_id = uuid4()

    bh = _borehole(
        [
            _observation(
                ObservationType.INFORMAL_STRATIGRAPHY,
                [
                    _layer(top_m=0.0, base_m=2.0, description="Holoceen veen"),
                    _layer(top_m=2.0, base_m=8.0, description="Vlaamse Vallei"),
                ],
            )
        ]
    )

    manual_map = {
        normalize_formation_key("Holoceen veen"): "Holoceen",
        normalize_formation_key("Vlaamse Vallei"): "Holoceen",
    }

    session = _make_session_with_formations(boreholes=[bh], existing_formations=[])

    with patch(
        "groundmodel.infrastructure.db.repositories.geology_repository.GeologyRepository.mark_surfaces_stale",
        new_callable=AsyncMock,
        return_value=0,
    ):
        use_case = AutoPopulateContactsFromStratigraphy(session)
        outcome = await use_case.execute(
            project_id=project_id,
            model_id=model_id,
            borehole_ids=[bh.id],
            manual_map=manual_map,
        )

    # One formation created for the effective key "Holoceen".
    assert len(outcome.created_formation_ids) == 1
    # One contact created (the shallowest — the deeper duplicate is dropped).
    assert len(outcome.created_contact_ids) == 1
    # One collision warning emitted.
    assert len(outcome.collisions) == 1
    col = outcome.collisions[0]
    assert col.borehole_id == bh.id
    assert col.target_formation_name == "Holoceen"
    assert col.kept_top_m == 0.0
    assert col.dropped_count == 1
    assert set(col.colliding_raw_names) == {"Holoceen veen", "Vlaamse Vallei"}


@pytest.mark.asyncio
async def test_execute_no_collision_without_manual_map():
    """Without manual_map, two layers in one borehole create two separate
    formations with no collision warning.
    """
    from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
        AutoPopulateContactsFromStratigraphy,
    )

    project_id = uuid4()
    model_id = uuid4()

    bh = _borehole(
        [
            _observation(
                ObservationType.INFORMAL_STRATIGRAPHY,
                [
                    _layer(top_m=0.0, base_m=2.0, description="Holoceen veen"),
                    _layer(top_m=2.0, base_m=8.0, description="Vlaamse Vallei"),
                ],
            )
        ]
    )

    session = _make_session_with_formations(boreholes=[bh], existing_formations=[])

    with patch(
        "groundmodel.infrastructure.db.repositories.geology_repository.GeologyRepository.mark_surfaces_stale",
        new_callable=AsyncMock,
        return_value=0,
    ):
        use_case = AutoPopulateContactsFromStratigraphy(session)
        outcome = await use_case.execute(
            project_id=project_id,
            model_id=model_id,
            borehole_ids=[bh.id],
        )

    # Two distinct formations and two contacts — no merging.
    assert len(outcome.created_formation_ids) == 2
    assert len(outcome.created_contact_ids) == 2
    assert outcome.collisions == []


# ---------------------------------------------------------------------------
# B1 regression — deep-first layer ordering must not corrupt kept_top_m
#
# Before the B1 fix, the write loop iterated primary_obs.layers in ORM
# result order (no guaranteed ORDER BY top_m).  When the ORM happened to
# deliver the deeper layer first, bh_keys[effective_key] recorded the
# DEEPER depth as "kept", while the discover scan (which sorts ascending)
# would report the SHALLOWER depth — breaking the discover≡apply invariant.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_execute_deep_first_layers_keeps_shallowest_contact():
    """B1 regression: layers supplied DEEP-FIRST must still yield the shallowest contact.

    Scenario:
    - One borehole with two informal layers.
    - ORM delivers them deep-first: top_m=2.0 appears BEFORE top_m=0.0 in the list.
    - Both are lumped to the same formation via manual_map.
    - After the B1 fix (sort ascending before the loop):

      (a) Exactly ONE contact is created (shallowest wins).
      (b) The contact's depth is 0.0 m (the shallowest layer wins).
      (c) The LumpingCollision's ``kept_top_m`` equals 0.0 (the written depth).
      (d) The discover scan on the same input also reports kept_top_m=0.0
          — discover≡apply depth parity.
    """
    from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
        AutoPopulateContactsFromStratigraphy,
        normalize_formation_key,
    )

    project_id = uuid4()
    model_id = uuid4()

    # Deep-first: top_m=2.0 comes BEFORE top_m=0.0 in the ORM result.
    layer_deep = _layer(top_m=2.0, base_m=8.0, description="Vlaamse Vallei")
    layer_shallow = _layer(top_m=0.0, base_m=2.0, description="Holoceen veen")
    bh = _borehole(
        [
            _observation(
                ObservationType.INFORMAL_STRATIGRAPHY,
                [layer_deep, layer_shallow],  # deep-first ordering
            )
        ]
    )

    # Both raw names lump to the same effective formation.
    manual_map = {
        normalize_formation_key("Vlaamse Vallei"): "Quartair",
        normalize_formation_key("Holoceen veen"): "Quartair",
    }

    session = _make_session_with_formations(boreholes=[bh], existing_formations=[])

    with patch(
        "groundmodel.infrastructure.db.repositories.geology_repository.GeologyRepository.mark_surfaces_stale",
        new_callable=AsyncMock,
        return_value=0,
    ):
        use_case = AutoPopulateContactsFromStratigraphy(session)
        outcome = await use_case.execute(
            project_id=project_id,
            model_id=model_id,
            borehole_ids=[bh.id],
            manual_map=manual_map,
        )

    # (a) Exactly one contact — the deeper duplicate is dropped.
    assert len(outcome.created_contact_ids) == 1
    # One formation created for the effective key "Quartair".
    assert len(outcome.created_formation_ids) == 1
    # (b) + (c) The collision entry's kept_top_m must be 0.0.
    assert len(outcome.collisions) == 1
    col = outcome.collisions[0]
    assert col.kept_top_m == 0.0, (
        f"B1: shallowest-wins violated — kept_top_m={col.kept_top_m!r}, expected 0.0"
    )
    assert col.dropped_count == 1

    # (d) discover≡apply depth parity: the scan on the same input must also
    # report kept_top_m=0.0 for the (borehole, "quartair") pair.
    session2 = _make_session([bh])
    scan_candidates, scan_collisions = await scan_stratigraphy_candidates(
        session2, project_id=project_id, borehole_ids=[bh.id], manual_map=manual_map
    )
    assert len(scan_collisions) == 1
    scan_col = scan_collisions[0]
    assert scan_col.kept_top_m == 0.0, (
        f"B1 discover≡apply: scan kept_top_m={scan_col.kept_top_m!r}, expected 0.0"
    )
    # Both sides must agree.
    assert col.kept_top_m == scan_col.kept_top_m, (
        f"B1: write kept_top_m={col.kept_top_m!r} != scan kept_top_m={scan_col.kept_top_m!r}"
    )


# ---------------------------------------------------------------------------
# S2 — _resolve_effective_key must guard blank/empty manual_map targets
#
# An empty or whitespace-only target normalises to "" via
# normalize_formation_key and would create a GeologicalFormationOrm with
# name="".  The guard treats such targets as unmapped — the raw key is
# returned unchanged.
# ---------------------------------------------------------------------------


def test_resolve_effective_key_empty_target_treated_as_unmapped():
    """Empty target string in manual_map → raw key returned (no nameless formation)."""
    from groundmodel.application.stratigraphy_bridge import (
        _resolve_effective_key,
        normalize_formation_key,
    )

    raw_key = normalize_formation_key("Boom Klei")
    # Empty target: normalize_formation_key("") == "" → guard fires.
    eff_key, eff_name = _resolve_effective_key(raw_key, {raw_key: ""})
    assert eff_key == raw_key, "empty target must not override the raw key"
    assert eff_name == raw_key, "empty target must not override the display name"


def test_resolve_effective_key_blank_target_treated_as_unmapped():
    """Whitespace-only target in manual_map → raw key returned (no nameless formation)."""
    from groundmodel.application.stratigraphy_bridge import (
        _resolve_effective_key,
        normalize_formation_key,
    )

    raw_key = normalize_formation_key("Boom Klei")
    # Whitespace-only target: normalize_formation_key("   ") == "" → guard fires.
    eff_key, eff_name = _resolve_effective_key(raw_key, {raw_key: "   "})
    assert eff_key == raw_key, "blank target must not override the raw key"
    assert eff_name == raw_key, "blank target must not override the display name"


# ---------------------------------------------------------------------------
# P2-D: found_contact_ids — Seed handler seeded-set union (owner directive 2026-05-17)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_seed_with_section_id_found_contact_ids_populated():
    """P2-D: when section_id is provided, a contact that already exists in the model
    (skipped via occupied_anchor_formation) appears in found_contact_ids so the
    Seed router can union it into the section's seeded set.

    Scenario: a borehole has one informal layer "Boom Klei".  A contact already
    exists for (borehole, formation=Boom Klei) in the model (pre-existing Fill
    contact).  The execute() call skips it as a duplicate but must record its id
    in found_contact_ids (not in created_contact_ids).
    """
    from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
        AutoPopulateContactsFromStratigraphy,
    )

    project_id = uuid4()
    model_id = uuid4()
    borehole_id = uuid4()
    formation_id = uuid4()
    existing_contact_id = uuid4()
    layer_id = uuid4()

    # The borehole carries one informal layer "Boom Klei" (top=0, base=5).
    layer = SimpleNamespace(
        id=layer_id,
        top_m=0.0,
        base_m=5.0,
        description="Boom Klei",
    )
    obs = SimpleNamespace(
        id=uuid4(),
        observation_type=ObservationType.INFORMAL_STRATIGRAPHY.value,
        layers=[layer],
    )
    borehole = SimpleNamespace(id=borehole_id, observations=[obs])

    # Existing formation for "Boom Klei".
    formation = SimpleNamespace(
        id=formation_id, name="Boom Klei", regional_ref=None, display_order=0
    )

    # Contact row already in the model: (id, observation_layer_id, borehole_id, formation_id).
    # This simulates the pre-existing Fill contact.
    pre_existing_contact_row = (existing_contact_id, layer_id, borehole_id, formation_id)

    # Call sequence:
    # 1. borehole load (scalars.all)
    # 2. formations load (scalars.all)
    # 3. max display_order (scalar_one)
    # 4. contacts load (.all) — returns the pre-existing row
    bh_result = MagicMock()
    bh_result.scalars.return_value.all.return_value = [borehole]

    formations_result = MagicMock()
    formations_result.scalars.return_value.all.return_value = [formation]

    max_order_result = MagicMock()
    max_order_result.scalar_one.return_value = 0

    contacts_result = MagicMock()
    contacts_result.all.return_value = [pre_existing_contact_row]

    call_count = 0

    async def side_effect(stmt, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return bh_result
        if call_count == 2:
            return formations_result
        if call_count == 3:
            return max_order_result
        # contacts load (and any orphan-delete result — both safe to return contacts_result)
        return contacts_result

    session = AsyncMock()
    session.execute = AsyncMock(side_effect=side_effect)
    session.add = MagicMock()
    session.new = []
    session.flush = AsyncMock()
    session.commit = AsyncMock()

    section_id = uuid4()

    with patch(
        "groundmodel.infrastructure.db.repositories.geology_repository.GeologyRepository.mark_surfaces_stale",
        new_callable=AsyncMock,
        return_value=0,
    ):
        outcome = await AutoPopulateContactsFromStratigraphy(session).execute(
            project_id=project_id,
            model_id=model_id,
            borehole_ids=[borehole_id],
            section_id=section_id,
        )

    # The pre-existing contact was skipped (idempotency) and must appear in found_contact_ids.
    assert existing_contact_id in outcome.found_contact_ids, (
        "Pre-existing contact must appear in found_contact_ids for the Seed router"
    )
    # No new contact was created — the existing one was preserved.
    assert existing_contact_id not in outcome.created_contact_ids, (
        "Pre-existing contact must NOT appear in created_contact_ids"
    )
    assert len(outcome.created_contact_ids) == 0


@pytest.mark.asyncio
async def test_seed_without_section_id_found_contact_ids_empty():
    """P2-D: when section_id is None (the Fill path), found_contact_ids is always
    empty — Fill does not touch section seeds.
    """
    from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
        AutoPopulateContactsFromStratigraphy,
    )

    project_id = uuid4()
    model_id = uuid4()
    borehole_id = uuid4()
    formation_id = uuid4()
    existing_contact_id = uuid4()
    layer_id = uuid4()

    layer = SimpleNamespace(id=layer_id, top_m=0.0, base_m=5.0, description="Boom Klei")
    obs = SimpleNamespace(
        id=uuid4(),
        observation_type=ObservationType.INFORMAL_STRATIGRAPHY.value,
        layers=[layer],
    )
    borehole = SimpleNamespace(id=borehole_id, observations=[obs])
    formation = SimpleNamespace(
        id=formation_id, name="Boom Klei", regional_ref=None, display_order=0
    )
    pre_existing_row = (existing_contact_id, layer_id, borehole_id, formation_id)

    bh_result = MagicMock()
    bh_result.scalars.return_value.all.return_value = [borehole]
    formations_result = MagicMock()
    formations_result.scalars.return_value.all.return_value = [formation]
    max_order_result = MagicMock()
    max_order_result.scalar_one.return_value = 0
    contacts_result = MagicMock()
    contacts_result.all.return_value = [pre_existing_row]

    call_count = 0

    async def side_effect(stmt, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return bh_result
        if call_count == 2:
            return formations_result
        if call_count == 3:
            return max_order_result
        return contacts_result

    session = AsyncMock()
    session.execute = AsyncMock(side_effect=side_effect)
    session.add = MagicMock()
    session.new = []
    session.flush = AsyncMock()
    session.commit = AsyncMock()

    with patch(
        "groundmodel.infrastructure.db.repositories.geology_repository.GeologyRepository.mark_surfaces_stale",
        new_callable=AsyncMock,
        return_value=0,
    ):
        # section_id=None → Fill path, found_contact_ids must be empty.
        outcome = await AutoPopulateContactsFromStratigraphy(session).execute(
            project_id=project_id,
            model_id=model_id,
            borehole_ids=[borehole_id],
            section_id=None,
        )

    assert outcome.found_contact_ids == [], (
        "found_contact_ids must be empty when section_id is None (Fill path)"
    )


# ---------------------------------------------------------------------------
# #58 — Formal↔Informal bridge
#
# B1–B6: build_formal_informal_bridge derivation
# R1–R4: _resolve_bridge_key pure function
# I1–I3: discover≡apply≡seed invariant across formal-only / informal-only /
#         dual-stream borehole combinations
# ---------------------------------------------------------------------------


# Bridge tests use a special session stub that returns boreholes to
# build_formal_informal_bridge (which does its own borehole SELECT).
def _make_bridge_session(boreholes: list) -> AsyncMock:
    """Build a mock session suitable for build_formal_informal_bridge.

    The function issues one SELECT (boreholes with observations+layers),
    so a single-result mock is enough.
    """
    result_mock = MagicMock()
    result_mock.scalars.return_value.all.return_value = boreholes
    session = AsyncMock()
    session.execute = AsyncMock(return_value=result_mock)
    return session


# ---------------------------------------------------------------------------
# B-series: build_formal_informal_bridge
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_bridge_B1_dual_stream_emits_pair():
    """B1: dual-stream borehole with overlapping layers emits formal→informal pair."""
    from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
        build_formal_informal_bridge,
        normalize_formation_key,
    )

    project_id = uuid4()
    formal_layer = _layer(top_m=0.0, base_m=10.0, description="KoKe")
    informal_layer = _layer(top_m=0.0, base_m=10.0, description="Paleogeen: Formatie van Kortrijk")
    bh = _borehole(
        [
            _observation(ObservationType.FORMAL_STRATIGRAPHY, [formal_layer]),
            _observation(ObservationType.INFORMAL_STRATIGRAPHY, [informal_layer]),
        ]
    )

    session = _make_bridge_session([bh])
    bridge = await build_formal_informal_bridge(session, project_id=project_id)

    norm_formal = normalize_formation_key("KoKe")
    norm_informal = normalize_formation_key("Paleogeen: Formatie van Kortrijk")
    assert bridge == {norm_formal: norm_informal}, (
        "Dual-stream borehole must produce one formal→informal bridge entry"
    )


@pytest.mark.asyncio
async def test_bridge_B2_formal_only_contributes_nothing():
    """B2: formal-only borehole (no informal stream) contributes nothing to the bridge."""
    from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
        build_formal_informal_bridge,
    )

    project_id = uuid4()
    bh = _borehole(
        [
            _observation(
                ObservationType.FORMAL_STRATIGRAPHY,
                [_layer(top_m=0.0, base_m=5.0, description="KoKe")],
            ),
        ]
    )

    session = _make_bridge_session([bh])
    bridge = await build_formal_informal_bridge(session, project_id=project_id)

    assert bridge == {}, "Formal-only borehole must not produce bridge entries"


@pytest.mark.asyncio
async def test_bridge_B3_informal_only_contributes_nothing():
    """B3: informal-only borehole (no formal stream) contributes nothing to the bridge."""
    from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
        build_formal_informal_bridge,
    )

    project_id = uuid4()
    bh = _borehole(
        [
            _observation(
                ObservationType.INFORMAL_STRATIGRAPHY,
                [_layer(top_m=0.0, base_m=5.0, description="Quartair")],
            ),
        ]
    )

    session = _make_bridge_session([bh])
    bridge = await build_formal_informal_bridge(session, project_id=project_id)

    assert bridge == {}, "Informal-only borehole must not produce bridge entries"


@pytest.mark.asyncio
async def test_bridge_B4_two_boreholes_agree():
    """B4: two dual-stream boreholes that agree on the same formal→informal pair
    produce exactly one bridge entry with that mapping.
    """
    from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
        build_formal_informal_bridge,
        normalize_formation_key,
    )

    project_id = uuid4()
    bh1 = _borehole(
        [
            _observation(
                ObservationType.FORMAL_STRATIGRAPHY,
                [_layer(top_m=0.0, base_m=8.0, description="Q")],
            ),
            _observation(
                ObservationType.INFORMAL_STRATIGRAPHY,
                [_layer(top_m=0.0, base_m=8.0, description="Quartair")],
            ),
        ]
    )
    bh2 = _borehole(
        [
            _observation(
                ObservationType.FORMAL_STRATIGRAPHY,
                [_layer(top_m=1.0, base_m=9.0, description="Q")],
            ),
            _observation(
                ObservationType.INFORMAL_STRATIGRAPHY,
                [_layer(top_m=1.0, base_m=9.0, description="Quartair")],
            ),
        ]
    )

    session = _make_bridge_session([bh1, bh2])
    bridge = await build_formal_informal_bridge(session, project_id=project_id)

    assert bridge == {normalize_formation_key("Q"): normalize_formation_key("Quartair")}, (
        "Two agreeing boreholes must produce a single stable bridge entry"
    )


@pytest.mark.asyncio
async def test_bridge_B5_disagreement_picks_majority_logs_warning(caplog):
    """B5: two dual-stream boreholes disagree on the mapping for the same formal code
    → majority vote wins, deterministic tie-break, WARNING is logged.
    """
    import logging

    from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
        build_formal_informal_bridge,
        normalize_formation_key,
    )

    project_id = uuid4()

    # bh1 and bh2: "A" → "Alluvium" (2 votes)
    # bh3: "A" → "Antropogeen" (1 vote)
    def _dual(formal_desc: str, informal_desc: str) -> SimpleNamespace:
        return _borehole(
            [
                _observation(
                    ObservationType.FORMAL_STRATIGRAPHY,
                    [_layer(top_m=0.0, base_m=5.0, description=formal_desc)],
                ),
                _observation(
                    ObservationType.INFORMAL_STRATIGRAPHY,
                    [_layer(top_m=0.0, base_m=5.0, description=informal_desc)],
                ),
            ]
        )

    bh1 = _dual("A", "Alluvium")
    bh2 = _dual("A", "Alluvium")
    bh3 = _dual("A", "Antropogeen")

    session = _make_bridge_session([bh1, bh2, bh3])
    with caplog.at_level(logging.WARNING):
        bridge = await build_formal_informal_bridge(session, project_id=project_id)

    # Majority "Alluvium" wins over minority "Antropogeen".
    assert bridge == {normalize_formation_key("A"): normalize_formation_key("Alluvium")}, (
        "Majority informal key must win when boreholes disagree"
    )

    # A WARNING must have been logged about the disagreement.
    assert any(
        "disagree" in r.message.lower() or "disagreeing" in r.message.lower()
        for r in caplog.records
    ), "A WARNING must be logged when dual-stream boreholes disagree on a mapping"


@pytest.mark.asyncio
async def test_bridge_B5_tie_broken_lexicographically(caplog):
    """B5 tie-break: when two informal keys are tied in vote count the
    lexicographically smaller one wins (deterministic, reproducible).
    """
    import logging

    from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
        build_formal_informal_bridge,
        normalize_formation_key,
    )

    project_id = uuid4()
    # "Q" → "Quartair" (1 vote) vs "Q" → "Zand" (1 vote)
    # normalize("quartair") < normalize("zand") lexicographically → "quartair" wins.
    bh1 = _borehole(
        [
            _observation(
                ObservationType.FORMAL_STRATIGRAPHY,
                [_layer(top_m=0.0, base_m=5.0, description="Q")],
            ),
            _observation(
                ObservationType.INFORMAL_STRATIGRAPHY,
                [_layer(top_m=0.0, base_m=5.0, description="Quartair")],
            ),
        ]
    )
    bh2 = _borehole(
        [
            _observation(
                ObservationType.FORMAL_STRATIGRAPHY,
                [_layer(top_m=0.0, base_m=5.0, description="Q")],
            ),
            _observation(
                ObservationType.INFORMAL_STRATIGRAPHY,
                [_layer(top_m=0.0, base_m=5.0, description="Zand")],
            ),
        ]
    )

    session = _make_bridge_session([bh1, bh2])
    with caplog.at_level(logging.WARNING):
        bridge = await build_formal_informal_bridge(session, project_id=project_id)

    # "quartair" < "zand" alphabetically → "quartair" wins.
    assert bridge == {normalize_formation_key("Q"): normalize_formation_key("Quartair")}, (
        "Lexicographically smaller key must win on a tie"
    )


@pytest.mark.asyncio
async def test_bridge_B6_no_overlap_produces_no_pair():
    """B6: dual-stream borehole where formal and informal layers do not overlap
    (formal layer is entirely above the informal layer) → no bridge pair emitted.
    """
    from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
        build_formal_informal_bridge,
    )

    project_id = uuid4()
    # Formal: 0–5 m; Informal: 10–20 m — no overlap whatsoever.
    bh = _borehole(
        [
            _observation(
                ObservationType.FORMAL_STRATIGRAPHY,
                [_layer(top_m=0.0, base_m=5.0, description="Q")],
            ),
            _observation(
                ObservationType.INFORMAL_STRATIGRAPHY,
                [_layer(top_m=10.0, base_m=20.0, description="Quartair")],
            ),
        ]
    )

    session = _make_bridge_session([bh])
    bridge = await build_formal_informal_bridge(session, project_id=project_id)

    assert bridge == {}, "Non-overlapping formal/informal layers must not produce a bridge pair"


# ---------------------------------------------------------------------------
# R-series: _resolve_bridge_key — pure function, no I/O
# ---------------------------------------------------------------------------


def test_resolve_bridge_R1_formal_in_bridge_returns_mapped_key():
    """R1: formal key present in bridge → returns the mapped informal key."""
    from groundmodel.application.stratigraphy_bridge import (
        _resolve_bridge_key,
        normalize_formation_key,
    )

    bridge = {normalize_formation_key("KoKe"): normalize_formation_key("Formatie van Kortrijk")}
    # #59: _resolve_bridge_key now returns (resolved_key, canonical_or_None).
    # An in-project bridge hit wins over the lexicon → canonical is None.
    result = _resolve_bridge_key(
        normalize_formation_key("KoKe"),
        primary_is_formal=True,
        bridge=bridge,
    )
    assert result == (normalize_formation_key("Formatie van Kortrijk"), None)


def test_resolve_bridge_R2_formal_not_in_bridge_returns_raw():
    """R2: formal key absent from bridge AND absent from the #59 lexicon →
    raw_key returned unchanged, canonical None.

    Uses a synthetic code that is NOT a real DOV permkey so the lexicon
    misses (a real code like "Q" now resolves via #59 — covered by the
    C-series).
    """
    from groundmodel.application.stratigraphy_bridge import (
        _resolve_bridge_key,
        normalize_formation_key,
    )

    bridge = {normalize_formation_key("KoKe"): normalize_formation_key("Formatie van Kortrijk")}
    raw = normalize_formation_key("ZZX_NOT_A_DOV_CODE")
    result = _resolve_bridge_key(raw, primary_is_formal=True, bridge=bridge)
    assert result == (raw, None), "Unknown key must pass through unchanged"


def test_resolve_bridge_R3_informal_untouched_even_when_in_bridge():
    """R3: informal key (primary_is_formal=False) → raw_key returned even if bridge contains it.

    The bridge is formal→informal; informal keys must never be remapped —
    doing so would create a double-remap and corrupt the identity model.
    """
    from groundmodel.application.stratigraphy_bridge import (
        _resolve_bridge_key,
        normalize_formation_key,
    )

    # Construct a bridge where the informal key happens to equal a formal key.
    informal_key = normalize_formation_key("Quartair")
    bridge = {informal_key: normalize_formation_key("Something Else")}
    result = _resolve_bridge_key(informal_key, primary_is_formal=False, bridge=bridge)
    assert result == (informal_key, None), "Informal keys must never be remapped"


def test_resolve_bridge_R4_none_bridge_is_noop():
    """R4: bridge=None AND lexicon miss → raw_key unchanged, canonical None.

    Synthetic non-DOV code so the #59 lexicon misses; a real code with
    bridge=None now resolves via the lexicon (the #59 point) — C-series.
    """
    from groundmodel.application.stratigraphy_bridge import (
        _resolve_bridge_key,
        normalize_formation_key,
    )

    raw = normalize_formation_key("ZZX_NOT_A_DOV_CODE")
    assert _resolve_bridge_key(raw, primary_is_formal=True, bridge=None) == (raw, None)


# ---------------------------------------------------------------------------
# I-series: discover≡apply≡seed invariant across vocabulary namespaces
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_invariant_I1_cross_borehole_formal_informal_merge_with_bridge():
    """I1: formal-only borehole + informal-only borehole + a dual-stream borehole
    that proves the equivalence → scan returns ONE candidate (bridged) AND execute
    creates ONE formation (same bridged key).

    This is the load-bearing regression test for #58:
    without the bridge, two separate candidates ("koke" and
    "paleogeen formatie van kortrijk") are returned.
    """
    from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
        AutoPopulateContactsFromStratigraphy,
        build_formal_informal_bridge,
        normalize_formation_key,
    )

    project_id = uuid4()
    model_id = uuid4()

    # Dual-stream borehole: proves KoKe ↔ "Paleogeen: Formatie van Kortrijk".
    bh_dual = _borehole(
        [
            _observation(
                ObservationType.FORMAL_STRATIGRAPHY,
                [_layer(top_m=5.0, base_m=20.0, description="KoKe")],
            ),
            _observation(
                ObservationType.INFORMAL_STRATIGRAPHY,
                [_layer(top_m=5.0, base_m=20.0, description="Paleogeen: Formatie van Kortrijk")],
            ),
        ]
    )
    # Formal-only borehole (the problem case pre-bridge).
    bh_formal_only = _borehole(
        [
            _observation(
                ObservationType.FORMAL_STRATIGRAPHY,
                [_layer(top_m=3.0, base_m=18.0, description="KoKe")],
            ),
        ]
    )
    # Informal-only borehole (the problem case pre-bridge).
    bh_informal_only = _borehole(
        [
            _observation(
                ObservationType.INFORMAL_STRATIGRAPHY,
                [_layer(top_m=4.0, base_m=22.0, description="Paleogeen: Formatie van Kortrijk")],
            ),
        ]
    )

    # --- discover side ---
    all_boreholes = [bh_dual, bh_formal_only, bh_informal_only]
    bridge_session = _make_bridge_session(all_boreholes)
    bridge = await build_formal_informal_bridge(bridge_session, project_id=project_id)

    scan_session = _make_session(all_boreholes)
    candidates, collisions = await scan_stratigraphy_candidates(
        scan_session,
        project_id=project_id,
        borehole_ids=[bh_dual.id, bh_formal_only.id, bh_informal_only.id],
        bridge=bridge,
    )

    # With the bridge, KoKe maps to norm("Paleogeen: Formatie van Kortrijk")
    # so all three boreholes contribute to ONE candidate.
    assert len(candidates) == 1, (
        f"I1: expected 1 bridged candidate, got {len(candidates)}: {[c.key for c in candidates]}"
    )
    c = candidates[0]
    assert c.borehole_count == 3, f"I1: all 3 boreholes must contribute; got {c.borehole_count}"
    assert c.key == normalize_formation_key("Paleogeen: Formatie van Kortrijk"), (
        f"I1: candidate key must be the bridged informal key, got '{c.key}'"
    )

    # --- apply side (execute) ---
    # Reuse the same stub pattern as the other execute tests.
    bh_result = MagicMock()
    bh_result.scalars.return_value.all.return_value = all_boreholes

    empty_formations = MagicMock()
    empty_formations.scalars.return_value.all.return_value = []

    max_order = MagicMock()
    max_order.scalar_one.return_value = 0

    empty_contacts = MagicMock()
    empty_contacts.all.return_value = []

    call_count = 0

    async def side_effect(stmt, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return bh_result
        if call_count == 2:
            return empty_formations
        if call_count == 3:
            return max_order
        return empty_contacts

    session = AsyncMock()
    session.execute = AsyncMock(side_effect=side_effect)
    session.add = MagicMock()
    session.new = []
    session.flush = AsyncMock()
    session.commit = AsyncMock()

    with patch(
        "groundmodel.infrastructure.db.repositories.geology_repository.GeologyRepository.mark_surfaces_stale",
        new_callable=AsyncMock,
        return_value=0,
    ):
        outcome = await AutoPopulateContactsFromStratigraphy(session).execute(
            project_id=project_id,
            model_id=model_id,
            borehole_ids=[bh_dual.id, bh_formal_only.id, bh_informal_only.id],
            bridge=bridge,
        )

    # With the bridge, all three boreholes resolve to ONE formation → 3 contacts.
    assert len(outcome.created_formation_ids) == 1, (
        f"I1 apply: expected 1 formation, got {len(outcome.created_formation_ids)}"
    )
    assert len(outcome.created_contact_ids) == 3, (
        f"I1 apply: expected 3 contacts (one per borehole), got {len(outcome.created_contact_ids)}"
    )


@pytest.mark.asyncio
async def test_invariant_I2_no_bridge_regression_guard():
    """I2: without a bridge (bridge=None), formal-only and informal-only boreholes
    yield TWO distinct candidates — the pre-#58 baseline behaviour is preserved
    so the fix is additive, not a breaking change.
    """
    project_id = uuid4()

    bh_formal = _borehole(
        [
            _observation(
                ObservationType.FORMAL_STRATIGRAPHY,
                [_layer(top_m=0.0, base_m=10.0, description="KoKe")],
            ),
        ]
    )
    bh_informal = _borehole(
        [
            _observation(
                ObservationType.INFORMAL_STRATIGRAPHY,
                [_layer(top_m=0.0, base_m=10.0, description="Paleogeen: Formatie van Kortrijk")],
            ),
        ]
    )

    session = _make_session([bh_formal, bh_informal])
    candidates, _ = await scan_stratigraphy_candidates(
        session,
        project_id=project_id,
        borehole_ids=[bh_formal.id, bh_informal.id],
        bridge=None,  # no bridge → two separate candidates
    )

    assert len(candidates) == 2, (
        f"I2: bridge=None must produce 2 separate candidates, got {len(candidates)}"
    )
    keys = {c.key for c in candidates}
    from groundmodel.application.stratigraphy_bridge import (
        normalize_formation_key,
    )

    assert normalize_formation_key("KoKe") in keys
    assert normalize_formation_key("Paleogeen: Formatie van Kortrijk") in keys


@pytest.mark.asyncio
async def test_invariant_I3_manual_map_overrides_bridge():
    """I3: manual_map entry always overrides the bridge — precedence is
    raw → bridge → manual_map (manual_map wins at the end of the chain).

    Scenario: bridge maps norm("KoKe") → norm("Paleogeen: Formatie van Kortrijk").
    The user also provides a manual_map that redirects the bridged key to
    a custom target "Kortrijk Formation".  The effective key must be the
    manual_map target, NOT the bridged key.
    """
    from groundmodel.application.stratigraphy_bridge import (
        normalize_formation_key,
    )

    project_id = uuid4()

    bh_formal = _borehole(
        [
            _observation(
                ObservationType.FORMAL_STRATIGRAPHY,
                [_layer(top_m=0.0, base_m=10.0, description="KoKe")],
            ),
        ]
    )

    norm_informal_key = normalize_formation_key("Paleogeen: Formatie van Kortrijk")
    bridge = {normalize_formation_key("KoKe"): norm_informal_key}
    # manual_map redirects the bridged informal key to "Kortrijk Formation"
    manual_map = {norm_informal_key: "Kortrijk Formation"}

    session = _make_session([bh_formal])
    candidates, _ = await scan_stratigraphy_candidates(
        session,
        project_id=project_id,
        borehole_ids=[bh_formal.id],
        bridge=bridge,
        manual_map=manual_map,
    )

    assert len(candidates) == 1
    c = candidates[0]
    # The effective key must be the manual_map target (not the bridged key).
    assert c.key == normalize_formation_key("Kortrijk Formation"), (
        f"I3: manual_map must win over bridge; got key='{c.key}'"
    )
    assert c.name == "Kortrijk Formation", (
        f"I3: display name must be the manual_map target; got name='{c.name}'"
    )


# ---------------------------------------------------------------------------
# L-series: lump-wins-over-bridge precedence (revised 2026-05-18)
#
# Owner directive: an explicit user lump on the RAW key wins outright over
# the data-inferred formal↔informal bridge.  The load-bearing case is a
# stratigraphy_lumping map persisted in a .gmproj BEFORE the #58 bridge
# shipped — its keys are the pre-bridge raw formal codes; with the old
# raw→bridge→lump order the bridge rewrote the key out from under those
# entries and the lump silently dropped (a fresh formal-keyed formation
# was created next to the user's lumped one — the dogfeed bug 2026-05-18).
# ---------------------------------------------------------------------------


def test_resolve_lumped_key_L1_raw_lump_wins_over_bridge():
    """L1: raw key present in manual_map → bridge is NOT applied; the user's
    explicit lump target is the effective key.  This is the pre-#58 stale-lump
    fix in its purest form (saved map keyed on the raw formal code).
    """
    from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
        _resolve_lumped_key,
        normalize_formation_key,
    )

    raw = normalize_formation_key("KoRo")
    # Bridge WOULD remap KoRo → the informal name (pre-fix this stole the key).
    bridge = {raw: normalize_formation_key("Paleogeen: Formatie van Kortrijk - Lid van Roubaix")}
    # Pre-#58 saved map: keyed on the RAW formal code.
    manual_map = {raw: "Pleistoceen"}

    eff_key, eff_name, was_lumped = _resolve_lumped_key(
        raw, primary_is_formal=True, bridge=bridge, manual_map=manual_map
    )

    assert eff_key == normalize_formation_key("Pleistoceen"), (
        f"L1: raw lump must win over the bridge; got eff_key='{eff_key}'"
    )
    assert eff_name == "Pleistoceen"
    assert was_lumped is True


def test_resolve_lumped_key_L2_blank_raw_target_falls_through_to_bridge():
    """L2: a blank/whitespace manual_map target on the raw key is treated as
    unmapped (no nameless formation) → resolution falls through to the bridge.
    """
    from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
        _resolve_lumped_key,
        normalize_formation_key,
    )

    raw = normalize_formation_key("KoRo")
    bridged = normalize_formation_key("Paleogeen Roubaix")
    bridge = {raw: bridged}
    manual_map = {raw: "   "}  # blank target — guarded by _resolve_effective_key

    eff_key, eff_name, was_lumped = _resolve_lumped_key(
        raw, primary_is_formal=True, bridge=bridge, manual_map=manual_map
    )

    assert eff_key == bridged, (
        f"L2: blank raw target must fall through to the bridge; got '{eff_key}'"
    )
    assert was_lumped is False


def test_resolve_lumped_key_L3_bridged_lump_still_applies_when_raw_unlumped():
    """L3: when the raw key is NOT in manual_map, the original #58 path is
    retained — bridge runs, then the lump is consulted on the bridged key
    (this is the I3 contract, now via the shared helper).
    """
    from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
        _resolve_lumped_key,
        normalize_formation_key,
    )

    raw = normalize_formation_key("KoKe")
    bridged = normalize_formation_key("Paleogeen: Formatie van Kortrijk")
    bridge = {raw: bridged}
    manual_map = {bridged: "Kortrijk Formation"}  # keyed on the BRIDGED identity

    eff_key, eff_name, was_lumped = _resolve_lumped_key(
        raw, primary_is_formal=True, bridge=bridge, manual_map=manual_map
    )

    assert eff_key == normalize_formation_key("Kortrijk Formation")
    assert eff_name == "Kortrijk Formation"
    assert was_lumped is True


@pytest.mark.asyncio
async def test_scan_L4_pre58_stale_lump_map_resolves_without_relump():
    """L4 (regression — the dogfeed bug): a formal-only borehole + a bridge that
    would remap its code + a manual_map keyed on the RAW formal code (the
    pre-#58 saved-map shape).  The scan must return ONE candidate under the
    user's lump target — NOT a fresh bridge/formal-keyed candidate.
    """
    from groundmodel.application.stratigraphy_bridge import (
        normalize_formation_key,
    )

    project_id = uuid4()
    bh_formal_only = _borehole(
        [
            _observation(
                ObservationType.FORMAL_STRATIGRAPHY,
                [_layer(top_m=0.0, base_m=10.0, description="KoRo")],
            ),
        ]
    )

    raw = normalize_formation_key("KoRo")
    bridge = {raw: normalize_formation_key("Paleogeen: Formatie van Kortrijk - Lid van Roubaix")}
    manual_map = {raw: "Pleistoceen"}  # user's pre-#58 lump, keyed on raw code

    session = _make_session([bh_formal_only])
    candidates, _ = await scan_stratigraphy_candidates(
        session,
        project_id=project_id,
        borehole_ids=[bh_formal_only.id],
        bridge=bridge,
        manual_map=manual_map,
    )

    assert len(candidates) == 1, (
        f"L4: expected the single lumped candidate, got {[c.key for c in candidates]}"
    )
    c = candidates[0]
    assert c.key == normalize_formation_key("Pleistoceen"), (
        f"L4: stale pre-#58 lump must resolve without re-lumping; got key='{c.key}'"
    )
    assert c.name == "Pleistoceen"


@pytest.mark.asyncio
async def test_execute_L5_pre58_stale_lump_creates_single_lumped_formation():
    """L5: the L4 scenario through execute() — exactly ONE formation is
    created, named after the user's lump target ("Pleistoceen"), NOT a
    formal-keyed "KoRo"/bridged-informal duplicate.  Asserts discover≡apply
    for the new precedence via the shared helper.
    """
    from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
        AutoPopulateContactsFromStratigraphy,
        normalize_formation_key,
    )

    project_id = uuid4()
    model_id = uuid4()
    bh_formal_only = _borehole(
        [
            _observation(
                ObservationType.FORMAL_STRATIGRAPHY,
                [_layer(top_m=0.0, base_m=10.0, description="KoRo")],
            ),
        ]
    )

    raw = normalize_formation_key("KoRo")
    bridge = {raw: normalize_formation_key("Paleogeen: Formatie van Kortrijk - Lid van Roubaix")}
    manual_map = {raw: "Pleistoceen"}

    bh_result = MagicMock()
    bh_result.scalars.return_value.all.return_value = [bh_formal_only]
    empty_formations = MagicMock()
    empty_formations.scalars.return_value.all.return_value = []
    max_order = MagicMock()
    max_order.scalar_one.return_value = 0
    empty_contacts = MagicMock()
    empty_contacts.all.return_value = []

    call_count = 0

    async def side_effect(stmt, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return bh_result
        if call_count == 2:
            return empty_formations
        if call_count == 3:
            return max_order
        return empty_contacts

    added: list = []
    session = AsyncMock()
    session.execute = AsyncMock(side_effect=side_effect)
    session.add = MagicMock(side_effect=added.append)
    session.new = []
    session.flush = AsyncMock()
    session.commit = AsyncMock()

    with patch(
        "groundmodel.infrastructure.db.repositories.geology_repository.GeologyRepository.mark_surfaces_stale",
        new_callable=AsyncMock,
        return_value=0,
    ):
        outcome = await AutoPopulateContactsFromStratigraphy(session).execute(
            project_id=project_id,
            model_id=model_id,
            borehole_ids=[bh_formal_only.id],
            bridge=bridge,
            manual_map=manual_map,
        )

    assert len(outcome.created_formation_ids) == 1, (
        f"L5: expected exactly 1 lumped formation, got {len(outcome.created_formation_ids)}"
    )
    # The added formation must carry the user's lump NAME, not the formal code
    # or the bridged informal name.
    formations = [o for o in added if hasattr(o, "display_order")]
    assert len(formations) == 1
    assert formations[0].name == "Pleistoceen", (
        f"L5: formation must be named after the user's lump target; got name='{formations[0].name}'"
    )
    # regional_ref is still the raw formal code (provenance preserved).
    assert formations[0].regional_ref == "KoRo"


# ---------------------------------------------------------------------------
# C-series: #59 DOV formal-stratigraphy lexicon
#
# The lexicon slots into _resolve_bridge_key AFTER the in-project bridge and
# BEFORE raw passthrough, so formal-only boreholes stop splitting one unit
# into code-vs-name twins. The two "user can still lump afterwards"
# guarantees are C6 (raw-code lump) and C7 (lump the resolved candidate).
# ---------------------------------------------------------------------------

_KORO_CANON = "Lid van Roubaix (Formatie van Kortrijk)"


@pytest.mark.asyncio
async def test_scan_C1_formal_only_codelist_hit_uses_canonical_name():
    """C1: a formal-only 'KoRo' borehole resolves to the canonical DOV name;
    regional_ref keeps the raw code (provenance), key = normalize(canonical)."""
    from groundmodel.application.stratigraphy_bridge import (
        normalize_formation_key,
    )

    project_id = uuid4()
    bh = _borehole(
        [
            _observation(
                ObservationType.FORMAL_STRATIGRAPHY,
                [_layer(top_m=0.0, base_m=8.0, description="KoRo")],
            )
        ]
    )
    session = _make_session([bh])
    candidates, _ = await scan_stratigraphy_candidates(
        session, project_id=project_id, borehole_ids=[bh.id]
    )
    assert len(candidates) == 1
    c = candidates[0]
    assert c.name == _KORO_CANON
    assert c.regional_ref == "KoRo"  # raw upstream token preserved
    assert c.key == normalize_formation_key(_KORO_CANON)


def test_C2_compound_code_composed():
    """C2: compound 'QH-T-QP' decomposes + composes the 'tot' range name."""
    from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
        _resolve_lumped_key,
        normalize_formation_key,
    )

    eff_key, eff_name, use_name = _resolve_lumped_key(
        normalize_formation_key("QH-T-QP"),
        primary_is_formal=True,
        bridge=None,
        manual_map=None,
    )
    assert eff_name == "Quartair Holoceen tot Quartair Pleistoceen"
    assert use_name is True
    assert eff_key == normalize_formation_key(eff_name)


def test_C3_sentinel_U_falls_through_not_onbekend():
    """C3: 'U' (Onbekend) is a sentinel — falls through to the raw token,
    never an 'Onbekend' formation that swallows unknown layers."""
    from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
        _resolve_lumped_key,
        normalize_formation_key,
    )

    raw = normalize_formation_key("U")
    eff_key, eff_name, use_name = _resolve_lumped_key(
        raw, primary_is_formal=True, bridge=None, manual_map=None
    )
    assert eff_key == raw
    assert use_name is False
    assert "onbekend" not in eff_name.lower()


def test_C4_lexicon_miss_passthrough():
    """C4: a non-DOV code is a miss → raw key unchanged, name not authoritative."""
    from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
        _resolve_lumped_key,
        normalize_formation_key,
    )

    raw = normalize_formation_key("ZZX_NOT_A_DOV_CODE")
    assert _resolve_lumped_key(raw, primary_is_formal=True, bridge=None, manual_map=None) == (
        raw,
        raw,
        False,
    )


def test_C5_in_project_bridge_beats_lexicon():
    """C5: a dual-stream-proven in-project bridge entry wins over the global
    lexicon (project data is authoritative)."""
    from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
        _resolve_lumped_key,
        normalize_formation_key,
    )

    raw = normalize_formation_key("KoRo")
    bridge = {raw: normalize_formation_key("In-Project Roubaix")}
    eff_key, _eff_name, _u = _resolve_lumped_key(
        raw, primary_is_formal=True, bridge=bridge, manual_map=None
    )
    assert eff_key == normalize_formation_key("In-Project Roubaix")
    assert eff_key != normalize_formation_key(_KORO_CANON)


def test_C6_user_can_still_lump_raw_code_beats_lexicon():
    """C6 (user-can-still-lump #1): an explicit lump on the RAW code wins
    outright — the lexicon is not even consulted."""
    from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
        _resolve_lumped_key,
        normalize_formation_key,
    )

    raw = normalize_formation_key("KoRo")
    eff_key, eff_name, use_name = _resolve_lumped_key(
        raw,
        primary_is_formal=True,
        bridge=None,
        manual_map={raw: "My Roubaix Clay"},
    )
    assert (eff_key, eff_name, use_name) == (
        normalize_formation_key("My Roubaix Clay"),
        "My Roubaix Clay",
        True,
    )


def test_C7_user_can_still_lump_resolved_candidate_beats_lexicon():
    """C7 (user-can-still-lump #2): after the lexicon resolves KoRo to its
    canonical name, the user lumps THAT candidate (the key the Fill dialog
    now shows) — the lump still wins over the canonical name."""
    from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
        _resolve_lumped_key,
        normalize_formation_key,
    )

    raw = normalize_formation_key("KoRo")
    canonical_key = normalize_formation_key(_KORO_CANON)
    eff_key, eff_name, use_name = _resolve_lumped_key(
        raw,
        primary_is_formal=True,
        bridge=None,
        manual_map={canonical_key: "My Roubaix Clay"},
    )
    assert (eff_key, eff_name, use_name) == (
        normalize_formation_key("My Roubaix Clay"),
        "My Roubaix Clay",
        True,
    )


@pytest.mark.asyncio
async def test_C8_existing_raw_code_formation_reused_not_duplicated():
    """C8: a pre-#59 formation (regional_ref='KoRo', keyed 'koro') is REUSED
    when a new 'KoRo' layer resolves to the canonical key — no duplicate
    formation; the contact attaches to the existing formation id."""
    from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
        AutoPopulateContactsFromStratigraphy,
    )

    project_id = uuid4()
    model_id = uuid4()
    existing = _formation_stub(name="KoRo", regional_ref="KoRo", display_order=0)
    bh = _borehole(
        [
            _observation(
                ObservationType.FORMAL_STRATIGRAPHY,
                [_layer(top_m=0.0, base_m=6.0, description="KoRo")],
            )
        ]
    )

    bh_result = MagicMock()
    bh_result.scalars.return_value.all.return_value = [bh]
    formations_result = MagicMock()
    formations_result.scalars.return_value.all.return_value = [existing]
    max_order = MagicMock()
    max_order.scalar_one.return_value = 0
    empty_contacts = MagicMock()
    empty_contacts.all.return_value = []  # no existing contacts → new one created

    call = 0

    async def side_effect(stmt, **kwargs):
        nonlocal call
        call += 1
        if call == 1:
            return bh_result
        if call == 2:
            return formations_result
        if call == 3:
            return max_order
        return empty_contacts

    added: list = []
    session = AsyncMock()
    session.execute = AsyncMock(side_effect=side_effect)
    session.add = MagicMock(side_effect=added.append)
    session.new = []
    session.flush = AsyncMock()
    session.commit = AsyncMock()

    with patch(
        "groundmodel.infrastructure.db.repositories.geology_repository."
        "GeologyRepository.mark_surfaces_stale",
        new_callable=AsyncMock,
        return_value=0,
    ):
        outcome = await AutoPopulateContactsFromStratigraphy(session).execute(
            project_id=project_id, model_id=model_id, borehole_ids=[bh.id]
        )

    # No new formation (existing 'KoRo' row reused under the canonical key).
    assert outcome.created_formation_ids == []
    assert len(outcome.created_contact_ids) == 1
    # No GeologicalFormationOrm added; the contact points at the existing id.
    assert not any(hasattr(o, "display_order") for o in added)
    contacts = [o for o in added if hasattr(o, "depth_top_m")]
    assert len(contacts) == 1
    assert contacts[0].formation_id == existing.id


@pytest.mark.asyncio
async def test_C9_discover_execute_parity_for_codelist_resolved_code():
    """C9: discover≡execute — the scan candidate key for a codelist-resolved
    formal-only borehole equals the resolver's effective key (the shared
    _resolve_lumped_key guarantees this structurally)."""
    from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
        _resolve_lumped_key,
        normalize_formation_key,
    )

    project_id = uuid4()
    bh = _borehole(
        [
            _observation(
                ObservationType.FORMAL_STRATIGRAPHY,
                [_layer(top_m=0.0, base_m=5.0, description="KoRo")],
            )
        ]
    )
    session = _make_session([bh])
    candidates, _ = await scan_stratigraphy_candidates(
        session, project_id=project_id, borehole_ids=[bh.id]
    )
    eff_key, _n, _u = _resolve_lumped_key(
        normalize_formation_key("KoRo"),
        primary_is_formal=True,
        bridge=None,
        manual_map=None,
    )
    assert candidates[0].key == eff_key == normalize_formation_key(_KORO_CANON)


def test_C2b_compound_with_sentinel_atom_falls_through():
    """C2b: a compound whose left/right atom is the 'U' sentinel (Onbekend)
    returns the raw token unchanged — never a half-resolved name."""
    from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
        _resolve_lumped_key,
        normalize_formation_key,
    )

    raw = normalize_formation_key("QH-T-U")  # -> "qh t u"
    eff_key, _name, use_name = _resolve_lumped_key(
        raw, primary_is_formal=True, bridge=None, manual_map=None
    )
    assert eff_key == raw, "Sentinel atom must fall the whole compound through"
    assert use_name is False
