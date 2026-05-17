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
    formal_layer = _layer(top_m=2.0, base_m=10.0, description="HyEg")
    informal_layer = _layer(top_m=2.0, base_m=10.0, description="Boom Klei")
    bh = _borehole(
        [
            _observation(ObservationType.FORMAL_STRATIGRAPHY, [formal_layer]),
            _observation(ObservationType.INFORMAL_STRATIGRAPHY, [informal_layer]),
        ]
    )

    session = _make_session([bh])
    candidates = await scan_stratigraphy_candidates(
        session, project_id=project_id, borehole_ids=[bh.id]
    )

    assert len(candidates) == 1
    c = candidates[0]
    assert c.name == "Boom Klei"
    assert c.regional_ref == "HyEg"
    assert c.key == "hyeg"
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
    candidates = await scan_stratigraphy_candidates(
        session, project_id=project_id, borehole_ids=[bh.id]
    )

    assert len(candidates) == 1
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

    # bh1: formal HyEg / informal "Boom Klei"
    bh1 = _borehole(
        [
            _observation(
                ObservationType.FORMAL_STRATIGRAPHY,
                [_layer(top_m=2.0, base_m=10.0, description="HyEg")],
            ),
            _observation(
                ObservationType.INFORMAL_STRATIGRAPHY,
                [_layer(top_m=2.0, base_m=10.0, description="Boom Klei")],
            ),
        ]
    )
    # bh2: same formal HyEg but different informal working name "Rupel Klei"
    bh2 = _borehole(
        [
            _observation(
                ObservationType.FORMAL_STRATIGRAPHY,
                [_layer(top_m=3.0, base_m=12.0, description="HyEg")],
            ),
            _observation(
                ObservationType.INFORMAL_STRATIGRAPHY,
                [_layer(top_m=3.0, base_m=12.0, description="Rupel Klei")],
            ),
        ]
    )

    session = _make_session([bh1, bh2])
    candidates = await scan_stratigraphy_candidates(
        session, project_id=project_id, borehole_ids=[bh1.id, bh2.id]
    )

    # Must be ONE candidate (merged on formal key "HyEg"), NOT two.
    assert len(candidates) == 1
    c = candidates[0]
    assert c.key == "hyeg"
    assert c.regional_ref == "HyEg"
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
# normalize_formation_key — the dedup / merge canonicaliser
# ---------------------------------------------------------------------------


def test_normalize_collapses_dash_space_case_variants():
    """The dogfeed duplicate: 'Formatie van Aalter - Lid van Oedelem' showed
    twice because one borehole used an en-dash / double space / different
    case. All such variants must map to ONE key.

    After step 5 ('lid van' reduction, owner directive 2026-05-17) the
    canonical key for any 'Lid van Oedelem'-bearing description is
    'lid van oedelem', regardless of the parent formation prefix.
    """
    canonical = normalize_formation_key("Paleogeen: Formatie van Aalter - Lid van Oedelem")
    assert canonical == "lid van oedelem"
    variants = [
        "Paleogeen: Formatie van Aalter – Lid van Oedelem",  # en-dash (U+2013)
        "Paleogeen: Formatie van Aalter  -  Lid  van Oedelem",  # double spaces
        "Paleogeen:\xa0Formatie van Aalter - Lid van Oedelem",  # NBSP after colon (U+00A0)
        "PALEOGEEN: FORMATIE VAN AALTER - LID VAN OEDELEM",  # upper-case
        "  Paleogeen: Formatie van Aalter - Lid van Oedelem  ",  # outer ws
    ]
    for v in variants:
        assert normalize_formation_key(v) == canonical, v


def test_normalize_strips_chronostratigraphic_prefix_before_last_colon():
    """Owner directive 2026-05-17: the chrono backbone before the colon is
    presentation; the same lithostratigraphic unit under 'Paleogeen:' and
    'Tertiair - Eoceen:' must merge."""
    assert normalize_formation_key(
        "Paleogeen: Formatie van Aalter - Lid van Oedelem"
    ) == normalize_formation_key("Tertiair - Eoceen: Formatie van Aalter - Lid van Oedelem")
    # Multiple colons -> split on the LAST one only.
    assert (
        normalize_formation_key("Aangebracht/geroerd of Quartair: Holocene afzettingen")
        == "holocene afzettingen"
    )


