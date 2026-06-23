"""Integration tests for ``SuggestGeotechSubdivision`` (geotech stage Slice 1, Task C2a).

The use case is EPHEMERAL: it loads the geotech skeleton built by Task C1
(``BuildGeotechModelFromLitho``), reconstructs geo-bounded segments per
in-corridor investigation, and returns a per-investigation list of suggested
NAD sub-units.  Nothing is written to the database.

Checkpoints
-----------
* **CP-1 (CPT packing split):** a CPT segment whose qc series has two
  distinct packing regions produces ≥2 ghost sub-units with non-null
  ``nad_class`` in the expected top-to-bottom order.
* **CP-2 (provenance on ghost):** each ghost sub-unit carries
  ``source_litho_formation_id`` and ``source_geo_formation_id`` so that
  Task C2b Accept can find-or-create the real formation by the triple
  ``(nad_class, source_litho_formation_id, source_geo_formation_id)``.
* **CP-3 (borehole carry-through):** the borehole investigation produces
  one ghost per geotech segment with ``nad_class=None`` (no qc available).
* **CP-4 (no DB writes):** the geotech contact count is identical before
  and after calling ``SuggestGeotechSubdivision`` — the use case is
  ephemeral.

Scene geometry
--------------
One flat geological surface at elevation 0.0 m (depth 5.0 m below a 5.0 m
surface).  Three investigations sit on a section line at surface elevation
5.0 m:

* ``cpt_low``  — CPT, qc=8 MPa throughout → one low-packing segment.
* ``cpt_split`` — CPT, qc=8 MPa upper half / qc=18 MPa lower half (split at
  the segment midpoint) → the geotech suggester should produce ≥2 sub-units
  because the classify_nad call on the upper samples yields a different NAD
  class from the lower samples (the exact classes are ZAND-specific, but
  different qc values give different NAD classes).
* ``bh``        — borehole (no qc series) → one carry-through per geotech
  segment, ``nad_class=None``.

The CPT qc series are seeded at 0.02 m increment (matching a typical DOV CPT)
with enough samples to span the geotech segment and create a detectable packing
contrast.
"""

from __future__ import annotations

from uuid import UUID

import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.build_geotech_model_from_litho import BuildGeotechModelFromLitho
from groundmodel.application.suggest_geotech_subdivision import SuggestGeotechSubdivision
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
# Flat geo surface (top of Q_DEEP) at this absolute elevation.
# Depth to geo surface from surface = 5.0 m.
_GEO_SURFACE_ELEV_M = 0.0

# CPT sampling increment (metres)
_CPT_STEP_M = 0.02

# The litho ZAND layer on the CPT investigations spans 2.0 → 8.0 m (depth),
# straddling the 5.0 m geo boundary → two geotech segments: 2.0–5.0 m and
# 5.0–8.0 m.  The qc split is placed at the segment midpoint 6.5 m:
#   upper segment samples (depth < 5.0): qc=8 MPa  (loose-ish ZAND)
#   lower segment samples (depth 5.0–8.0, lower half ~6.5–8.0): qc=18 MPa (denser)
# The upper segment will classify to a different NAD class than the lower.
_CPT_LAYER_TOP_M = 2.0
_CPT_LAYER_BASE_M = 8.0
_QC_LOW_MPA = 8.0
_QC_HIGH_MPA = 18.0
_QC_SPLIT_DEPTH_M = 6.5  # depth at which the qc switches from low → high


def _flat_tin_vertices() -> list[list[float]]:
    """Four corners of a flat TIN at ``_GEO_SURFACE_ELEV_M`` covering the corridor."""
    return [
        [148000.0, 199000.0, _GEO_SURFACE_ELEV_M],
        [152000.0, 199000.0, _GEO_SURFACE_ELEV_M],
        [152000.0, 201000.0, _GEO_SURFACE_ELEV_M],
        [148000.0, 201000.0, _GEO_SURFACE_ELEV_M],
    ]


