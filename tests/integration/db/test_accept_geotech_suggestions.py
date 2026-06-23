"""Integration tests for ``AcceptGeotechSuggestions`` (geotech stage Slice 1, Task C2b).

The use case WRITES: it consumes the ephemeral suggestion DTOs produced by Task
C2a (``SuggestGeotechSubdivision``) and persists the accepted NAD sub-units as
geotech ``FormationContact`` rows referencing find-or-created CLASSIFIED
``geological_formation`` rows (keyed by the full triple
``(nad_class, source_litho_formation_id, source_geo_formation_id)``).  It runs in
a single commit and fires NO litho-side triggers.

Checkpoints
-----------
* **AG-1 (classified contacts + provenance):** accepting a CPT segment's
  sub-units writes geotech contacts referencing formations whose ``nad_class``
  is set (the accepted classes), and the segment-top contact retains the
  ``parent_geo_contact_id`` provenance the skeleton contact carried.
* **AG-2 (find-or-create sharing):** two segments / investigations resolving to
  the SAME ``(nad_class, source_litho_formation_id, source_geo_formation_id)``
  triple SHARE one geotech formation row — find-or-create, not duplicate.
* **AG-3 (idempotent re-accept):** calling accept twice with the same input does
  NOT duplicate contacts or formations (counts stable) and does NOT re-create
  skeletons.
* **AG-4 (no litho triggers):** accept does not touch litho layers / does not run
  RecomputeAbsences / wedge-tips / admixture propagation — the litho model's
  layer + contact counts are unchanged.
* **Orphan cleanup:** skeleton formations whose contacts were all retargeted to
  classified formations are deleted.

Scene geometry
--------------
Reuses the Task C2a scene shape: one flat geological surface at elevation 0.0 m
(depth 5.0 m below a 5.0 m surface).  Three investigations on a section line:

* ``cpt_split`` — CPT, qc=8 MPa above 6.5 m / qc=18 MPa below → ≥2 NAD classes.
* ``cpt_low``  — CPT, uniform qc=8 MPa → same low NAD class as cpt_split's upper.
* ``bh``        — borehole (no qc) → carry-through ``nad_class=None``.

The ZAND litho layer 2–8 m straddles the 5 m geo boundary → two geotech
segments per investigation (2–5 m and 5–8 m).
"""

from __future__ import annotations

from uuid import UUID

import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.accept_geotech_suggestions import (
    AcceptedGeotechSubUnit,
    AcceptGeotechSegment,
    AcceptGeotechSuggestions,
)
from groundmodel.application.build_geotech_model_from_litho import BuildGeotechModelFromLitho
from groundmodel.application.suggest_geotech_subdivision import (
    GeotechInvestigationSuggestion,
    SuggestGeotechSubdivision,
)
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cpt_series_orm import CptSeriesOrm
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.formation_surface_orm import FormationSurfaceOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm

# Section corridor geometry — investigations lie on this line inside the buffer.
_SEC_START = (149000.0, 200000.0)
_SEC_END = (151000.0, 200000.0)
_SURFACE_ELEV_M = 5.0
_GEO_SURFACE_ELEV_M = 0.0

_CPT_STEP_M = 0.02

_CPT_LAYER_TOP_M = 2.0
_CPT_LAYER_BASE_M = 8.0
_QC_LOW_MPA = 8.0
_QC_HIGH_MPA = 18.0
_QC_SPLIT_DEPTH_M = 6.5


def _flat_tin_vertices() -> list[list[float]]:
    """Four corners of a flat TIN at ``_GEO_SURFACE_ELEV_M`` covering the corridor."""
    return [
        [148000.0, 199000.0, _GEO_SURFACE_ELEV_M],
        [152000.0, 199000.0, _GEO_SURFACE_ELEV_M],
        [152000.0, 201000.0, _GEO_SURFACE_ELEV_M],
        [148000.0, 201000.0, _GEO_SURFACE_ELEV_M],
    ]


def _make_cpt_series(cpt_id: UUID) -> CptSeriesOrm:
    """qc series for ``cpt_split``: 8 MPa above 6.5 m, 18 MPa at/below 6.5 m."""
    depths: list[float] = []
    qc: list[float] = []
    d = 0.0
    while d <= 10.0 + 1e-9:
        depths.append(round(d, 3))
        qc.append(_QC_HIGH_MPA if d >= _QC_SPLIT_DEPTH_M else _QC_LOW_MPA)
        d += _CPT_STEP_M
    return CptSeriesOrm(cpt_id=cpt_id, depths_m=depths, qc_mpa=qc)


