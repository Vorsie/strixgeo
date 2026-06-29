"""Materialise geotech bands for borehole columns using CPT TIN-interpolation.

:class:`DivideBoreholes` is a standalone step that runs **after**
:class:`~groundmodel.application.subdivide_all_bodies.SubdivideAllBodies`
(and optionally after the user has made manual packing correlations).  SAB
writes CPT geotech layers; DivideBoreholes reads those layers, rebuilds the
packing-transition surfaces they define, and materialises matching borehole
bands via TIN interpolation.

Separating borehole division from SAB allows the engineer to:

1. Run SAB (CPT-only subdivision + auto-connect).
2. Review + manually correlate packing bands across tests.
3. Click "Divide boreholes" — boreholes receive TIN-divided bands reflecting
   the FINAL body membership and packing structure, not the pre-correlation
   state that existed during SAB.

Architecture
------------
The use case inherits :class:`GeotechBoreholeMaterialiser` for the shared
TIN-interpolation logic.  It does NOT re-run the segmenter or
touch CPT geotech layers; those are owned by SAB.

What it persists (one transaction, single commit)
-------------------------------------------------
1. **Deletes** all existing borehole ``litho_layer`` rows in the geotech model
   (those written by a prior DivideBoreholes run — not CPT rows; those are SAB's).
2. **Inserts** new ``litho_layer`` rows for each borehole, one per TIN-derived
   band, with ``source='segmenter'``, ``status='accepted'``.
3. The LL→FC trigger auto-derives ``formation_contact`` rows.
4. ONE commit.

Idempotency
-----------
A re-run deletes the previous borehole bands before inserting new ones, so
the result is always consistent with the current CPT geotech layers.
"""

from __future__ import annotations

import time
from collections import defaultdict
from dataclasses import dataclass, field
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.geotech_borehole_materialiser import GeotechBoreholeMaterialiser
from groundmodel.application.scope_guard import load_scoped_or_raise
from groundmodel.domain.services.geotech_split_surface import ColumnXY
from groundmodel.domain.services.litho_geo_bounding import (
    divide_picks_by_geology,
    mark_and_truncate_shallow_tests,
)
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm


@dataclass(frozen=True)
class DivideBoreholeResult:
    """Result of :class:`DivideBoreholes`.

    Parameters
    ----------
    geotech_model_id : UUID
        The geotech model that was updated.
    divided_borehole_count : int
        Number of borehole columns that received ≥ 2 TIN-divided bands.
    single_band_borehole_count : int
        Number of borehole columns that received exactly 1 band (no CPT split
        surfaces existed or all splits were clamped out).
    layer_count : int
        Total ``litho_layer`` rows inserted for boreholes in this call.
    created_formation_ids : list[UUID]
        Newly created geotech ``geological_formation`` rows (find-or-create;
        a re-run only lists rows not already in the DB).
    """

    geotech_model_id: UUID
    divided_borehole_count: int
    single_band_borehole_count: int
    layer_count: int
    created_formation_ids: list[UUID] = field(default_factory=list)


