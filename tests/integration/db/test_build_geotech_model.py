"""Integration tests for ``BuildGeotechModelFromLitho`` (geotech stage Slice 1, Task C1).

The use case creates a ``kind='geotechnical'`` sibling model under a litho model
and lays down the geo-bounded STRUCTURAL skeleton: each litho column divided at
geological boundaries (geology = hard bound) as geotech ``FormationContact`` rows,
backed by skeleton geotech ``geological_formation`` rows (``nad_class=None``).

Checkpoints (per the Task C1 plan):

* **CP-A (divide):** a litho unit straddling a geological boundary produces a
  geotech contact at that boundary (the column is cut).  The
  ``litho_geo_bounding.divide_picks_by_geology`` pure-function behaviour is the
  oracle for the cut depth.
* **CP-B (snap):** a litho contact within ``litho_snap_tolerance_m`` of a geo
  boundary does NOT produce an extra geotech contact (snap, no cut).
* **CP-C (provenance):** each geo-division geotech ``FormationContact`` carries
  ``parent_geo_contact_id`` pointing at the geological contact that forced the cut.
* **CP-D (model + skeleton):** the geotech model exists with
  ``kind='geotechnical'``, parent = the litho model; skeleton formations carry
  ``nad_class=None`` + both dual-ref FKs + the inherited ``litho_main_soil_code``.

Geometry of the shared ``scene`` fixture
-----------------------------------------
One flat geological surface at elevation 0.0 m (TIN covering the corridor),
i.e. the top of geo formation ``Q_DEEP``; everything above it is the (open)
shallow band, everything below is ``Q_DEEP``'s band.  Boreholes sit on a section
line at surface elevation 5.0 m, so the geo boundary is at depth 5.0 m below
surface at every column.

* ``bh_straddle`` carries ONE accepted ZAND litho layer 2.0 → 8.0 m — it crosses
  the 5.0 m geo boundary, so it must be DIVIDED into 2.0–5.0 m and 5.0–8.0 m
  geotech contacts (CP-A).  A geological ``FormationContact`` for ``Q_DEEP`` sits
  at 5.0 m on this borehole → the lower geotech contact links to it (CP-C).
* ``bh_snap`` carries a ZAND layer 2.0 → 4.95 m and a KLEI layer 4.95 → 9.0 m;
  the 4.95 m litho contact is within the 0.20 m snap tolerance of the 5.0 m geo
  boundary, so geology SNAPS to the litho contact and NO extra geotech contact
  is created between them (CP-B).
"""

from __future__ import annotations

from uuid import UUID

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.build_geotech_model_from_litho import BuildGeotechModelFromLitho
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.formation_surface_orm import FormationSurfaceOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm

# Section line + corridor: all boreholes sit on it well inside the buffer.
_SEC_START = (149000.0, 200000.0)
_SEC_END = (151000.0, 200000.0)
_SURFACE_ELEV_M = 5.0
# Flat geo surface (top of Q_DEEP) at this absolute elevation → depth 5.0 m below
# the 5.0 m surface.  The snap borehole's 4.95 m litho contact is 0.05 m above it,
# inside the 0.20 m default snap tolerance → snap, no extra cut.
_GEO_SURFACE_ELEV_M = 0.0


def _flat_tin_vertices() -> list[list[float]]:
    """Four corners of a flat TIN at ``_GEO_SURFACE_ELEV_M`` covering the corridor."""
    return [
        [148000.0, 199000.0, _GEO_SURFACE_ELEV_M],
        [152000.0, 199000.0, _GEO_SURFACE_ELEV_M],
        [152000.0, 201000.0, _GEO_SURFACE_ELEV_M],
        [148000.0, 201000.0, _GEO_SURFACE_ELEV_M],
    ]


def _borehole(project_id: UUID, *, suffix: str, x: float) -> BoreholeOrm:
    """Unsaved borehole on the section line at surface elevation 5.0 m."""
    return BoreholeOrm(
        id=uuid7(),
        name=f"BH-GEO-{suffix}",
        app_project_id=project_id,
        project_id="GEO",
        test_id=f"BH-GEO-{suffix}",
        location_x=x,
        location_y=200000.0,
        elevation_m=_SURFACE_ELEV_M,
        epsg=31370,
        total_depth_m=20.0,
    )


def _layer(
    model: GeologicalModelOrm,
    formation: GeologicalFormationOrm,
    borehole: BoreholeOrm,
    *,
    top: float,
    base: float,
) -> LithoLayerOrm:
    """Unsaved accepted ``LithoLayerOrm`` anchored to *borehole*."""
    return LithoLayerOrm(
        id=uuid7(),
        model_id=model.id,
        formation_id=formation.id,
        borehole_id=borehole.id,
        depth_top_m=top,
        depth_base_m=base,
        status="accepted",
        source="manual",
        confidence="medium",
    )


