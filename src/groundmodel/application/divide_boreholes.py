"""Materialise geotech bands for borehole columns using litho-confined CPT fill.

:class:`DivideBoreholes` is a standalone step that runs **after**
:class:`~groundmodel.application.subdivide_all_bodies.SubdivideAllBodies`
(and optionally after the user has made manual packing correlations).  SAB
writes CPT geotech layers; DivideBoreholes reads those layers, and for each
borehole's litho-body extent fills it with same-lithology CPT packing data,
clipped to that extent, with a conservative cascade for any uncovered depth.

Why litho-confined (not plain TIN interpolation)
------------------------------------------------
The original TIN approach interpolated packing transition surfaces from ALL
CPTs in the body group — regardless of whether those CPTs' geotech bands fall
within the same lithology as the borehole extent being filled.  On a borehole
with sand over basal clay, a CPT column that runs sand from 0–8 m can have
packing transitions at e.g. 6 m; TIN-clamping that transition to the
borehole's clay extent (3–8 m) stamped a sand packing class onto the clay.

The litho-confined approach: for each CPT in the body group, restrict its
geotech layers to those that fall within the CPT's own litho-body extent
(i.e. the CPT's litho layer that shares the body).  Only those same-depth
bands are used to build the packing surfaces at the borehole XY.

Separating borehole division from SAB allows the engineer to:

1. Run SAB (CPT-only subdivision + auto-connect).
2. Review + manually correlate packing bands across tests.
3. Click "Divide boreholes" — boreholes receive litho-confined bands
   reflecting the FINAL body membership and packing structure.

Architecture
------------
The use case inherits :class:`GeotechBoreholeMaterialiser` for the shared
formation find-or-create logic.  The TIN-interpolation step is re-implemented
here with the litho-extent filter; the base-class
``_materialise_borehole_bands`` (used by SAB) is left unchanged.

What it persists (one transaction, single commit)
-------------------------------------------------
1. **Deletes** all existing borehole ``litho_layer`` rows in the geotech model.
2. **Inserts** new ``litho_layer`` rows, one per
   :class:`~groundmodel.domain.services.borehole_packing_fill.FillBand`,
   with ``source='segmenter'`` and ``confidence`` driven by band provenance:
   ``"cpt_interpolated"`` → ``high``, ``"body_min"`` / ``"absolute_min"`` → ``low``.
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
from groundmodel.domain.services.assign_borehole_band_body import (
    CptBandRef,
    assign_borehole_band_body,
)
from groundmodel.domain.services.assign_sample_to_band import Band, assign_sample_to_band
from groundmodel.domain.services.borehole_packing_fill import (
    FillBand,
    fill_borehole_litho_body_extent,
)
from groundmodel.domain.services.geotech_split_surface import ColumnXY, interpolate_split_elevations
from groundmodel.domain.services.geotech_subdivision_constants import LITHO_ABSOLUTE_MIN_NAD
from groundmodel.domain.services.litho_body_pick import BodyLayerPick
from groundmodel.domain.services.litho_geo_bounding import (
    divide_picks_by_geology,
    mark_and_truncate_shallow_tests,
)
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.sample_orm import SampleOrm

# 1 mm guard so a split doesn't land exactly on the geo-bounded boundary
# (which would produce a zero-thickness band at the edge).
_CLAMP_GUARD = 0.001

# Epsilon for the same-lithology depth-overlap filter: a CPT geotech layer
# that starts within this distance of the CPT's litho-body extent boundary
# is still included (avoids dropping bands snapped to the extent edge).
_DEPTH_OVERLAP_EPS = _CLAMP_GUARD

# FillBand.source → litho_layer.confidence. Both conservative fallback sources
# (body_min, absolute_min) map to 'low': they are engineer-acknowledged
# estimates with no CPT data at that borehole, not CPT-anchored values. The
# full 3-tier provenance lives on FillBand.source and (Task 4) on the sample;
# 'confidence' is a confidence rating, not a provenance ledger.
_BOREHOLE_CONFIDENCE_MAP: dict[str, str] = {
    "cpt_interpolated": "high",
    "body_min": "low",
    "absolute_min": "low",
}


@dataclass(frozen=True)
class DivideBoreholeResult:
    """Result of :class:`DivideBoreholes`.

    Parameters
    ----------
    geotech_model_id : UUID
        The geotech model that was updated.
    divided_borehole_count : int
        Number of borehole columns that received ≥ 2 packing bands from
        ``fill_borehole_litho_body_extent``.
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
    """Fill borehole columns in an existing geotech model, litho-confined.

    For each borehole, for each litho body it belongs to: reads the CPT
    geotech layers already in the geotech model (written by SAB), restricts
    them to the CPT's own litho-body extent (same-lithology clip), TIN-
    interpolates the packing transitions at the borehole XY, and fills the
    borehole's litho-body extent using
    :func:`~groundmodel.domain.services.borehole_packing_fill.fill_borehole_litho_body_extent`.
    Gaps in CPT coverage are filled conservatively with ``body_min`` or
    ``absolute_min`` bands.

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
        """Materialise litho-confined borehole bands for *litho_model_id*.

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
        # body_id is included so each CPT band's geotech connected-component
        # identity is available for borehole band assignment (Task B).  SAB
        # runs ResolveLithoInstances (Phase 10) before committing, so every
        # CPT band already has its body_id stamped when DivideBoreholes reads it.
        cpt_layer_rows = (
            await self._session.execute(
                select(
                    LithoLayerOrm.cpt_id,
                    LithoLayerOrm.depth_top_m,
                    LithoLayerOrm.depth_base_m,
                    LithoLayerOrm.id,
                    LithoLayerOrm.formation_id,
                    GeologicalFormationOrm.nad_class,
                    LithoLayerOrm.body_id,
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
        if len(cpt_layer_rows) == 0:
            self.warning(
                "DivideBoreholes: 0 CPT geotech layers in model — every borehole band will fall "
                "to the conservative litho-floor (absolute_min) fallback with no geotech body_id. "
                "Run SubdivideAllBodies first."
            )

        # geotech_layer_by_inv_depth: ALL geotech layers for every CPT across
        # ALL body groups.  6-tuple: (top, base, layer_id, formation_id,
        # nad_class, geotech_body_id).  The litho-confined filter (see
        # _materialise_borehole_bands_litho_confined) restricts each CPT's
        # contribution to the depth range of the CPT's litho-body extent for
        # the current group.  geotech_body_id is the resolver-stamped body_id
        # from SAB, used by assign_borehole_band_body to pick the correct
        # geotech body for each borehole fill band.
        geotech_layer_by_inv_depth: dict[
            str, list[tuple[float, float, UUID, UUID, int | None, UUID | None]]
        ] = defaultdict(list)
        for row in cpt_layer_rows:
            inv_str = str(row.cpt_id)
            geotech_layer_by_inv_depth[inv_str].append(
                (
                    row.depth_top_m,
                    row.depth_base_m,
                    row.id,
                    row.formation_id,
                    row.nad_class,
                    row.body_id,
                )
            )

        # CPT XY lookup — needed to build ColumnXY for TIN interpolation.
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
        deleted = (
            await self._session.execute(
                delete(LithoLayerOrm).where(
                    LithoLayerOrm.model_id == geotech_model.id,
                    LithoLayerOrm.borehole_id.is_not(None),
                )
            )
        ).rowcount
        self.info(f"DivideBoreholes: deleted {deleted} prior borehole geotech layer(s)")

        # Phase 8 — litho-confined borehole fill per body group.
        classified_by_key: dict[tuple[int, UUID, UUID | None], GeologicalFormationOrm] = {}
        skeleton_by_key: dict[tuple[UUID, UUID | None], GeologicalFormationOrm] = {}
        created_formation_ids: list[UUID] = []
        total_layers = 0
        divided_borehole_count = 0
        single_band_borehole_count = 0
        # borehole_fill_bands: accumulates Band objects per borehole across ALL
        # body groups so Phase 9 (sample assignment) has the complete picture for
        # each borehole even when it spans multiple litho bodies.
        borehole_fill_bands: dict[str, list[Band]] = defaultdict(list)

        for (body_id_str, source_geo_fid), group_segs in groups.items():
            source_litho_fid = UUID(group_segs[0].formation_id) if group_segs else uuid7()

            borehole_segs = [
                s for s in group_segs if anchor_kind.get(s.investigation_id) == "borehole"
            ]
            if not borehole_segs:
                continue

            cpt_segs = [s for s in group_segs if anchor_kind.get(s.investigation_id) == "cpt"]

            # Load borehole XY.
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

            # Load the litho formation's soil code once per group (drives the
            # absolute-min fallback and is cached in SQLAlchemy's identity map).
            source_litho_orm = await self._session.get(GeologicalFormationOrm, source_litho_fid)
            soil_code: str | None = (
                source_litho_orm.litho_main_soil_code if source_litho_orm is not None else None
            )
            litho_abs_min_class = LITHO_ABSOLUTE_MIN_NAD.get(soil_code or "")
            if litho_abs_min_class is None:
                # Cannot determine the lithology floor for an unknown soil code.
                # SKIP this group's borehole fill rather than default to a
                # specific lithology (a ZAND-5 floor stamped on a KLEI/VEEN body
                # would violate the very litho-class invariant this fill enforces
                # — Data Integrity Rule 3). Real DOV formations always carry one
                # of the five families; this guards a malformed/manual formation.
                self.warning(
                    f"DivideBoreholes: formation {source_litho_fid} has "
                    f"soil_code={soil_code!r} not in LITHO_ABSOLUTE_MIN_NAD — "
                    "skipping this group's borehole fill (no lithology floor)"
                )
                continue

            self.debug(
                f"DivideBoreholes: group body={body_id_str} "
                f"soil={soil_code} abs_min_nad={litho_abs_min_class} "
                f"borehole_segs={len(borehole_segs)} cpt_segs={len(cpt_segs)}"
            )

            for bh_seg in borehole_segs:
                inv_id = bh_seg.investigation_id
                inv_uuid = UUID(inv_id)
                _bh_xy_lookup = bh_xy.get(inv_uuid)
                if _bh_xy_lookup is None:
                    self.warning(
                        f"DivideBoreholes: borehole={inv_id} has no XY location in DB — "
                        "defaulting to (0,0,0); TIN interpolation and body assignment will be wrong"
                    )
                bh_x, bh_y, bh_elev = (
                    _bh_xy_lookup if _bh_xy_lookup is not None else (0.0, 0.0, 0.0)
                )
                geo_top = bh_seg.top_depth_m
                geo_base = bh_seg.base_depth_m
                if geo_base <= geo_top:
                    continue

                (
                    n_bands,
                    fill_band_list,
                    fill_band_body_ids,
                ) = await self._materialise_borehole_bands_litho_confined(
                    project_id=project_id,
                    geotech_model_id=geotech_model.id,
                    inv_id=inv_id,
                    inv_uuid=inv_uuid,
                    bh_x=bh_x,
                    bh_y=bh_y,
                    bh_surface_elev=bh_elev,
                    geo_top_m=geo_top,
                    geo_base_m=geo_base,
                    cpt_segs=cpt_segs,
                    source_litho_formation_id=source_litho_fid,
                    source_geo_formation_id=source_geo_fid,
                    litho_abs_min_class=litho_abs_min_class,
                    classified_by_key=classified_by_key,
                    skeleton_by_key=skeleton_by_key,
                    created_formation_ids=created_formation_ids,
                    geotech_layer_by_inv_depth=geotech_layer_by_inv_depth,
                    cpt_xy=cpt_xy,
                )
                total_layers += n_bands
                if n_bands >= 2:
                    divided_borehole_count += 1
                else:
                    single_band_borehole_count += 1
                # Accumulate Band objects for Phase 9 (sample assignment).
                # fill_band_body_ids[k] is the GEOTECH packing body_id for
                # fill_band_list[k] — the resolver-connected body the borehole
                # band joins, determined by nearest-same-class CPT proximity.
                # None when the band is a body_min/absolute_min fallback with
                # no same-class CPT evidence in the group.
                for fb, geotech_body_id in zip(fill_band_list, fill_band_body_ids):
                    borehole_fill_bands[inv_id].append(
                        Band(
                            top=fb.top,
                            base=fb.base,
                            body_id=str(geotech_body_id) if geotech_body_id is not None else None,
                            nad_class=fb.nad_class,
                            source=fb.source,
                        )
                    )

        # Phase 9 — assign samples to geotech bands.
        # For each borehole that received bands, load its samples and stamp the
        # three geotech assignment columns using the midpoint lookup.
        all_bh_ids = {UUID(inv_id) for inv_id in borehole_fill_bands}
        if all_bh_ids:
            self.info(
                f"DivideBoreholes: Phase 9 — assigning samples for {len(all_bh_ids)} borehole(s)"
            )
            sample_rows = (
                (
                    await self._session.execute(
                        select(SampleOrm).where(SampleOrm.borehole_id.in_(all_bh_ids))
                    )
                )
                .scalars()
                .all()
            )

            assigned = 0
            fallback_no_body = 0  # matched a band, but body_id None (no same-class CPT)
            unresolved = 0
            total = len(sample_rows)
            for i, sample in enumerate(sample_rows, 1):
                inv_id_str = str(sample.borehole_id)
                bands_for_bh = borehole_fill_bands.get(inv_id_str, [])
                body_id, nad_class, source = assign_sample_to_band(
                    sample.depth_top_m,
                    sample.depth_base_m,
                    bands_for_bh,
                )
                sample.geotech_body_id = UUID(body_id) if body_id else None
                sample.geotech_nad_class = nad_class
                sample.geotech_assignment_source = source
                # source != "unresolved" means a band WAS matched (nad_class +
                # source persisted), even when body_id is None for a conservative
                # body_min / absolute_min fallback band — those are not failures.
                if source != "unresolved":
                    assigned += 1
                    if body_id is None:
                        fallback_no_body += 1
                else:
                    unresolved += 1
                    # Midpoint fell outside every litho-body extent on this
                    # borehole — log it so the gap is diagnosable without a re-run.
                    self.debug(
                        f"[{i}/{total}] sample {sample.id} "
                        f"depth=[{sample.depth_top_m},{sample.depth_base_m}]: "
                        f"unresolved (borehole has {len(bands_for_bh)} band(s))"
                    )
            self.info(
                f"DivideBoreholes: sample assignment assigned={assigned} "
                f"(fallback_no_body={fallback_no_body}) unresolved={unresolved}"
            )

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

    # ------------------------------------------------------------------
    # Litho-confined borehole materialisation
    # ------------------------------------------------------------------

    async def _materialise_borehole_bands_litho_confined(
        self,
        *,
        project_id: UUID,
        geotech_model_id: UUID,
        inv_id: str,
        inv_uuid: UUID,
        bh_x: float,
        bh_y: float,
        bh_surface_elev: float,
        geo_top_m: float,
        geo_base_m: float,
        cpt_segs: list[BodyLayerPick],
        source_litho_formation_id: UUID,
        source_geo_formation_id: UUID | None,
        litho_abs_min_class: int,
        classified_by_key: dict[tuple[int, UUID, UUID | None], GeologicalFormationOrm],
        skeleton_by_key: dict[tuple[UUID, UUID | None], GeologicalFormationOrm],
        created_formation_ids: list[UUID],
        geotech_layer_by_inv_depth: dict[
            str, list[tuple[float, float, UUID, UUID, int | None, UUID | None]]
        ],
        cpt_xy: dict[UUID, tuple[float, float, float]],
    ) -> tuple[int, list[FillBand], list[UUID | None]]:
        """Fill one borehole's litho-body extent with litho-confined CPT packing.

        For each CPT segment in the body group, restricts the CPT's geotech
        layers to those that fall within the CPT's own litho-body extent
        (``[cpt_seg.top_depth_m, cpt_seg.base_depth_m]``).  Only those
        same-depth bands drive the packing transition surfaces.  Gaps in
        coverage are filled conservatively via
        :func:`~groundmodel.domain.services.borehole_packing_fill.fill_borehole_litho_body_extent`.

        Parameters
        ----------
        project_id : UUID
            Owning project.
        geotech_model_id : UUID
            Geotech model to write into.
        inv_id : str
            Borehole id string.
        inv_uuid : UUID
            Borehole id as UUID.
        bh_x : float
            Borehole world x-coordinate (m).
        bh_y : float
            Borehole world y-coordinate (m).
        bh_surface_elev : float
            Borehole surface elevation (m, positive upward).
        geo_top_m : float
            Top of the litho-body extent on this borehole (m).
        geo_base_m : float
            Base of the litho-body extent on this borehole (m).
        cpt_segs : list[BodyLayerPick]
            CPT body-layer picks in this group, each carrying the CPT's own
            litho extent (``top_depth_m``, ``base_depth_m``).
        source_litho_formation_id : UUID
            Litho formation driving the find-or-create key.
        source_geo_formation_id : UUID | None
            Geo formation driving the find-or-create key.
        litho_abs_min_class : int
            Absolute weakest NAD class for the lithology family (from
            ``LITHO_ABSOLUTE_MIN_NAD[soil_code]``).
        classified_by_key : dict
            In-memory find-or-create cache for classified formations (mutated).
        skeleton_by_key : dict
            In-memory find-or-create cache for skeleton formations (mutated).
        created_formation_ids : list[UUID]
            Accumulator of classified formation ids created (mutated).
        geotech_layer_by_inv_depth : dict
            ALL CPT geotech layers keyed by investigation id string.
        cpt_xy : dict[UUID, tuple[float, float, float]]
            XY coordinates of CPTs keyed by id.

        Returns
        -------
        tuple[int, list[FillBand], list[UUID | None]]
            ``(count, fill_bands, fill_band_body_ids)`` — count of
            ``LithoLayerOrm`` rows inserted, the corresponding ``FillBand``
            objects (the caller builds ``assign_sample_to_band.Band`` objects
            from these for the Phase 9 sample assignment), and the per-band
            geotech body_id list (parallel to ``fill_bands``; ``None`` for
            conservative fallback bands with no same-class CPT evidence).
        """
        bh_col = ColumnXY(investigation_id=inv_id, x_m=bh_x, y_m=bh_y)

        # -------------------------------------------------------------------
        # Step 1: for each CPT in this body group, collect its geotech layers
        # that are WITHIN the CPT's own litho-body extent for this group.
        # This is the same-lithology filter: a CPT that has ZAND 0–4 m and
        # KLEI 4–8 m contributes its geotech bands for ZAND [0,4] only (not
        # the KLEI ones) when the body group is the ZAND body.
        # -------------------------------------------------------------------
        # filtered_cpt_layers: inv_id_str -> list[(top, base, lid, fid, nc, body_id)]
        filtered_cpt_layers: dict[
            str, list[tuple[float, float, UUID, UUID, int | None, UUID | None]]
        ] = {}
        for cpt_seg in cpt_segs:
            cpt_inv = cpt_seg.investigation_id
            seg_top = cpt_seg.top_depth_m
            seg_base = cpt_seg.base_depth_m
            in_extent = [
                entry
                for entry in geotech_layer_by_inv_depth.get(cpt_inv, [])
                # Keep layers whose depth range overlaps [seg_top, seg_base].
                if entry[0] >= seg_top - _DEPTH_OVERLAP_EPS
                and entry[1] <= seg_base + _DEPTH_OVERLAP_EPS
            ]
            if in_extent:
                if cpt_inv not in filtered_cpt_layers:
                    filtered_cpt_layers[cpt_inv] = []
                filtered_cpt_layers[cpt_inv].extend(in_extent)

        # -------------------------------------------------------------------
        # Step 2: build packing transition surfaces from the filtered layers.
        # transition_surfaces[k] = list of (ColumnXY, base_elevation_m) for
        # CPTs that have a k-th band boundary within their litho extent.
        # -------------------------------------------------------------------
        transition_surfaces: list[list[tuple[ColumnXY, float]]] = []
        for cpt_seg in cpt_segs:
            cpt_inv = cpt_seg.investigation_id
            layers_for_inv = sorted(
                filtered_cpt_layers.get(cpt_inv, []),
                key=lambda t: t[0],
            )
            if not layers_for_inv:
                continue
            _cpt_xy_lookup = cpt_xy.get(UUID(cpt_inv))
            if _cpt_xy_lookup is None:
                self.warning(
                    f"DivideBoreholes: CPT={cpt_inv} has no XY location — "
                    "defaulting to (0,0,0); transition surface TIN will be wrong"
                )
            x_m, y_m, surface_elev = (
                _cpt_xy_lookup if _cpt_xy_lookup is not None else (0.0, 0.0, 0.0)
            )
            col_xy = ColumnXY(investigation_id=cpt_inv, x_m=x_m, y_m=y_m)
            for k, (top_m, base_m, _lid, _fid, _nc, _bid) in enumerate(layers_for_inv):
                if k < len(layers_for_inv) - 1:
                    base_elev = surface_elev - base_m
                    while len(transition_surfaces) <= k:
                        transition_surfaces.append([])
                    transition_surfaces[k].append((col_xy, base_elev))

        # -------------------------------------------------------------------
        # Step 3: TIN-interpolate each transition surface at the borehole XY.
        # -------------------------------------------------------------------
        split_depths: list[float] = []
        for ctrl_pts in transition_surfaces:
            if not ctrl_pts:
                continue
            cpt_points = [c for c, _ in ctrl_pts]
            cpt_elevs = [e for _, e in ctrl_pts]
            elev_at_bh = interpolate_split_elevations(cpt_points, cpt_elevs, [bh_col])
            split_elev = elev_at_bh[inv_id]
            split_depth = bh_surface_elev - split_elev
            split_depth = max(geo_top_m + _CLAMP_GUARD, min(geo_base_m - _CLAMP_GUARD, split_depth))
            split_depths.append(split_depth)

        # Deduplicate, sort, drop zero-thickness splits.
        split_depths = sorted(set(split_depths))
        filtered_splits: list[float] = []
        prev = geo_top_m
        for sd in split_depths:
            if sd - prev > _CLAMP_GUARD and geo_base_m - sd > _CLAMP_GUARD:
                filtered_splits.append(sd)
                prev = sd
        split_depths = filtered_splits

        # Build band intervals from split depths.
        band_intervals: list[tuple[float, float]] = []
        prev_top = geo_top_m
        for sd in split_depths:
            band_intervals.append((prev_top, sd))
            prev_top = sd
        band_intervals.append((prev_top, geo_base_m))

        # -------------------------------------------------------------------
        # Step 4: compute modal NAD class per band from the filtered layers.
        # Bands where no CPT data covers the midpoint get nad_class=None and
        # are EXCLUDED from cpt_packing_surfaces (they become gaps that the
        # fill helper covers conservatively).
        # -------------------------------------------------------------------
        def _modal_nad_class_filtered(band_top: float, band_base: float) -> int | None:
            """Return the modal NAD class from same-lithology CPT layers."""
            mid = (band_top + band_base) / 2.0
            counts: dict[int, int] = {}
            for layers in filtered_cpt_layers.values():
                for t, b, _lid, _fid, nc, _bid in layers:
                    if t <= mid <= b and nc is not None:
                        counts[nc] = counts.get(nc, 0) + 1
            if not counts:
                return None
            return max(counts, key=lambda c: counts[c])

        cpt_packing_surfaces: list[tuple[float, float, int]] = []
        for band_top, band_base in band_intervals:
            nc = _modal_nad_class_filtered(band_top, band_base)
            if nc is not None:
                cpt_packing_surfaces.append((band_top, band_base, nc))

        # -------------------------------------------------------------------
        # Step 5: compute body_min_class = weakest NAD class across all
        # same-lithology CPT bands in this group.
        # -------------------------------------------------------------------
        all_classes = [
            nc
            for layers in filtered_cpt_layers.values()
            for (_t, _b, _lid, _fid, nc, _bid) in layers
            if nc is not None
        ]
        body_min_class: int | None = min(all_classes) if all_classes else None

        self.debug(
            f"_materialise_borehole_bands_litho_confined: borehole={inv_id} "
            f"geo=[{geo_top_m:.2f},{geo_base_m:.2f}] "
            f"cpt_packing_surfaces={len(cpt_packing_surfaces)} "
            f"body_min={body_min_class} abs_min={litho_abs_min_class}"
        )

        # -------------------------------------------------------------------
        # Step 6: call the pure helper to produce litho-confined fill bands.
        # -------------------------------------------------------------------
        fill_bands = fill_borehole_litho_body_extent(
            extent_top=geo_top_m,
            extent_base=geo_base_m,
            cpt_packing_surfaces=cpt_packing_surfaces,
            body_min_class=body_min_class,
            litho_abs_min_class=litho_abs_min_class,
        )

        # -------------------------------------------------------------------
        # Step 6.5: build CptBandRef list for geotech body_id assignment.
        # One entry per (CPT, band) pair in filtered_cpt_layers — the resolver
        # already stamped body_id on each CPT geotech layer during SAB Phase 10
        # (ResolveLithoInstances), so the 6th tuple element carries it.
        # -------------------------------------------------------------------
        cpt_band_refs: list[CptBandRef] = []
        for cpt_inv_str, layers in filtered_cpt_layers.items():
            cpt_inv_uuid = UUID(cpt_inv_str)
            _cpt_band_xy = cpt_xy.get(cpt_inv_uuid)
            if _cpt_band_xy is None:
                self.warning(
                    f"DivideBoreholes: CPT={cpt_inv_str} has no XY location for body assignment — "
                    "defaulting to (0,0,0); nearest-CPT body_id selection will be wrong"
                )
            x_m, y_m, _surf = _cpt_band_xy if _cpt_band_xy is not None else (0.0, 0.0, 0.0)
            for _t, _b, _lid, _fid, nc, bid in layers:
                if nc is not None:
                    cpt_band_refs.append(
                        CptBandRef(cpt_x=x_m, cpt_y=y_m, nad_class=nc, body_id=bid)
                    )

        # -------------------------------------------------------------------
        # Step 7: persist each FillBand as a LithoLayerOrm row.
        # Confidence: cpt_interpolated → high; body_min / absolute_min → low
        # (see _BOREHOLE_CONFIDENCE_MAP at module level).
        # -------------------------------------------------------------------
        fill_band_body_ids: list[UUID | None] = []
        inserted = 0
        for fb in fill_bands:
            # All FillBand.nad_class values are concrete (no None) — the
            # helper always emits the weakest observed class or the absolute
            # minimum, never a None sentinel.  Route every band through
            # _find_or_create_classified (not the skeleton branch).
            nad_class = fb.nad_class
            formation = await self._find_or_create_formation(
                project_id=project_id,
                classified_by_key=classified_by_key,
                skeleton_by_key=skeleton_by_key,
                created_formation_ids=created_formation_ids,
                nad_class=nad_class,
                source_litho_formation_id=source_litho_formation_id,
                source_geo_formation_id=source_geo_formation_id,
            )
            # Assign the geotech packing body_id: nearest same-class CPT in
            # the group.  None for conservative fallbacks that have no
            # same-class CPT evidence (body_min / absolute_min).
            geotech_body_id = assign_borehole_band_body(
                band_nad_class=nad_class,
                borehole_x=bh_x,
                borehole_y=bh_y,
                cpt_bands_in_group=cpt_band_refs,
            )
            layer = LithoLayerOrm(
                id=uuid7(),
                model_id=geotech_model_id,
                formation_id=formation.id,
                depth_top_m=fb.top,
                depth_base_m=fb.base,
                status="accepted",
                source="segmenter",
                confidence=_BOREHOLE_CONFIDENCE_MAP.get(fb.source, "low"),
                borehole_id=inv_uuid,
                body_id=geotech_body_id,
            )
            self._session.add(layer)
            fill_band_body_ids.append(geotech_body_id)
            geotech_layer_by_inv_depth[inv_id].append(
                (fb.top, fb.base, layer.id, formation.id, nad_class, geotech_body_id)
            )
            inserted += 1

        if inserted >= 2:
            self.debug(
                f"_materialise_borehole_bands_litho_confined: borehole={inv_id} "
                f"filled {inserted} bands "
                f"(geo=[{geo_top_m:.2f},{geo_base_m:.2f}])"
            )
        else:
            self.debug(
                f"_materialise_borehole_bands_litho_confined: borehole={inv_id} "
                f"single band [{geo_top_m:.2f},{geo_base_m:.2f}] "
                f"(no same-lithology CPT data)"
            )

        return inserted, fill_bands, fill_band_body_ids