class DivideBoreholes(GeotechBoreholeMaterialiser):
    """TIN-divide borehole columns in an existing geotech model.

    Reads the CPT geotech layers already in the geotech model (written by
    :class:`~groundmodel.application.subdivide_all_bodies.SubdivideAllBodies`),
    rebuilds the packing-transition surfaces they define, and materialises
    borehole bands via TIN interpolation per litho body group.

    The operation is idempotent: prior borehole geotech layers are deleted
    before new ones are written.

    Parameters
    ----------
    session : AsyncSession
        Active SQLAlchemy async session.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__, session)

    async def execute(
        self,
        *,
        project_id: UUID,
        litho_model_id: UUID,
    ) -> DivideBoreholeResult:
        """Materialise TIN-divided borehole bands for *litho_model_id*.

        Parameters
        ----------
        project_id : UUID
            Owning project id (used for scope guards and formation queries).
        litho_model_id : UUID
            The lithostratigraphic model whose geotech child model holds the
            CPT geotech layers.

        Returns
        -------
        DivideBoreholeResult
            Summary counts + the list of newly created geotech formation ids.

        Raises
        ------
        HTTPException
            404 when the litho model or geotech model does not exist.
        """
        t0 = time.monotonic()
        self.info(f"DivideBoreholes: start project={project_id} litho_model={litho_model_id}")

        # Phase 1 — load and validate litho model.
        litho_model = await load_scoped_or_raise(
            self._session,
            GeologicalModelOrm,
            litho_model_id,
            project_id,
            label="Litho model",
        )

        # Phase 2 — locate the geotech child model (must already exist).
        geotech_model = (
            (
                await self._session.execute(
                    select(GeologicalModelOrm).where(
                        GeologicalModelOrm.parent_geological_model_id == litho_model.id,
                        GeologicalModelOrm.kind == "geotechnical",
                    )
                )
            )
            .scalars()
            .first()
        )
        if geotech_model is None:
            from fastapi import HTTPException

            raise HTTPException(
                status_code=404,
                detail={
                    "code": "geotech_model_not_found",
                    "message": (
                        f"No geotechnical model exists for litho model {litho_model_id}. "
                        "Run 'Subdivide all bodies' first."
                    ),
                },
            )
        self.info(f"DivideBoreholes: geotech_model={geotech_model.id}")

        # Phase 3 — load litho body picks and geo-bound them.
        picks = await self._litho_repo.load_body_picks(litho_model_id)
        self.info(f"DivideBoreholes: {len(picks)} pick(s) in litho model")
        if not picks:
            self.warning("DivideBoreholes: no litho picks found — no borehole bands to materialise")
            await self._session.commit()
            return DivideBoreholeResult(
                geotech_model_id=geotech_model.id,
                divided_borehole_count=0,
                single_band_borehole_count=0,
                layer_count=0,
                created_formation_ids=[],
            )

        snap_tol = await self._read_geotech_snap_tolerance_m(project_id)
        geo_surfaces = await self._c1._load_geo_surfaces_with_formation(
            litho_model.parent_geological_model_id
        )
        boundary_sampler = self._c1._make_boundary_sampler(geo_surfaces)
        lowest_sampler = self._c1._make_lowest_boundary_sampler(geo_surfaces)

        shallow = mark_and_truncate_shallow_tests(picks, lowest_sampler)
        divided = divide_picks_by_geology(shallow.picks, boundary_sampler, snap_tol)
        self.debug(f"DivideBoreholes: {len(divided)} geo-bounded segment(s)")

        # Phase 4 — group by (body_id, source_geo_formation_id).
        groups = await self._group_segments(divided, geo_surfaces)
        self.info(f"DivideBoreholes: {len(groups)} body group(s)")

        # Phase 5 — classify each investigation as borehole or CPT.
        all_inv_ids = {UUID(s.investigation_id) for segs in groups.values() for s in segs}
        anchor_kind = await self._resolve_anchor_kinds(all_inv_ids)

        # Phase 6 — load all CPT geotech layers from the geotech model.
        # These define the packing-class sequence per investigation; from them
        # we derive the transition surfaces (base elevation of each CPT band k
        # → interpolated at the borehole XY → split depth).
        cpt_layer_rows = (
            await self._session.execute(
                select(
                    LithoLayerOrm.cpt_id,
                    LithoLayerOrm.depth_top_m,
                    LithoLayerOrm.depth_base_m,
                    LithoLayerOrm.id,
                    LithoLayerOrm.formation_id,
                    GeologicalFormationOrm.nad_class,
                )
                .join(
                    GeologicalFormationOrm,
                    LithoLayerOrm.formation_id == GeologicalFormationOrm.id,
                )
                .where(
                    LithoLayerOrm.model_id == geotech_model.id,
                    LithoLayerOrm.cpt_id.is_not(None),
                )
                .order_by(LithoLayerOrm.cpt_id, LithoLayerOrm.depth_top_m)
            )
        ).all()
        self.info(f"DivideBoreholes: {len(cpt_layer_rows)} CPT geotech layer(s) found in model")

        # Build geotech_layer_by_inv_depth: the same structure SAB populates
        # during its CPT pass.  DivideBoreholes reads it from the DB instead.
        geotech_layer_by_inv_depth: dict[str, list[tuple[float, float, UUID, UUID, int | None]]] = (
            defaultdict(list)
        )
        for row in cpt_layer_rows:
            inv_str = str(row.cpt_id)
            geotech_layer_by_inv_depth[inv_str].append(
                (row.depth_top_m, row.depth_base_m, row.id, row.formation_id, row.nad_class)
            )

        # Build CPT XY lookup — needed to construct ColumnXY for transition surfaces.
        cpt_ids_in_model = {row.cpt_id for row in cpt_layer_rows}
        cpt_xy: dict[UUID, tuple[float, float, float]] = {}
        if cpt_ids_in_model:
            from groundmodel.infrastructure.db.models.cpt_orm import CptOrm

            cpt_rows = (
                await self._session.execute(
                    select(
                        CptOrm.id, CptOrm.location_x, CptOrm.location_y, CptOrm.elevation_m
                    ).where(CptOrm.id.in_(cpt_ids_in_model))
                )
            ).all()
            for cr in cpt_rows:
                cpt_xy[cr.id] = (cr.location_x, cr.location_y, cr.elevation_m or 0.0)

        # Phase 7 — delete existing borehole geotech layers.
        # We do NOT delete CPT rows (those belong to SAB).
        deleted = (
            await self._session.execute(
                delete(LithoLayerOrm).where(
                    LithoLayerOrm.model_id == geotech_model.id,
                    LithoLayerOrm.borehole_id.is_not(None),
                )
            )
        ).rowcount
        self.info(f"DivideBoreholes: deleted {deleted} prior borehole geotech layer(s)")

        # Phase 8 — TIN-divide boreholes per body group.
        classified_by_key: dict[tuple[int, UUID, UUID | None], GeologicalFormationOrm] = {}
        skeleton_by_key: dict[tuple[UUID, UUID | None], GeologicalFormationOrm] = {}
        created_formation_ids: list[UUID] = []
        total_layers = 0
        divided_borehole_count = 0
        single_band_borehole_count = 0

        for (body_id_str, source_geo_fid), group_segs in groups.items():
            # Determine source litho formation for find-or-create key.
            source_litho_fid = UUID(group_segs[0].formation_id) if group_segs else uuid7()

            # Collect borehole members.
            borehole_segs = [
                s for s in group_segs if anchor_kind.get(s.investigation_id) == "borehole"
            ]
            if not borehole_segs:
                continue

            # Collect CPT members of this group.
            cpt_segs = [s for s in group_segs if anchor_kind.get(s.investigation_id) == "cpt"]

            # Build transition surfaces from the CPT geotech layers in this group.
            # transition_surfaces[k] = list of (ColumnXY, base_elevation_m) for
            # every CPT that has a k-th band (i.e. ≥ k+2 sub-layers in this group).
            transition_surfaces: list[list[tuple[ColumnXY, float]]] = []
            for cpt_seg in cpt_segs:
                inv_id = cpt_seg.investigation_id
                layers_for_inv = sorted(
                    geotech_layer_by_inv_depth.get(inv_id, []),
                    key=lambda t: t[0],
                )
                x_m, y_m, surface_elev = cpt_xy.get(UUID(inv_id), (0.0, 0.0, 0.0))
                col_xy = ColumnXY(investigation_id=inv_id, x_m=x_m, y_m=y_m)
                # Each band boundary k (between band k and k+1) is the base of band k.
                for k, (top_m, base_m, _lid, _fid, _nc) in enumerate(layers_for_inv):
                    if k < len(layers_for_inv) - 1:
                        # base elevation of band k
                        base_elev = surface_elev - base_m
                        while len(transition_surfaces) <= k:
                            transition_surfaces.append([])
                        transition_surfaces[k].append((col_xy, base_elev))

            self.debug(
                f"DivideBoreholes: group body={body_id_str} "
                f"borehole_segs={len(borehole_segs)} "
                f"cpt_segs={len(cpt_segs)} "
                f"transition_surfaces={len(transition_surfaces)}"
            )

            # Load borehole XY data.
            bh_ids = {UUID(s.investigation_id) for s in borehole_segs}
            bh_rows = (
                await self._session.execute(
                    select(
                        BoreholeOrm.id,
                        BoreholeOrm.location_x,
                        BoreholeOrm.location_y,
                        BoreholeOrm.elevation_m,
                    ).where(BoreholeOrm.id.in_(bh_ids))
                )
            ).all()
            bh_xy: dict[UUID, tuple[float, float, float]] = {
                br.id: (br.location_x, br.location_y, br.elevation_m or 0.0) for br in bh_rows
            }

            for bh_seg in borehole_segs:
                inv_id = bh_seg.investigation_id
                inv_uuid = UUID(inv_id)
                bh_x, bh_y, bh_elev = bh_xy.get(inv_uuid, (0.0, 0.0, 0.0))
                geo_top = bh_seg.top_depth_m
                geo_base = bh_seg.base_depth_m
                if geo_base <= geo_top:
                    continue

                bands = await self._materialise_borehole_bands(
                    project_id=project_id,
                    geotech_model_id=geotech_model.id,
                    inv_id=inv_id,
                    inv_uuid=inv_uuid,
                    bh_x=bh_x,
                    bh_y=bh_y,
                    bh_surface_elev=bh_elev,
                    geo_top_m=geo_top,
                    geo_base_m=geo_base,
                    transition_surfaces=transition_surfaces,
                    cpt_segs=cpt_segs,
                    source_litho_formation_id=source_litho_fid,
                    source_geo_formation_id=source_geo_fid,
                    classified_by_key=classified_by_key,
                    skeleton_by_key=skeleton_by_key,
                    created_formation_ids=created_formation_ids,
                    geotech_layer_by_inv_depth=geotech_layer_by_inv_depth,
                )
                total_layers += bands
                if bands >= 2:
                    divided_borehole_count += 1
                else:
                    single_band_borehole_count += 1

        await self._session.flush()
        await self._session.commit()

        elapsed = time.monotonic() - t0
        result = DivideBoreholeResult(
            geotech_model_id=geotech_model.id,
            divided_borehole_count=divided_borehole_count,
            single_band_borehole_count=single_band_borehole_count,
            layer_count=total_layers,
            created_formation_ids=created_formation_ids,
        )
        self.success(
            f"DivideBoreholes: geotech_model={geotech_model.id} "
            f"divided_bh={divided_borehole_count} "
            f"single_bh={single_band_borehole_count} "
            f"layers={total_layers} elapsed={elapsed:.1f}s"
        )
        return result