@pytest_asyncio.fixture
async def scene(db_session: AsyncSession) -> dict:
    """Project + geo model (1 built surface + contacts) + litho model + section.

    Returns a dict with the keys the tests reference: project, geo, litho,
    section_id, geo_deep (the geological formation whose top forces the cut),
    f_sand / f_clay (litho formations), bh_straddle, bh_snap, and the geo
    contact id on the straddle borehole.
    """
    proj = ProjectOrm(id=uuid7(), name="GEO build test", status="active")
    db_session.add(proj)
    await db_session.flush()

    geo = GeologicalModelOrm(
        id=uuid7(), app_project_id=proj.id, name="Geo", kind="geological", is_active=True
    )
    litho = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=proj.id,
        name="Litho",
        kind="lithostratigraphic",
        parent_geological_model_id=geo.id,
        is_active=True,
    )
    db_session.add_all([geo, litho])
    await db_session.flush()

    # Geological formation whose top is the dividing surface at 0.0 m.
    geo_deep = GeologicalFormationOrm(
        id=uuid7(), app_project_id=proj.id, name="Q_DEEP", color="#999", display_order=1
    )
    # Litho formations (units).
    f_sand = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=proj.id,
        name="ZAND",
        color="#f5deb3",
        display_order=1,
        litho_main_soil_code="ZAND",
        litho_admixtures=[],
    )
    f_clay = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=proj.id,
        name="KLEI",
        color="#8B6914",
        display_order=2,
        litho_main_soil_code="KLEI",
        litho_admixtures=[],
    )
    db_session.add_all([geo_deep, f_sand, f_clay])
    await db_session.flush()

    # Built, non-stale geological surface (top of Q_DEEP) at 0.0 m.
    surface = FormationSurfaceOrm(
        id=uuid7(),
        model_id=geo.id,
        formation_id=geo_deep.id,
        method="tin",
        vertices=_flat_tin_vertices(),
        triangles=[[0, 1, 2], [0, 2, 3]],
        source_contact_count=2,
        source_contact_checksum=b"\x00" * 16,
        is_stale=False,
    )
    db_session.add(surface)

    # Boreholes.
    bh_straddle = _borehole(proj.id, suffix="STRADDLE", x=150000.0)
    bh_snap = _borehole(proj.id, suffix="SNAP", x=150200.0)
    db_session.add_all([bh_straddle, bh_snap])
    await db_session.flush()

    # Geological contacts: Q_DEEP top at depth 5.0 m on BOTH boreholes (the geo
    # boundary the surface interpolates).  These are the provenance targets.
    geo_contact_straddle = FormationContactOrm(
        id=uuid7(),
        model_id=geo.id,
        formation_id=geo_deep.id,
        borehole_id=bh_straddle.id,
        depth_top_m=5.0,
        source="manual_pick",
    )
    geo_contact_snap = FormationContactOrm(
        id=uuid7(),
        model_id=geo.id,
        formation_id=geo_deep.id,
        borehole_id=bh_snap.id,
        depth_top_m=5.0,
        source="manual_pick",
    )
    db_session.add_all([geo_contact_straddle, geo_contact_snap])

    # Litho layers.
    # Straddle: ONE ZAND layer 2.0 → 8.0 m crossing the 5.0 m geo boundary.
    db_session.add(_layer(litho, f_sand, bh_straddle, top=2.0, base=8.0))
    # Snap: ZAND 2.0 → 4.95 m (contact 4.95 m is 0.05 m above the 5.0 m boundary)
    # + KLEI 4.95 → 9.0 m.  The 4.95 m contact snaps; no extra geotech cut.
    db_session.add_all(
        [
            _layer(litho, f_sand, bh_snap, top=2.0, base=4.95),
            _layer(litho, f_clay, bh_snap, top=4.95, base=9.0),
        ]
    )

    # Minimal cross-section row covering the corridor.
    section = CrossSectionOrm(
        id=uuid7(),
        app_project_id=proj.id,
        name="S-GEO",
        start_x=_SEC_START[0],
        start_y=_SEC_START[1],
        end_x=_SEC_END[0],
        end_y=_SEC_END[1],
        epsg=31370,
        projection_buffer_m=500.0,
    )
    db_session.add(section)
    await db_session.commit()

    return {
        "project": proj,
        "geo": geo,
        "litho": litho,
        "section_id": section.id,
        "geo_deep": geo_deep,
        "f_sand": f_sand,
        "f_clay": f_clay,
        "bh_straddle": bh_straddle,
        "bh_snap": bh_snap,
        "geo_contact_straddle_id": geo_contact_straddle.id,
        "geo_contact_snap_id": geo_contact_snap.id,
    }


