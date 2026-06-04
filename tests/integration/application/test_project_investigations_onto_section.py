"""Integration tests for ``project_investigations_onto_section`` (debt #197).

This shared helper replaced the projection block copy-pasted across
``SuggestBodyPinchOuts``, ``DetectBodies`` and ``AutoCorrelateContactEdges``.
The cases pin the contract every caller relies on:

- PS1 — in-corridor CPT + borehole project to their along-distances.
- PS2 — a point beyond ``projection_buffer_m`` lateral offset is omitted.
- PS3 — an explicitly excluded investigation is omitted.
- PS4 — ``restrict_to`` limits the result to the given ids.
- PS5 — a missing section raises by default, returns ``{}`` when ``missing_ok``.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.project_investigations_onto_section import (
    project_investigations_onto_section,
)
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from tests.integration.conftest import make_project


@pytest_asyncio.fixture
async def project(db_session: AsyncSession) -> ProjectOrm:
    """A bare active project for the projection tests."""
    return await make_project(db_session, name="proj-investigations-onto-section")


def _section(project: ProjectOrm, *, buffer_m: float = 50.0) -> CrossSectionOrm:
    """A west→east section along y=200000 from x=149900 to x=150300 (len 400 m)."""
    return CrossSectionOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="SEC",
        description=None,
        start_x=149900.0,
        start_y=200000.0,
        end_x=150300.0,
        end_y=200000.0,
        epsg=31370,
        projection_buffer_m=buffer_m,
        vertical_exaggeration=1.0,
        excluded_borehole_ids=[],
        excluded_cpt_ids=[],
    )


def _cpt(project: ProjectOrm, *, suffix: str, x: float, y: float = 200000.0) -> CptOrm:
    """A minimal CptOrm at planar (x, y)."""
    return CptOrm(
        id=uuid7(),
        name=f"CPT-{suffix}",
        cpt_type="CPTU",
        project_id="GEF",
        test_id=f"GEF/{suffix}",
        app_project_id=project.id,
        location_x=x,
        location_y=y,
        elevation_m=10.0,
        z_epsg=5710,
        epsg=31370,
        max_depth_m=20.0,
    )


def _borehole(project: ProjectOrm, *, suffix: str, x: float, y: float = 200000.0) -> BoreholeOrm:
    """A minimal BoreholeOrm at planar (x, y)."""
    return BoreholeOrm(
        id=uuid7(),
        name=f"BH-{suffix}",
        app_project_id=project.id,
        project_id="PIOS",
        test_id=f"BH-PIOS-{suffix}",
        location_x=x,
        location_y=y,
        epsg=31370,
        total_depth_m=20.0,
    )


@pytest.mark.asyncio
async def test_ps1_projects_cpt_and_borehole_to_along(
    db_session: AsyncSession, project: ProjectOrm
) -> None:
    """An in-corridor CPT and borehole project to their along-distances."""
    section = _section(project)
    cpt = _cpt(project, suffix="01", x=150000.0)  # along 100 from start_x=149900
    bh = _borehole(project, suffix="01", x=150200.0)  # along 300
    db_session.add_all([section, cpt, bh])
    await db_session.commit()

    along = await project_investigations_onto_section(
        db_session, project_id=project.id, section_id=section.id
    )

    assert set(along) == {cpt.id, bh.id}
    assert along[cpt.id] == pytest.approx(100.0)
    assert along[bh.id] == pytest.approx(300.0)


@pytest.mark.asyncio
async def test_ps2_offset_beyond_buffer_is_omitted(
    db_session: AsyncSession, project: ProjectOrm
) -> None:
    """A point whose lateral offset exceeds the buffer is dropped."""
    section = _section(project, buffer_m=50.0)
    on = _cpt(project, suffix="on", x=150000.0, y=200000.0)  # offset 0
    off = _borehole(project, suffix="off", x=150000.0, y=200200.0)  # offset 200 > 50
    db_session.add_all([section, on, off])
    await db_session.commit()

    along = await project_investigations_onto_section(
        db_session, project_id=project.id, section_id=section.id
    )

    assert set(along) == {on.id}


@pytest.mark.asyncio
async def test_ps3_excluded_investigation_is_omitted(
    db_session: AsyncSession, project: ProjectOrm
) -> None:
    """An id in the section's excluded set is never projected."""
    section = _section(project)
    cpt = _cpt(project, suffix="keep", x=150000.0)
    bh = _borehole(project, suffix="drop", x=150200.0)
    section.excluded_borehole_ids = [bh.id]
    db_session.add_all([section, cpt, bh])
    await db_session.commit()

    along = await project_investigations_onto_section(
        db_session, project_id=project.id, section_id=section.id
    )

    assert set(along) == {cpt.id}


@pytest.mark.asyncio
async def test_ps4_restrict_to_limits_result(db_session: AsyncSession, project: ProjectOrm) -> None:
    """``restrict_to`` projects only the listed investigations."""
    section = _section(project)
    cpt = _cpt(project, suffix="01", x=150000.0)
    bh = _borehole(project, suffix="01", x=150200.0)
    db_session.add_all([section, cpt, bh])
    await db_session.commit()

    along = await project_investigations_onto_section(
        db_session, project_id=project.id, section_id=section.id, restrict_to={bh.id}
    )

    assert set(along) == {bh.id}


@pytest.mark.asyncio
async def test_ps5_missing_section_raises_or_empty(
    db_session: AsyncSession, project: ProjectOrm
) -> None:
    """A missing section raises by default, returns {} when ``missing_ok``."""
    ghost = uuid4()

    with pytest.raises(ValueError):
        await project_investigations_onto_section(
            db_session, project_id=project.id, section_id=ghost
        )

    empty = await project_investigations_onto_section(
        db_session, project_id=project.id, section_id=ghost, missing_ok=True
    )
    assert empty == {}