def _make_cpt_series_uniform(cpt_id: UUID, qc_val: float) -> CptSeriesOrm:
    """Uniform qc series for ``cpt_low``."""
    depths: list[float] = []
    qc: list[float] = []
    d = 0.0
    while d <= 10.0 + 1e-9:
        depths.append(round(d, 3))
        qc.append(qc_val)
        d += _CPT_STEP_M
    return CptSeriesOrm(cpt_id=cpt_id, depths_m=depths, qc_mpa=qc)


@pytest_asyncio.fixture
async def scene(db_session: AsyncSession) -> dict:
    """Full scene + C1 skeleton already built (mirrors the C2a suggest test)."""
    proj = ProjectOrm(id=uuid7(), name="Accept geotech test", status="active")
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

    geo_deep = GeologicalFormationOrm(
        id=uuid7(), app_project_id=proj.id, name="Q_DEEP", color="#999", display_order=1
    )
    f_sand = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=proj.id,
        name="ZAND",
        color="#f5deb3",
        display_order=1,
        litho_main_soil_code="ZAND",
        litho_admixtures=[],
    )
    db_session.add_all([geo_deep, f_sand])
    await db_session.flush()

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

    cpt_split = CptOrm(
        id=uuid7(),
        name="CPT-SPLIT",
        cpt_type="CPTE",
        app_project_id=proj.id,
        project_id="ACCEPT",
        test_id="CPT-SPLIT",
        location_x=149800.0,
        location_y=200000.0,
        elevation_m=_SURFACE_ELEV_M,
        epsg=31370,
        elevation_source="none",
        max_depth_m=10.0,
    )
    cpt_low = CptOrm(
        id=uuid7(),
        name="CPT-LOW",
        cpt_type="CPTE",
        app_project_id=proj.id,
        project_id="ACCEPT",
        test_id="CPT-LOW",
        location_x=150000.0,
        location_y=200000.0,
        elevation_m=_SURFACE_ELEV_M,
        epsg=31370,
        elevation_source="none",
        max_depth_m=10.0,
    )
    db_session.add_all([cpt_split, cpt_low])
    await db_session.flush()

    db_session.add(_make_cpt_series(cpt_split.id))
    db_session.add(_make_cpt_series_uniform(cpt_low.id, _QC_LOW_MPA))

    bh = BoreholeOrm(
        id=uuid7(),
        name="BH-ACCEPT",
        app_project_id=proj.id,
        project_id="ACCEPT",
        test_id="BH-ACCEPT",
        location_x=150200.0,
        location_y=200000.0,
        elevation_m=_SURFACE_ELEV_M,
        epsg=31370,
        total_depth_m=12.0,
    )
    db_session.add(bh)
    await db_session.flush()

    # Geological contacts at depth 5.0 m on each investigation (the geo boundary).
    for anchor_kwargs in [
        {"cpt_id": cpt_split.id},
        {"cpt_id": cpt_low.id},
        {"borehole_id": bh.id},
    ]:
        db_session.add(
            FormationContactOrm(
                id=uuid7(),
                model_id=geo.id,
                formation_id=geo_deep.id,
                depth_top_m=5.0,
                source="manual_pick",
                **anchor_kwargs,
            )
        )

    # Litho layers (all ZAND, 2.0 → 8.0 m, straddling the 5.0 m geo boundary).
    for anchor_kwargs in [
        {"cpt_id": cpt_split.id},
        {"cpt_id": cpt_low.id},
        {"borehole_id": bh.id},
    ]:
        db_session.add(
            LithoLayerOrm(
                id=uuid7(),
                model_id=litho.id,
                formation_id=f_sand.id,
                depth_top_m=_CPT_LAYER_TOP_M,
                depth_base_m=_CPT_LAYER_BASE_M,
                status="accepted",
                source="manual",
                confidence="medium",
                **anchor_kwargs,
            )
        )

    section = CrossSectionOrm(
        id=uuid7(),
        app_project_id=proj.id,
        name="S-ACCEPT",
        start_x=_SEC_START[0],
        start_y=_SEC_START[1],
        end_x=_SEC_END[0],
        end_y=_SEC_END[1],
        epsg=31370,
        projection_buffer_m=500.0,
    )
    db_session.add(section)
    await db_session.commit()

    result = await BuildGeotechModelFromLitho(db_session).execute(
        project_id=proj.id,
        litho_model_id=litho.id,
        section_id=section.id,
    )

    return {
        "project": proj,
        "geo": geo,
        "litho": litho,
        "section_id": section.id,
        "geotech_model_id": result.geotech_model_id,
        "geo_deep": geo_deep,
        "f_sand": f_sand,
        "cpt_split": cpt_split,
        "cpt_low": cpt_low,
        "bh": bh,
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _to_accept_segments(
    suggestions: list[GeotechInvestigationSuggestion],
) -> list[AcceptGeotechSegment]:
    """Convert every suggested segment into an accept-request segment (accept-all).

    Carries each segment's sub-units verbatim into the accept-request DTO.
    """
    accept_segments: list[AcceptGeotechSegment] = []
    for inv in suggestions:
        for seg in inv.segments:
            accept_segments.append(
                AcceptGeotechSegment(
                    investigation_id=inv.investigation_id,
                    segment_top_m=seg.segment_top_m,
                    segment_base_m=seg.segment_base_m,
                    sub_units=[
                        AcceptedGeotechSubUnit(
                            investigation_id=inv.investigation_id,
                            depth_top_m=g.depth_top_m,
                            depth_base_m=g.depth_base_m,
                            nad_class=g.nad_class,
                            source_litho_formation_id=g.source_litho_formation_id,
                            source_geo_formation_id=g.source_geo_formation_id,
                        )
                        for g in seg.ghost_sub_units
                    ],
                )
            )
    return accept_segments


async def _count_geotech_contacts(db_session: AsyncSession, geotech_model_id: UUID) -> int:
    """Count all FormationContact rows for the geotech model."""
    result = await db_session.execute(
        select(func.count()).where(FormationContactOrm.model_id == geotech_model_id)
    )
    return result.scalar_one()


async def _count_classified_formations(db_session: AsyncSession, project_id: UUID) -> int:
    """Count classified (nad_class non-null) geotech formations in the project."""
    result = await db_session.execute(
        select(func.count()).where(
            GeologicalFormationOrm.app_project_id == project_id,
            GeologicalFormationOrm.nad_class.is_not(None),
        )
    )
    return result.scalar_one()


async def _count_skeleton_formations(db_session: AsyncSession, project_id: UUID) -> int:
    """Count skeleton (nad_class null, source_litho set) geotech formations."""
    result = await db_session.execute(
        select(func.count()).where(
            GeologicalFormationOrm.app_project_id == project_id,
            GeologicalFormationOrm.nad_class.is_(None),
            GeologicalFormationOrm.source_litho_formation_id.is_not(None),
        )
    )
    return result.scalar_one()


async def _suggest(db_session: AsyncSession, scene: dict) -> list[GeotechInvestigationSuggestion]:
    """Run the C2a suggester for the scene's section."""
    return await SuggestGeotechSubdivision(db_session).execute(
        project_id=scene["project"].id,
        geotech_model_id=scene["geotech_model_id"],
        section_id=scene["section_id"],
    )


async def _accept(
    db_session: AsyncSession, scene: dict, segments: list[AcceptGeotechSegment]
) -> object:
    """Run the C2b accept use case for the scene's section."""
    return await AcceptGeotechSuggestions(db_session).execute(
        project_id=scene["project"].id,
        geotech_model_id=scene["geotech_model_id"],
        section_id=scene["section_id"],
        segments=segments,
    )


# ---------------------------------------------------------------------------
# AG-1 — classified contacts + provenance preserved on segment-top
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ag1_accept_writes_classified_contacts_and_keeps_provenance(
    db_session: AsyncSession, scene: dict
) -> None:
    """AG-1: accepting a CPT segment's sub-units writes contacts referencing
    formations whose nad_class is set, and the segment-top contact keeps its
    ``parent_geo_contact_id`` provenance from the skeleton.
    """
    geotech_model_id: UUID = scene["geotech_model_id"]
    cpt_split_id: UUID = scene["cpt_split"].id

    # Capture the skeleton's parent_geo_contact_id at the lower segment top (5.0 m)
    # for cpt_split BEFORE accept — it should survive the retarget.
    skeleton_lower_top = (
        await db_session.execute(
            select(FormationContactOrm).where(
                FormationContactOrm.model_id == geotech_model_id,
                FormationContactOrm.cpt_id == cpt_split_id,
                FormationContactOrm.depth_top_m >= 5.0 - 1e-4,
                FormationContactOrm.depth_top_m <= 5.0 + 1e-4,
            )
        )
    ).scalar_one()
    expected_parent_geo = skeleton_lower_top.parent_geo_contact_id
    assert expected_parent_geo is not None, (
        "precondition: the 5.0 m geo-division cut must carry parent_geo_contact_id"
    )

    suggestions = await _suggest(db_session, scene)
    segments = _to_accept_segments(suggestions)
    await _accept(db_session, scene, segments)

    # All cpt_split contacts now reference classified formations (nad_class set).
    rows = (
        await db_session.execute(
            select(FormationContactOrm, GeologicalFormationOrm)
            .join(
                GeologicalFormationOrm,
                FormationContactOrm.formation_id == GeologicalFormationOrm.id,
            )
            .where(
                FormationContactOrm.model_id == geotech_model_id,
                FormationContactOrm.cpt_id == cpt_split_id,
            )
        )
    ).all()
    assert rows, "cpt_split must have geotech contacts after accept"
    assert all(f.nad_class is not None for _, f in rows), (
        "every accepted CPT contact must reference a classified (nad_class set) formation"
    )

    # The lower-segment top (5.0 m) contact must keep the skeleton's provenance.
    lower_top_contacts = [c for c, _ in rows if abs(c.depth_top_m - 5.0) <= 1e-4]
    assert lower_top_contacts, "expected a contact at the 5.0 m lower-segment top"
    assert all(c.parent_geo_contact_id == expected_parent_geo for c in lower_top_contacts), (
        "the segment-top contact must retain its parent_geo_contact_id after retarget"
    )

    # Internal (non-segment-top) sub-unit contacts carry no geo provenance.
    internal = [
        c for c, _ in rows if abs(c.depth_top_m - 5.0) > 1e-4 and abs(c.depth_top_m - 2.0) > 1e-4
    ]
    assert all(c.parent_geo_contact_id is None for c in internal), (
        "internal sub-unit contacts must have parent_geo_contact_id=None"
    )


# ---------------------------------------------------------------------------
# AG-2 — same triple → one shared geotech formation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ag2_same_triple_shares_one_formation(db_session: AsyncSession, scene: dict) -> None:
    """AG-2: cpt_split's upper segment (qc=8) and cpt_low's upper segment (qc=8)
    resolve to the same ``(nad_class, source_litho, source_geo)`` triple and must
    SHARE one geotech formation row (find-or-create, not duplicate).
    """
    project_id: UUID = scene["project"].id
    suggestions = await _suggest(db_session, scene)
    segments = _to_accept_segments(suggestions)
    await _accept(db_session, scene, segments)

    # Group classified formations by their triple — none should be duplicated.
    rows = (
        (
            await db_session.execute(
                select(GeologicalFormationOrm).where(
                    GeologicalFormationOrm.app_project_id == project_id,
                    GeologicalFormationOrm.nad_class.is_not(None),
                )
            )
        )
        .scalars()
        .all()
    )
    seen: dict[tuple, UUID] = {}
    for f in rows:
        key = (f.nad_class, f.source_litho_formation_id, f.source_geo_formation_id)
        assert key not in seen, (
            f"duplicate classified formation for triple {key}: {f.id} and {seen[key]}"
        )
        seen[key] = f.id

    # The two upper segments (cpt_split + cpt_low, qc=8, same litho, same geo band)
    # share one formation: assert the upper-segment contacts on both CPTs reference
    # the same formation_id.
    cpt_split_upper = (
        (
            await db_session.execute(
                select(FormationContactOrm.formation_id).where(
                    FormationContactOrm.model_id == scene["geotech_model_id"],
                    FormationContactOrm.cpt_id == scene["cpt_split"].id,
                    FormationContactOrm.depth_top_m <= 5.0 - 1e-4,
                )
            )
        )
        .scalars()
        .all()
    )
    cpt_low_upper = (
        (
            await db_session.execute(
                select(FormationContactOrm.formation_id).where(
                    FormationContactOrm.model_id == scene["geotech_model_id"],
                    FormationContactOrm.cpt_id == scene["cpt_low"].id,
                    FormationContactOrm.depth_top_m <= 5.0 - 1e-4,
                )
            )
        )
        .scalars()
        .all()
    )
    assert set(cpt_split_upper) & set(cpt_low_upper), (
        "the two upper CPT segments (same triple) must share a geotech formation row"
    )


# ---------------------------------------------------------------------------
# AG-3 — idempotent re-accept
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ag3_re_accept_is_idempotent(db_session: AsyncSession, scene: dict) -> None:
    """AG-3: accepting the same input twice does not duplicate contacts or
    formations and does not re-create skeleton rows.
    """
    geotech_model_id: UUID = scene["geotech_model_id"]
    project_id: UUID = scene["project"].id

    suggestions = await _suggest(db_session, scene)
    segments = _to_accept_segments(suggestions)

    await _accept(db_session, scene, segments)
    contacts_after_first = await _count_geotech_contacts(db_session, geotech_model_id)
    classified_after_first = await _count_classified_formations(db_session, project_id)
    skeletons_after_first = await _count_skeleton_formations(db_session, project_id)

    await _accept(db_session, scene, segments)
    contacts_after_second = await _count_geotech_contacts(db_session, geotech_model_id)
    classified_after_second = await _count_classified_formations(db_session, project_id)
    skeletons_after_second = await _count_skeleton_formations(db_session, project_id)

    assert contacts_after_second == contacts_after_first, (
        f"re-accept must not duplicate contacts; "
        f"first={contacts_after_first} second={contacts_after_second}"
    )
    assert classified_after_second == classified_after_first, (
        f"re-accept must not duplicate classified formations; "
        f"first={classified_after_first} second={classified_after_second}"
    )
    assert skeletons_after_second == skeletons_after_first, (
        f"re-accept must not re-create skeleton formations; "
        f"first={skeletons_after_first} second={skeletons_after_second}"
    )


# ---------------------------------------------------------------------------
# AG-4 — no litho-side triggers / writes
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ag4_accept_does_not_touch_litho(db_session: AsyncSession, scene: dict) -> None:
    """AG-4: accept does not touch litho layers / litho contacts (no absence
    recompute, no wedge-tips, no admixture propagation).
    """
    litho_model_id: UUID = scene["litho"].id

    async def _litho_layer_count() -> int:
        return (
            await db_session.execute(
                select(func.count()).where(LithoLayerOrm.model_id == litho_model_id)
            )
        ).scalar_one()

    async def _litho_contact_count() -> int:
        return (
            await db_session.execute(
                select(func.count()).where(FormationContactOrm.model_id == litho_model_id)
            )
        ).scalar_one()

    layers_before = await _litho_layer_count()
    litho_contacts_before = await _litho_contact_count()

    suggestions = await _suggest(db_session, scene)
    segments = _to_accept_segments(suggestions)
    await _accept(db_session, scene, segments)

    assert await _litho_layer_count() == layers_before, "accept must not add/remove litho layers"
    assert await _litho_contact_count() == litho_contacts_before, (
        "accept must not add/remove litho contacts"
    )


# ---------------------------------------------------------------------------
# Orphan cleanup — retargeted skeletons are deleted
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_orphan_skeletons_deleted_after_accept(db_session: AsyncSession, scene: dict) -> None:
    """After accepting every segment, the skeleton formations whose contacts were
    all retargeted to classified formations carry zero contacts and are deleted.
    """
    project_id: UUID = scene["project"].id

    skeletons_before = await _count_skeleton_formations(db_session, project_id)
    assert skeletons_before > 0, "precondition: C1 build created skeleton formations"

    suggestions = await _suggest(db_session, scene)
    segments = _to_accept_segments(suggestions)
    await _accept(db_session, scene, segments)

    # The borehole carry-through (nad_class=None) sub-units still reference a
    # skeleton-shaped formation, so not every skeleton is necessarily gone — but
    # any skeleton with ZERO referencing contacts must be deleted.
    remaining_skeletons = (
        (
            await db_session.execute(
                select(GeologicalFormationOrm.id).where(
                    GeologicalFormationOrm.app_project_id == project_id,
                    GeologicalFormationOrm.nad_class.is_(None),
                    GeologicalFormationOrm.source_litho_formation_id.is_not(None),
                )
            )
        )
        .scalars()
        .all()
    )
    for skel_id in remaining_skeletons:
        ref_count = (
            await db_session.execute(
                select(func.count()).where(FormationContactOrm.formation_id == skel_id)
            )
        ).scalar_one()
        assert ref_count > 0, (
            f"orphan skeleton {skel_id} with zero referencing contacts must be deleted"
        )