async def _geotech_model(db_session: AsyncSession, project_id: UUID) -> GeologicalModelOrm | None:
    """Return the single geotechnical model in the project, or None."""
    return (
        (
            await db_session.execute(
                select(GeologicalModelOrm).where(
                    GeologicalModelOrm.app_project_id == project_id,
                    GeologicalModelOrm.kind == "geotechnical",
                )
            )
        )
        .scalars()
        .one_or_none()
    )


@pytest.mark.asyncio
async def test_cp_d_creates_geotech_model_and_skeleton(
    db_session: AsyncSession, scene: dict
) -> None:
    """CP-D: a geotech model with parent = litho is created; skeleton formations
    carry ``nad_class=None`` + both dual-ref FKs + inherited soil code."""
    proj = scene["project"]
    litho = scene["litho"]

    await BuildGeotechModelFromLitho(db_session).execute(
        project_id=proj.id, litho_model_id=litho.id, section_id=scene["section_id"]
    )

    geotech = await _geotech_model(db_session, proj.id)
    assert geotech is not None, "A kind='geotechnical' model must be created"
    assert geotech.kind == "geotechnical"
    assert geotech.parent_geological_model_id == litho.id

    skeletons = (
        (
            await db_session.execute(
                select(GeologicalFormationOrm).where(
                    GeologicalFormationOrm.source_litho_formation_id.is_not(None)
                )
            )
        )
        .scalars()
        .all()
    )
    assert skeletons, "At least one skeleton geotech formation must be created"
    for f in skeletons:
        assert f.nad_class is None, "Skeleton formations carry nad_class=None until accept"
        assert f.source_litho_formation_id is not None
        assert f.litho_main_soil_code in {"ZAND", "KLEI"}, "soil code inherited from litho parent"

    # source_geo_formation_id is set for segments INSIDE a geological band; the
    # open shallow band above the topmost geological surface legitimately has no
    # geo formation above it, so it stays None.  The straddle borehole's lower
    # segment sits inside Q_DEEP, so at least one skeleton must carry the geo FK.
    assert any(f.source_geo_formation_id == scene["geo_deep"].id for f in skeletons), (
        "the deeper geo-bounded skeleton must carry source_geo_formation_id = Q_DEEP"
    )


@pytest.mark.asyncio
async def test_cp_a_straddling_unit_is_divided_at_geo_boundary(
    db_session: AsyncSession, scene: dict
) -> None:
    """CP-A: the ZAND layer 2.0 → 8.0 m straddling the 5.0 m geo boundary
    produces geotech contacts at BOTH 2.0 m (top) and 5.0 m (the cut)."""
    proj = scene["project"]
    litho = scene["litho"]
    bh_straddle = scene["bh_straddle"]

    await BuildGeotechModelFromLitho(db_session).execute(
        project_id=proj.id, litho_model_id=litho.id, section_id=scene["section_id"]
    )

    geotech = await _geotech_model(db_session, proj.id)
    assert geotech is not None

    depths = sorted(
        c.depth_top_m
        for c in (
            await db_session.execute(
                select(FormationContactOrm).where(
                    FormationContactOrm.model_id == geotech.id,
                    FormationContactOrm.borehole_id == bh_straddle.id,
                )
            )
        )
        .scalars()
        .all()
    )
    # The unit top (2.0 m) and the geo-division cut (5.0 m) are both present.
    assert any(abs(d - 2.0) < 1e-6 for d in depths), f"missing top contact 2.0 m; got {depths}"
    assert any(abs(d - 5.0) < 1e-6 for d in depths), (
        f"straddling unit must be cut at the 5.0 m geo boundary; got {depths}"
    )


@pytest.mark.asyncio
async def test_cp_b_near_boundary_contact_snaps_no_extra_cut(
    db_session: AsyncSession, scene: dict
) -> None:
    """CP-B: the 4.95 m litho contact is within 0.20 m of the 5.0 m geo boundary,
    so geology snaps to it — no extra geotech contact appears near 5.0 m."""
    proj = scene["project"]
    litho = scene["litho"]
    bh_snap = scene["bh_snap"]

    await BuildGeotechModelFromLitho(db_session).execute(
        project_id=proj.id, litho_model_id=litho.id, section_id=scene["section_id"]
    )

    geotech = await _geotech_model(db_session, proj.id)
    assert geotech is not None

    depths = sorted(
        c.depth_top_m
        for c in (
            await db_session.execute(
                select(FormationContactOrm).where(
                    FormationContactOrm.model_id == geotech.id,
                    FormationContactOrm.borehole_id == bh_snap.id,
                )
            )
        )
        .scalars()
        .all()
    )
    # Exactly the two litho tops (2.0 m + 4.95 m) — no synthetic 5.0 m cut between
    # them, because the 4.95 m contact snapped to the geo boundary.
    near_boundary = [d for d in depths if 4.96 <= d <= 5.04]
    assert not near_boundary, (
        f"a contact within snap tolerance of the geo boundary must NOT spawn an "
        f"extra cut; found {near_boundary} in {depths}"
    )
    assert any(abs(d - 4.95) < 1e-6 for d in depths), f"snapped litho top 4.95 m missing; {depths}"


