"""Unit tests for the seeded_formation_contact_ids filter in BuildSectionSnapshot.

Owner directive 2026-05-17: a freshly-drawn section shows investigations
only — formation content appears ONLY where explicitly seeded.

The seeded-set filter is the new second filter applied to contacts in
``BuildSectionSnapshot.execute``.  These tests exercise it at the
use-case level via a fully-mocked DB session (no real DB, no I/O) so
they run in the unit suite.

Coverage:

* P2-C empty seeded set → snapshot has zero formation contacts (but
  investigations still render).
* P2-C populated seeded set → snapshot includes only those contacts.
* P2-C stale-id tolerance (Option b) — a contact id in the seeded set
  that is no longer in the model (deleted contact) is silently skipped;
  no crash, the section just shows nothing for it.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import pytest

from groundmodel.application.build_section_snapshot import BuildSectionSnapshot

# ---------------------------------------------------------------------------
# Minimal synthetic data builders
# ---------------------------------------------------------------------------

PROJECT_ID = uuid4()
SECTION_ID = uuid4()
MODEL_ID = uuid4()

BOREHOLE_ID = uuid4()
FORMATION_ID = uuid4()
CONTACT_ID_A = uuid4()
CONTACT_ID_B = uuid4()

# Lambert 72 coordinates for a trivial section (0,0) → (100,0).
_SECTION = SimpleNamespace(
    id=SECTION_ID,
    app_project_id=PROJECT_ID,
    name="Test section",
    start_x=0.0,
    start_y=0.0,
    end_x=100.0,
    end_y=0.0,
    epsg=31370,
    projection_buffer_m=50.0,
    vertical_exaggeration=1.0,
    excluded_cpt_ids=[],
    excluded_borehole_ids=[],
    seeded_formation_contact_ids=[],  # overridden per test
    min_depth_m=None,
    max_depth_m=None,
    display_order=0,
    view_state=None,
)

_PROJECT = SimpleNamespace(
    id=PROJECT_ID,
    name="Test project",
    default_vertical_epsg=5710,
)

_GEOLOGICAL_MODEL = SimpleNamespace(
    id=MODEL_ID,
    app_project_id=PROJECT_ID,
)

_FORMATION = SimpleNamespace(
    id=FORMATION_ID,
    name="Boom Klei",
    code="BmK",
    color="#a8a29e",
    display_order=0,
)

_BOREHOLE = SimpleNamespace(
    id=BOREHOLE_ID,
    name="BH-01",
    location_x=50.0,
    location_y=0.0,
    epsg=31370,
    elevation_m=-2.5,
    total_depth_m=20.0,
    z_epsg=5710,
)

_CONTACT_A = SimpleNamespace(
    id=CONTACT_ID_A,
    model_id=MODEL_ID,
    formation_id=FORMATION_ID,
    borehole_id=BOREHOLE_ID,
    cpt_id=None,
    depth_top_m=5.0,
)

_CONTACT_B = SimpleNamespace(
    id=CONTACT_ID_B,
    model_id=MODEL_ID,
    formation_id=FORMATION_ID,
    borehole_id=BOREHOLE_ID,
    cpt_id=None,
    depth_top_m=10.0,
)


def _make_session(
    *,
    seeded_contact_ids: list[UUID],
    contacts: list[object],
) -> AsyncMock:
    """Return a mock AsyncSession with all DB calls pre-wired.

    The per-repo methods are patched at the repository level so this
    function builds a self-contained mock world that exercises only the
    BuildSectionSnapshot logic — not the repositories themselves.
    """
    session = AsyncMock()

    # Patch CrossSectionRepository.get
    section_ns = SimpleNamespace(**vars(_SECTION))
    section_ns.seeded_formation_contact_ids = seeded_contact_ids
    with (
        patch(
            "groundmodel.application.build_section_snapshot.CrossSectionRepository",
        ) as MockSectionRepo,
        patch(
            "groundmodel.application.build_section_snapshot.ProjectRepository",
        ) as MockProjectRepo,
        patch(
            "groundmodel.application.build_section_snapshot.GeologyRepository",
        ) as MockGeologyRepo,
        patch(
            "groundmodel.application.build_section_snapshot.CptRepository",
        ) as MockCptRepo,
        patch(
            "groundmodel.application.build_section_snapshot.BoreholeRepository",
        ) as MockBhRepo,
    ):
        # Wire section
        mock_section_repo = MagicMock()
        mock_section_repo.get = AsyncMock(return_value=section_ns)
        MockSectionRepo.return_value = mock_section_repo

        # Wire project
        mock_project_repo = MagicMock()
        mock_project_repo.get_by_id = AsyncMock(return_value=_PROJECT)
        MockProjectRepo.return_value = mock_project_repo

        # Wire geology: model + formations + contacts
        mock_geo_repo = MagicMock()
        mock_geo_repo.get_model = AsyncMock(return_value=_GEOLOGICAL_MODEL)
        mock_geo_repo.list_formations = AsyncMock(return_value=[_FORMATION])
        mock_geo_repo.list_contacts = AsyncMock(return_value=contacts)
        MockGeologyRepo.return_value = mock_geo_repo

        # Wire CPTs (empty — section has no CPTs)
        mock_cpt_repo = MagicMock()
        mock_cpt_repo.list_all = AsyncMock(return_value=[])
        MockCptRepo.return_value = mock_cpt_repo

        # Wire boreholes (single borehole within the buffer)
        mock_bh_repo = MagicMock()
        mock_bh_repo.list_all = AsyncMock(return_value=[_BOREHOLE])
        MockBhRepo.return_value = mock_bh_repo

        return (
            session,
            MockSectionRepo,
            MockProjectRepo,
            MockGeologyRepo,
            MockCptRepo,
            MockBhRepo,
        )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_empty_seeded_set_produces_zero_formation_contacts() -> None:
    """P2-C: empty seeded_formation_contact_ids → snapshot has zero contacts.

    The investigation (borehole) still appears in the snapshot as a
    projected column — only formation content is absent.  This is the
    "freshly-drawn section" state.
    """
    section_ns = SimpleNamespace(**vars(_SECTION))
    section_ns.seeded_formation_contact_ids = []  # nothing seeded

    # Two contacts exist in the model but neither is in the seeded set.
    with _patch_all(section_ns, contacts=[_CONTACT_A, _CONTACT_B]) as use_case:
        snapshot = await use_case.execute(
            app_project_id=PROJECT_ID,
            section_id=SECTION_ID,
            model_id=MODEL_ID,
        )

    # No formation contacts should be in the snapshot.
    assert snapshot.contacts == [], "Empty seeded set must produce zero contacts in snapshot"
    # The investigation column is still projected (investigations are
    # investigation-only, not formation-gated).
    assert len(snapshot.investigations) == 1, (
        "Borehole-column must still appear even with empty seeded set"
    )
    # No formations (no contacts → no formations-in-use).
    assert snapshot.formations == []


@pytest.mark.asyncio
async def test_seeded_set_with_one_id_includes_only_that_contact() -> None:
    """P2-C: seeded set {A} → only contact A appears in snapshot."""
    section_ns = SimpleNamespace(**vars(_SECTION))
    section_ns.seeded_formation_contact_ids = [CONTACT_ID_A]  # only A seeded

    with _patch_all(section_ns, contacts=[_CONTACT_A, _CONTACT_B]) as use_case:
        snapshot = await use_case.execute(
            app_project_id=PROJECT_ID,
            section_id=SECTION_ID,
            model_id=MODEL_ID,
        )

    contact_ids_in_snapshot = {c.contact_id for c in snapshot.contacts}
    assert contact_ids_in_snapshot == {CONTACT_ID_A}, (
        "Only the seeded contact id must appear in the snapshot"
    )
    assert CONTACT_ID_B not in contact_ids_in_snapshot


@pytest.mark.asyncio
async def test_stale_id_in_seeded_set_is_silently_skipped() -> None:
    """P2-C stale-id tolerance (Option b): a seeded contact id that is no
    longer in the model (contact deleted from the model after Seed) is
    silently skipped — no crash, section shows nothing for it.

    This ensures that deleting a contact from the model does NOT crash
    the section view for any section that had that contact seeded.
    """
    stale_id = uuid4()  # an id that does NOT appear in the model's contacts

    section_ns = SimpleNamespace(**vars(_SECTION))
    # seeded set contains only the stale id — neither live contact is seeded.
    section_ns.seeded_formation_contact_ids = [stale_id]

    with _patch_all(section_ns, contacts=[_CONTACT_A]) as use_case:
        # Must NOT raise — stale id is silently dropped.
        snapshot = await use_case.execute(
            app_project_id=PROJECT_ID,
            section_id=SECTION_ID,
            model_id=MODEL_ID,
        )

    # The stale id was in the seeded set but not in the model → zero contacts.
    assert snapshot.contacts == [], "Stale seeded-contact id must be skipped silently, no crash"
    assert len(snapshot.investigations) == 1, "Investigation still renders"


@pytest.mark.asyncio
async def test_both_contacts_seeded_both_appear() -> None:
    """P2-C: seeded set {A, B} → both contacts appear in snapshot."""
    section_ns = SimpleNamespace(**vars(_SECTION))
    section_ns.seeded_formation_contact_ids = [CONTACT_ID_A, CONTACT_ID_B]

    with _patch_all(section_ns, contacts=[_CONTACT_A, _CONTACT_B]) as use_case:
        snapshot = await use_case.execute(
            app_project_id=PROJECT_ID,
            section_id=SECTION_ID,
            model_id=MODEL_ID,
        )

    contact_ids_in_snapshot = {c.contact_id for c in snapshot.contacts}
    assert contact_ids_in_snapshot == {CONTACT_ID_A, CONTACT_ID_B}


# ---------------------------------------------------------------------------
# Context-manager helper — reduces per-test boilerplate
# ---------------------------------------------------------------------------

from contextlib import contextmanager


@contextmanager
def _patch_all(section_ns: SimpleNamespace, *, contacts: list[object]):
    """Patch all five repository constructors for one test scenario.

    Yields the ``BuildSectionSnapshot`` use case with every DB call
    pre-wired to the supplied synthetic data.

    Parameters
    ----------
    section_ns : SimpleNamespace
        Synthetic section row (pre-configured seeded_formation_contact_ids).
    contacts : list[object]
        Formation contacts to return from ``GeologyRepository.list_contacts``.
    """
    session = AsyncMock()
    with (
        patch("groundmodel.application.build_section_snapshot.CrossSectionRepository") as MockSR,
        patch("groundmodel.application.build_section_snapshot.ProjectRepository") as MockPR,
        patch("groundmodel.application.build_section_snapshot.GeologyRepository") as MockGR,
        patch("groundmodel.application.build_section_snapshot.CptRepository") as MockCPT,
        patch("groundmodel.application.build_section_snapshot.BoreholeRepository") as MockBH,
    ):
        mr = MagicMock()
        mr.get = AsyncMock(return_value=section_ns)
        MockSR.return_value = mr

        pr = MagicMock()
        pr.get_by_id = AsyncMock(return_value=_PROJECT)
        MockPR.return_value = pr

        gr = MagicMock()
        gr.get_model = AsyncMock(return_value=_GEOLOGICAL_MODEL)
        gr.list_formations = AsyncMock(return_value=[_FORMATION])
        gr.list_contacts = AsyncMock(return_value=contacts)
        MockGR.return_value = gr

        cr = MagicMock()
        cr.list_all = AsyncMock(return_value=[])
        MockCPT.return_value = cr

        br = MagicMock()
        br.list_all = AsyncMock(return_value=[_BOREHOLE])
        MockBH.return_value = br

        yield BuildSectionSnapshot(session)
