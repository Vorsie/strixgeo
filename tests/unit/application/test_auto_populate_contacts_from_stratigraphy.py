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
    formal_layer = _layer(top_m=2.0, base_m=10.0, description="HyEg")
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
    candidates, collisions = await scan_stratigraphy_candidates(
        session, project_id=project_id, borehole_ids=[bh1.id, bh2.id]
    )

    # Must be ONE candidate (merged on formal key "HyEg"), NOT two.
    assert len(candidates) == 1
    assert collisions == []
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

    # Build synthetic contact rows: (observation_layer_id, borehole_id, formation_id).
    # One row per in-model formation, enough for model_formation_ids to be populated.
    model_scope = in_model_formations if in_model_formations is not None else existing_formations
    contacts_result = MagicMock()
    contacts_result.all.return_value = [(None, uuid4(), f.id) for f in model_scope]

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
        )

    # The in-this-model unselected formation IS deleted.
    assert unselected_in_model.id in outcome.deleted_formation_ids
    # The sibling-model-only formation is NOT deleted (no contacts in this model).
    assert sibling_formation.id not in outcome.deleted_formation_ids
    # The selected in-model formation is NOT deleted.
    assert in_model_formation.id not in outcome.deleted_formation_ids
    assert len(outcome.deleted_formation_ids) == 1


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
    from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
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
    from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
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
    from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
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
    from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
        _resolve_effective_key,
        normalize_formation_key,
    )

    raw_key = normalize_formation_key("Boom Klei")
    # Whitespace-only target: normalize_formation_key("   ") == "" → guard fires.
    eff_key, eff_name = _resolve_effective_key(raw_key, {raw_key: "   "})
    assert eff_key == raw_key, "blank target must not override the raw key"
    assert eff_name == raw_key, "blank target must not override the display name"