@pytest.mark.asyncio
async def test_cp_c_division_contact_carries_geo_provenance(
    db_session: AsyncSession, scene: dict
) -> None:
    """CP-C: the geotech contact created at the 5.0 m geo-division boundary on the
    straddle borehole links to the geological contact that forced the cut."""
    proj = scene["project"]
    litho = scene["litho"]
    bh_straddle = scene["bh_straddle"]

    await BuildGeotechModelFromLitho(db_session).execute(
        project_id=proj.id, litho_model_id=litho.id, section_id=scene["section_id"]
    )

    geotech = await _geotech_model(db_session, proj.id)
    assert geotech is not None

    contacts = (
        (
            await db_session.execute(
                select(FormationContactOrm).where(
                    FormationContactOrm.model_id == geotech.id,
                    FormationContactOrm.borehole_id == bh_straddle.id,
                )
            )
        )
        .scalars()
        .all()
    )
    cut = next((c for c in contacts if abs(c.depth_top_m - 5.0) < 1e-6), None)
    assert cut is not None, "expected a geotech contact at the 5.0 m geo-division boundary"
    assert cut.parent_geo_contact_id == scene["geo_contact_straddle_id"], (
        "the geo-division geotech contact must carry parent_geo_contact_id pointing "
        "at the geological contact that forced the cut (CP-C provenance)"
    )


@pytest.mark.asyncio
async def test_cp_e_rebuild_is_idempotent(db_session: AsyncSession, scene: dict) -> None:
    """CP-E: calling execute() twice with the same args produces no duplicate rows.

    After the first build we capture the geotech contact count on ``bh_straddle``
    and the number of skeleton formations (``source_litho_formation_id IS NOT NULL``).
    After the second build both counts must be identical — contacts are replaced,
    not appended; skeletons are reused, not duplicated.
    """
    proj = scene["project"]
    litho = scene["litho"]
    bh_straddle = scene["bh_straddle"]

    uc = BuildGeotechModelFromLitho(db_session)

    # --- First build ---
    await uc.execute(project_id=proj.id, litho_model_id=litho.id, section_id=scene["section_id"])

    geotech = await _geotech_model(db_session, proj.id)
    assert geotech is not None

    contacts_after_first = (
        (
            await db_session.execute(
                select(FormationContactOrm).where(
                    FormationContactOrm.model_id == geotech.id,
                    FormationContactOrm.borehole_id == bh_straddle.id,
                )
            )
        )
        .scalars()
        .all()
    )
    contact_count_after_first = len(contacts_after_first)

    skeletons_after_first = (
        (
            await db_session.execute(
                select(GeologicalFormationOrm).where(
                    GeologicalFormationOrm.source_litho_formation_id.is_not(None),
                    GeologicalFormationOrm.app_project_id == proj.id,
                )
            )
        )
        .scalars()
        .all()
    )
    skeleton_count_after_first = len(skeletons_after_first)

    # --- Second build (re-build with the same args) ---
    await uc.execute(project_id=proj.id, litho_model_id=litho.id, section_id=scene["section_id"])

    contacts_after_second = (
        (
            await db_session.execute(
                select(FormationContactOrm).where(
                    FormationContactOrm.model_id == geotech.id,
                    FormationContactOrm.borehole_id == bh_straddle.id,
                )
            )
        )
        .scalars()
        .all()
    )
    contact_count_after_second = len(contacts_after_second)

    skeletons_after_second = (
        (
            await db_session.execute(
                select(GeologicalFormationOrm).where(
                    GeologicalFormationOrm.source_litho_formation_id.is_not(None),
                    GeologicalFormationOrm.app_project_id == proj.id,
                )
            )
        )
        .scalars()
        .all()
    )
    skeleton_count_after_second = len(skeletons_after_second)

    assert contact_count_after_second == contact_count_after_first, (
        f"re-build must not duplicate geotech contacts on bh_straddle: "
        f"first={contact_count_after_first}, second={contact_count_after_second}"
    )
    assert skeleton_count_after_second == skeleton_count_after_first, (
        f"re-build must not duplicate skeleton formations: "
        f"first={skeleton_count_after_first}, second={skeleton_count_after_second}"
    )