def _make_cpt_series(cpt_id: UUID) -> CptSeriesOrm:
    """qc series for ``cpt_split``: 8 MPa above 6.5 m, 18 MPa at/below 6.5 m.

    The series covers 0 → 10 m at 0.02 m increments so the geotech segment
    [2.0, 8.0] has plenty of samples.
    """
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
    """Full scene: geo + litho model + CPTs + borehole + section + C1 skeleton.

    Returns a dict keyed by the names the test functions reference.
    After this fixture returns, ``BuildGeotechModelFromLitho`` has already
    run so ``geotech_model_id`` is set and the skeleton contacts exist.
    """
    proj = ProjectOrm(id=uuid7(), name="Suggest geotech test", status="active")
    db_session.add(proj)
    await db_session.flush()

    # Geological model + deep formation.
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

    # Geological formation + built surface.
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

    # CPT investigations.
    cpt_split = CptOrm(
        id=uuid7(),
        name="CPT-SPLIT",
        cpt_type="CPTE",
        app_project_id=proj.id,
        project_id="SUGGEST",
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
        project_id="SUGGEST",
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

    # Borehole investigation.
    bh = BoreholeOrm(
        id=uuid7(),
        name="BH-SUGGEST",
        app_project_id=proj.id,
        project_id="SUGGEST",
        test_id="BH-SUGGEST",
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

    # Cross-section covering the corridor.
    section = CrossSectionOrm(
        id=uuid7(),
        app_project_id=proj.id,
        name="S-SUGGEST",
        start_x=_SEC_START[0],
        start_y=_SEC_START[1],
        end_x=_SEC_END[0],
        end_y=_SEC_END[1],
        epsg=31370,
        projection_buffer_m=500.0,
    )
    db_session.add(section)
    await db_session.commit()

    # Run C1 build so the geotech skeleton exists.
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
# Test helpers
# ---------------------------------------------------------------------------


async def _count_geotech_contacts(db_session: AsyncSession, geotech_model_id: UUID) -> int:
    """Count all FormationContact rows for the geotech model."""
    result = await db_session.execute(
        select(func.count()).where(FormationContactOrm.model_id == geotech_model_id)
    )
    return result.scalar_one()


# ---------------------------------------------------------------------------
# CP-1 — CPT segment with two distinct packing regions → ≥2 ghost sub-units
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cp1_cpt_split_yields_multiple_nad_sub_units(
    db_session: AsyncSession, scene: dict
) -> None:
    """CP-1: the CPT with low qc upper / high qc lower yields ≥2 ghost sub-units
    with non-null nad_class, ordered top-to-bottom within the segment.

    The first lower-segment sub-unit should have a different NAD class than
    the upper segment (the qc jump from 8 → 18 MPa crosses an NAD boundary
    for ZAND, which has a finer qc grid than KLEI).
    """
    uc = SuggestGeotechSubdivision(db_session)
    suggestions = await uc.execute(
        project_id=scene["project"].id,
        geotech_model_id=scene["geotech_model_id"],
        section_id=scene["section_id"],
    )

    # Find the result for cpt_split.
    cpt_split_id = scene["cpt_split"].id
    cpt_result = next((s for s in suggestions if s.investigation_id == cpt_split_id), None)
    assert cpt_result is not None, "cpt_split must appear in the suggestion results"

    # Flatten all ghost sub-units for cpt_split.
    all_ghosts = [g for seg in cpt_result.segments for g in seg.ghost_sub_units]

    # At least 2 sub-units — one in the upper segment (qc=8), one in the lower
    # (qc=18) — they must have different NAD classes.
    assert len(all_ghosts) >= 2, (
        f"expected ≥2 ghost sub-units for cpt_split; got {len(all_ghosts)}: {all_ghosts}"
    )
    assert all(g.nad_class is not None for g in all_ghosts), (
        "CPT ghost sub-units must have a non-null nad_class"
    )
    nad_classes = [g.nad_class for g in all_ghosts]
    assert len(set(nad_classes)) >= 2, (
        f"qc 8 MPa vs 18 MPa must produce ≥2 distinct NAD classes; got {nad_classes}"
    )

    # Sub-units must be ordered top-to-bottom (non-decreasing depth_top_m).
    tops = [g.depth_top_m for g in all_ghosts]
    assert tops == sorted(tops), f"ghost sub-units must be ordered top-to-bottom; tops={tops}"


# ---------------------------------------------------------------------------
# CP-2 — each ghost carries source provenance FKs
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cp2_ghosts_carry_source_formation_provenance(
    db_session: AsyncSession, scene: dict
) -> None:
    """CP-2: every ghost sub-unit carries ``source_litho_formation_id`` and
    ``source_geo_formation_id`` so Task C2b Accept can key its find-or-create.

    The ZAND layer straddles the geo boundary, so the lower geotech segment sits
    inside ``Q_DEEP`` → ``source_geo_formation_id`` is non-null on those ghosts.
    The upper segment is in the open shallow band → ``source_geo_formation_id``
    may be None (no geological surface above it).
    """
    uc = SuggestGeotechSubdivision(db_session)
    suggestions = await uc.execute(
        project_id=scene["project"].id,
        geotech_model_id=scene["geotech_model_id"],
        section_id=scene["section_id"],
    )

    cpt_split_id = scene["cpt_split"].id
    cpt_result = next((s for s in suggestions if s.investigation_id == cpt_split_id), None)
    assert cpt_result is not None

    all_ghosts = [g for seg in cpt_result.segments for g in seg.ghost_sub_units]
    assert all_ghosts, "cpt_split must have ghost sub-units"

    # Every ghost must carry source_litho_formation_id.
    f_sand_id: UUID = scene["f_sand"].id
    for g in all_ghosts:
        assert g.source_litho_formation_id == f_sand_id, (
            f"ghost.source_litho_formation_id must equal the ZAND litho formation; "
            f"got {g.source_litho_formation_id}"
        )

    # The lower segment ghosts (those with depth_top_m >= 5.0) must have
    # source_geo_formation_id == geo_deep.id.
    geo_deep_id: UUID = scene["geo_deep"].id
    lower_ghosts = [g for g in all_ghosts if g.depth_top_m >= 5.0 - 1e-4]
    assert lower_ghosts, "expected at least one ghost in the lower (geo-bounded) segment"
    for g in lower_ghosts:
        assert g.source_geo_formation_id == geo_deep_id, (
            f"lower segment ghost.source_geo_formation_id must equal Q_DEEP; "
            f"got {g.source_geo_formation_id}"
        )


# ---------------------------------------------------------------------------
# CP-3 — borehole produces one carry-through sub-unit per segment, nad_class=None
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cp3_borehole_produces_nad_none_carry_throughs(
    db_session: AsyncSession, scene: dict
) -> None:
    """CP-3: the borehole investigation has no qc series → one ``nad_class=None``
    ghost per geotech skeleton segment (carry-through with no classification).

    The ZAND layer 2–8 m straddles the 5 m geo boundary → 2 geotech segments →
    2 carry-through ghosts.
    """
    uc = SuggestGeotechSubdivision(db_session)
    suggestions = await uc.execute(
        project_id=scene["project"].id,
        geotech_model_id=scene["geotech_model_id"],
        section_id=scene["section_id"],
    )

    bh_id = scene["bh"].id
    bh_result = next((s for s in suggestions if s.investigation_id == bh_id), None)
    assert bh_result is not None, "borehole must appear in the suggestion results"

    all_ghosts = [g for seg in bh_result.segments for g in seg.ghost_sub_units]

    # One carry-through ghost per skeleton segment.
    # The ZAND layer spans 2–8 m straddling the 5 m geo boundary → 2 segments.
    assert len(all_ghosts) == 2, (
        f"borehole should have 2 carry-through ghosts (one per segment); "
        f"got {len(all_ghosts)}: {all_ghosts}"
    )
    assert all(g.nad_class is None for g in all_ghosts), (
        "borehole carry-through ghosts must have nad_class=None (no qc available)"
    )


# ---------------------------------------------------------------------------
# CP-4 — suggest is ephemeral: no new DB rows written
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cp4_suggest_is_ephemeral_no_db_writes(db_session: AsyncSession, scene: dict) -> None:
    """CP-4: the contact row count for the geotech model is unchanged after
    calling ``SuggestGeotechSubdivision`` — the use case is read-only.
    """
    geotech_model_id: UUID = scene["geotech_model_id"]

    count_before = await _count_geotech_contacts(db_session, geotech_model_id)

    await SuggestGeotechSubdivision(db_session).execute(
        project_id=scene["project"].id,
        geotech_model_id=geotech_model_id,
        section_id=scene["section_id"],
    )

    count_after = await _count_geotech_contacts(db_session, geotech_model_id)

    assert count_after == count_before, (
        f"SuggestGeotechSubdivision must not write DB rows; "
        f"count before={count_before}, after={count_after}"
    )
