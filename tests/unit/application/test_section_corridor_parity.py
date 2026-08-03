"""Parity gate — "is this investigation on the section?" has ONE answer.

The rule in the engineer's own words: *an investigation is on a cross-section
when it sits inside the corridor AND between the two endpoints he drew.*  An
investigation past the end of the line is not on the section — it is not drawn
there, so nothing may treat it as one of that section's columns.

Two backend implementations answer that question today: ``BuildSectionSnapshot``
(what the section view, the DXF and the PDF are built from) and the shared
``project_investigations_onto_section`` helper (what auto-correlate and the
enclosed-lens merge use to decide which columns are ADJACENT).  This test drives
both real code paths over the same geometry and asserts they return the same
set — never each agreeing with itself.

Why it matters: the second consumer inserts correlation edges between "adjacent"
columns, and the lens merge inserts its edges already user-approved.  If the two
answers differ, the engineer accepts (or never even sees) a tie to a column that
is not on the section he validated, and the 3-D build merges bodies through it.
"""

from __future__ import annotations

from contextlib import contextmanager
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import pytest

from groundmodel.application.build_section_snapshot import BuildSectionSnapshot
from groundmodel.application.project_investigations_onto_section import (
    project_investigations_onto_section,
)

PROJECT_ID = uuid4()
SECTION_ID = uuid4()
MODEL_ID = uuid4()

# The section the engineer drew: (0,0) → (100,0), 50 m corridor either side.
_SECTION = SimpleNamespace(
    id=SECTION_ID,
    app_project_id=PROJECT_ID,
    name="Cross-section 2",
    start_x=0.0,
    start_y=0.0,
    end_x=100.0,
    end_y=0.0,
    epsg=31370,
    projection_buffer_m=50.0,
    vertical_exaggeration=1.0,
    excluded_cpt_ids=[],
    excluded_borehole_ids=[],
    seeded_formation_contact_ids=[],
    min_depth_m=None,
    max_depth_m=None,
    display_order=0,
    view_state=None,
)

_PROJECT = SimpleNamespace(id=PROJECT_ID, name="Test project", default_vertical_epsg=5710)
_GEOLOGICAL_MODEL = SimpleNamespace(id=MODEL_ID, app_project_id=PROJECT_ID)

# Four boreholes: on the section, 30 m past the end endpoint, 30 m before the
# start endpoint, and one genuinely off to the side.
ON_ID = uuid4()
PAST_END_ID = uuid4()
BEFORE_START_ID = uuid4()
OFF_CORRIDOR_ID = uuid4()

_POSITIONS: list[tuple[UUID, str, float, float]] = [
    (ON_ID, "BH-ON", 50.0, 10.0),
    (PAST_END_ID, "BH-PAST-END", 130.0, 20.0),
    (BEFORE_START_ID, "BH-BEFORE-START", -30.0, 5.0),
    (OFF_CORRIDOR_ID, "BH-OFF", 50.0, 200.0),
]


def _boreholes() -> list[SimpleNamespace]:
    """Rich borehole rows for the snapshot use case."""
    return [
        SimpleNamespace(
            id=bh_id,
            name=name,
            location_x=x,
            location_y=y,
            epsg=31370,
            elevation_m=-2.5,
            total_depth_m=20.0,
            z_epsg=5710,
        )
        for bh_id, name, x, y in _POSITIONS
    ]


class _StubResult:
    """Minimal SQLAlchemy ``Result`` stand-in for the helper's three SELECTs."""

    def __init__(self, payload: Any) -> None:
        self._payload = payload

    def scalar_one_or_none(self) -> Any:
        """Return the section row."""
        return self._payload

    def all(self) -> Any:
        """Return the location rows."""
        return self._payload


class _StubSession:
    """Answers the helper's SELECTs in order: section, CPT rows, borehole rows."""

    def __init__(self) -> None:
        self._payloads: list[Any] = [
            _SECTION,
            [],  # no CPTs in this project
            [
                SimpleNamespace(id=b.id, location_x=b.location_x, location_y=b.location_y)
                for b in _boreholes()
            ],
        ]

    async def execute(self, _stmt: Any) -> _StubResult:
        """Pop and return the next canned result."""
        return _StubResult(self._payloads.pop(0))


@contextmanager
def _snapshot_use_case():
    """Yield ``BuildSectionSnapshot`` wired to the same synthetic project."""
    session = AsyncMock()
    with (
        patch("groundmodel.application.build_section_snapshot.CrossSectionRepository") as MockSR,
        patch("groundmodel.application.build_section_snapshot.ProjectRepository") as MockPR,
        patch("groundmodel.application.build_section_snapshot.GeologyRepository") as MockGR,
        patch("groundmodel.application.build_section_snapshot.CptRepository") as MockCPT,
        patch("groundmodel.application.build_section_snapshot.BoreholeRepository") as MockBH,
    ):
        mr = MagicMock()
        mr.get = AsyncMock(return_value=_SECTION)
        MockSR.return_value = mr

        pr = MagicMock()
        pr.get_by_id = AsyncMock(return_value=_PROJECT)
        MockPR.return_value = pr

        gr = MagicMock()
        gr.get_model = AsyncMock(return_value=_GEOLOGICAL_MODEL)
        gr.list_formations = AsyncMock(return_value=[])
        gr.list_contacts = AsyncMock(return_value=[])
        MockGR.return_value = gr

        cr = MagicMock()
        cr.list_all = AsyncMock(return_value=[])
        MockCPT.return_value = cr

        br = MagicMock()
        br.list_all = AsyncMock(return_value=_boreholes())
        MockBH.return_value = br

        yield BuildSectionSnapshot(session)


@pytest.mark.asyncio
async def test_an_investigation_past_the_end_endpoint_is_not_on_the_section() -> None:
    """A borehole 30 m beyond the end endpoint is off the section, buffer or not.

    It is inside the 50 m corridor laterally, but the engineer's line stops
    before it, so it is not one of this section's columns.
    """
    along = await project_investigations_onto_section(
        _StubSession(),  # type: ignore[arg-type]
        project_id=PROJECT_ID,
        section_id=SECTION_ID,
    )

    assert PAST_END_ID not in along
    assert BEFORE_START_ID not in along
    assert set(along) == {ON_ID}


@pytest.mark.asyncio
async def test_adjacency_helper_and_section_snapshot_agree_on_who_is_on_the_section() -> None:
    """The columns the engineer SEES and the columns the backend calls adjacent match."""
    with _snapshot_use_case() as use_case:
        snapshot = await use_case.execute(
            app_project_id=PROJECT_ID,
            section_id=SECTION_ID,
            model_id=MODEL_ID,
        )
    rendered = {inv.investigation_id for inv in snapshot.investigations}

    along = await project_investigations_onto_section(
        _StubSession(),  # type: ignore[arg-type]
        project_id=PROJECT_ID,
        section_id=SECTION_ID,
    )

    assert set(along) == rendered, (
        "the adjacency helper and the section snapshot disagree about which "
        "investigations are on this section"
    )