def test_normalize_no_colon_uses_whole_string():
    """No colon -> the whole string is the identity (just folded)."""
    assert normalize_formation_key("Quartair") == "quartair"
    assert normalize_formation_key("Ma") == "ma"


def test_normalize_trailing_colon_falls_back_to_content():
    """A description whose post-colon part is empty must fall back to the
    whole normalised string, not become a blank key that merges unrelated
    rows."""
    assert normalize_formation_key("Boom:") == "boom"
    assert normalize_formation_key("Quartair :") == "quartair"


def test_normalize_lid_van_reduces_to_member():
    """Owner directive 2026-05-17: 'Tertiair: Lid van Oedelem' and
    'Paleogeen: Formatie van Aalter - Lid van Oedelem' must both produce
    'lid van oedelem' so the same member merges across different parent
    formations in the discover-scan dialog."""
    assert normalize_formation_key("Tertiair: Lid van Oedelem") == "lid van oedelem"
    assert (
        normalize_formation_key("Paleogeen: Formatie van Aalter - Lid van Oedelem")
        == "lid van oedelem"
    )


def test_normalize_no_lid_van_keeps_full_key():
    """Strings without 'lid van' are unaffected by step 5 -- their full
    normalised key is returned unchanged."""
    assert normalize_formation_key("Quartair") == "quartair"
    assert (
        normalize_formation_key("Formatie van Maldegem of Formatie van Aalter")
        == "formatie van maldegem of formatie van aalter"
    )
    assert normalize_formation_key("Ma") == "ma"


def test_normalize_distinct_members_stay_separate():
    """Two different members under the same parent formation produce different
    keys -- 'lid van' reduction does NOT over-merge distinct units."""
    assert normalize_formation_key(
        "Paleogeen: Formatie van Aalter - Lid van Oedelem"
    ) != normalize_formation_key("Paleogeen: Formatie van Aalter - Lid van Vlierzele")
    assert normalize_formation_key("Tertiair: Lid van Oedelem") == "lid van oedelem"
    assert normalize_formation_key("Tertiair: Lid van Vlierzele") == "lid van vlierzele"


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
) -> AsyncMock:
    """Mock session that serves *existing_formations* on the formations-load call.

    Call sequence inside execute() when ``selected_keys`` is provided:
      1. borehole load
      2. formations load
      3. max display_order
      4+. orphan DELETE / contacts load / formation DELETE — generic mock
    """
    bh_result = MagicMock()
    bh_result.scalars.return_value.all.return_value = boreholes

    formations_result = MagicMock()
    formations_result.scalars.return_value.all.return_value = existing_formations

    max_order_result = MagicMock()
    max_order_result.scalar_one.return_value = max(
        (f.display_order for f in existing_formations), default=0
    )

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
        # Remaining calls: orphan DELETE, contacts load, formation DELETE.
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
        )

    assert old_formation.id in outcome.deleted_formation_ids
    assert len(outcome.deleted_formation_ids) == 1
    assert len(outcome.created_formation_ids) == 0


@pytest.mark.asyncio
async def test_execute_selected_canonical_variant_not_deleted():
    """A formation whose canonical key IS in selected_keys must not be deleted
    even when its raw ``regional_ref`` uses a dash-bearing DOV name.

    This is the exact scenario that caused the da98053 freeze: a formation with
    ``regional_ref = "Paleogeen: Formatie van Aalter - Lid van Oedelem"`` has
    canonical key ``"lid van oedelem"`` (after normalize_formation_key).  The
    old client-side ``".toLowerCase()"`` produced the full raw string, which did
    not match the server-minted key, so the formation was wrongly deleted.
    """
    from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
        AutoPopulateContactsFromStratigraphy,
    )

    project_id = uuid4()
    model_id = uuid4()

    formation = _formation_stub(
        name="Boom Klei",
        regional_ref="Paleogeen: Formatie van Aalter - Lid van Oedelem",
    )

    session = _make_session_with_formations(boreholes=[], existing_formations=[formation])

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
            # Canonical key for the formation above is "lid van oedelem".
            selected_keys=["lid van oedelem"],
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
        )

    assert set(outcome.deleted_formation_ids) == {deleted_a.id, deleted_b.id}
    assert kept.id not in outcome.deleted_formation_ids
    assert len(outcome.created_formation_ids) == 0
