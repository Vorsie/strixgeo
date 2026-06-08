"""Unit tests for the in-corridor contact filter in BuildSectionSnapshot.

Owner directive 2026-06-08 — "classification follows the test" (supersedes
the 2026-05-17 explicit-content directive FOR CLASSIFICATION): a section
shows the geological contacts of EVERY investigation that projects into its
corridor, automatically — there is no per-section seeding gate. A test is
classified once and that classification appears on every section through it.
The explicit-content invariant now applies to correlations only.

The contact filter in ``BuildSectionSnapshot.execute`` therefore keeps a
contact iff its anchor investigation projects onto the section (within the
projection buffer, not excluded). These tests exercise that at the use-case
level via a fully-mocked DB session (no real DB, no I/O) so they run in the
unit suite.

Coverage:

* In-corridor contacts render even with an EMPTY seeded set (the reversal).
* A contact whose anchor projects outside the buffer is dropped.
* An excluded or unknown anchor is silently skipped (no crash).
"""

from __future__ import annotations

from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from groundmodel.application.build_section_snapshot import BuildSectionSnapshot

# ---------------------------------------------------------------------------
# Minimal synthetic data builders
# ---------------------------------------------------------------------------

PROJECT_ID = uuid4()
SECTION_ID = uuid4()
MODEL_ID = uuid4()

BOREHOLE_ID = uuid4()  # in corridor — at (50, 0) on the (0,0)→(100,0) line
BOREHOLE_FAR_ID = uuid4()  # out of corridor — 200 m off the line
FORMATION_ID = uuid4()
CONTACT_ID_A = uuid4()
CONTACT_ID_B = uuid4()
CONTACT_ID_FAR = uuid4()  # anchored to the far borehole

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
    seeded_formation_contact_ids=[],  # no longer gates rendering
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
    location_y=0.0,  # on the line → in corridor
    epsg=31370,
    elevation_m=-2.5,
    total_depth_m=20.0,
    z_epsg=5710,
)

_BOREHOLE_FAR = SimpleNamespace(
    id=BOREHOLE_FAR_ID,
    name="BH-FAR",
    location_x=50.0,
    location_y=200.0,  # offset 200 m > 50 m buffer → out of corridor
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

_CONTACT_FAR = SimpleNamespace(
    id=CONTACT_ID_FAR,
    model_id=MODEL_ID,
    formation_id=FORMATION_ID,
    borehole_id=BOREHOLE_FAR_ID,
    cpt_id=None,
    depth_top_m=5.0,
)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_in_corridor_contacts_render_without_seeding() -> None:
    """Classification follows the test: both contacts on the in-corridor
    borehole appear even though the seeded set is empty.

    This is the reversal of the old explicit-content gate — a test's
    classification shows on every section through it, no seed step.
    """
    section_ns = SimpleNamespace(**vars(_SECTION))
    section_ns.seeded_formation_contact_ids = []  # nothing seeded

    with _patch_all(
        section_ns, boreholes=[_BOREHOLE], contacts=[_CONTACT_A, _CONTACT_B]
    ) as use_case:
        snapshot = await use_case.execute(
            app_project_id=PROJECT_ID,
            section_id=SECTION_ID,
            model_id=MODEL_ID,
        )

    contact_ids_in_snapshot = {c.contact_id for c in snapshot.contacts}
    assert contact_ids_in_snapshot == {CONTACT_ID_A, CONTACT_ID_B}, (
        "in-corridor contacts must render with an empty seeded set"
    )
    assert len(snapshot.investigations) == 1
    assert len(snapshot.formations) == 1


@pytest.mark.asyncio
async def test_out_of_corridor_anchor_is_dropped() -> None:
    """A contact whose anchor projects outside the projection buffer is not
    on the section, even with an empty seeded set."""
    section_ns = SimpleNamespace(**vars(_SECTION))
    section_ns.seeded_formation_contact_ids = []

    with _patch_all(
        section_ns,
        boreholes=[_BOREHOLE, _BOREHOLE_FAR],
        contacts=[_CONTACT_A, _CONTACT_FAR],
    ) as use_case:
        snapshot = await use_case.execute(
            app_project_id=PROJECT_ID,
            section_id=SECTION_ID,
            model_id=MODEL_ID,
        )

    contact_ids_in_snapshot = {c.contact_id for c in snapshot.contacts}
    assert contact_ids_in_snapshot == {CONTACT_ID_A}, "only the in-corridor contact must appear"
    assert CONTACT_ID_FAR not in contact_ids_in_snapshot
    # The far borehole is not projected, so it is not an investigation column.
    assert len(snapshot.investigations) == 1


@pytest.mark.asyncio
async def test_excluded_or_missing_anchor_is_silently_skipped() -> None:
    """An excluded anchor (and a contact whose anchor isn't in the visible
    list) drop out without a crash — even when seeded.

    The borehole sits in the corridor but is on the section's exclusion
    list, and a second contact points at a borehole the project never
    returned. Both are skipped silently.
    """
    section_ns = SimpleNamespace(**vars(_SECTION))
    # Seeded, but the anchor is excluded → exclusion wins over the (now
    # non-gating) seeded set.
    section_ns.seeded_formation_contact_ids = [CONTACT_ID_A]
    section_ns.excluded_borehole_ids = [BOREHOLE_ID]

    contact_unknown_anchor = SimpleNamespace(
        id=uuid4(),
        model_id=MODEL_ID,
        formation_id=FORMATION_ID,
        borehole_id=uuid4(),  # no matching borehole in the project
        cpt_id=None,
        depth_top_m=7.0,
    )

    with _patch_all(
        section_ns,
        boreholes=[_BOREHOLE],
        contacts=[_CONTACT_A, contact_unknown_anchor],
    ) as use_case:
        # Must NOT raise.
        snapshot = await use_case.execute(
            app_project_id=PROJECT_ID,
            section_id=SECTION_ID,
            model_id=MODEL_ID,
        )

    assert snapshot.contacts == [], "excluded + unknown anchors must drop, no crash"
    # The only borehole is excluded → no investigation columns either.
    assert snapshot.investigations == []


# ---------------------------------------------------------------------------
# Context-manager helper — reduces per-test boilerplate
# ---------------------------------------------------------------------------


@contextmanager
def _patch_all(
    section_ns: SimpleNamespace,
    *,
    boreholes: list[object],
    contacts: list[object],
):
    """Patch all five repository constructors for one test scenario.

    Yields the ``BuildSectionSnapshot`` use case with every DB call
    pre-wired to the supplied synthetic data.

    Parameters
    ----------
    section_ns : SimpleNamespace
        Synthetic section row.
    boreholes : list[object]
        Boreholes to return from ``BoreholeRepository.list_all``.
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
        br.list_all = AsyncMock(return_value=boreholes)
        MockBH.return_value = br

        yield BuildSectionSnapshot(session)
