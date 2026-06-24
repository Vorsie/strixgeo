"""Subdivide all lithostratigraphic bodies into geotech NAD sub-bodies (Task E3).

Geotechnical stage — Slice B (spec
``docs/superpowers/specs/2026-06-23-geotech-stage-slice-1-design.md`` §0.1).

``SubdivideAllBodies`` is the **classify-and-materialise** step that follows
``BuildGeotechModelFromLitho`` (Task C1).  It groups the geo-bounded litho
picks by ``(body_id, source_geo_formation_id)``, runs the A3 segmenter per
CPT member, applies the B-policy aggregator to decide consistent-split vs
one-class, interpolates split surfaces onto every column (CPTs + boreholes),
and **materialises real geotech spatial bodies** via ``litho_layer`` + edge
inserts so they render through the litho engine and are stable anchors for
the later Parameters stage.

What it persists (one transaction, single commit at the end)
------------------------------------------------------------
1. **``litho_layer`` rows** — one per geotech sub-body position per column
   in the geotech model, ``status='accepted'``, ``source='segmenter'``.  The
   LL→FC trigger auto-derives the matching ``formation_contact`` row for each
   accepted insert (SAB-8 / TRAP 2 guard: never write FC directly).

2. **``litho_contact_correlation_edge`` rows** — one per approved litho edge,
   mapped from the litho layer's depth to the geotech sub-layer covering that
   same depth on each investigation.  This faithfully inherits the litho
   body's connectivity so a body that banded in the litho view also bands in
   the geotech view (SAB-7 / TRAP 1 guard: depth-overlap mapping naturally
   connects same-depth sub-layers, never cross-class).
   All edges are ``user_approved=True``, ``source='manual'``.

3. **``BodyOrm`` rows** — created by ``ResolveLithoInstances`` from the above
   edges; ``litho_layer.body_id`` is stamped in the same step.

Idempotency on re-run
---------------------
Before writing new rows the use case deletes (within the corridor):
  1. Geotech ``litho_contact_correlation_edge`` rows.
  2. Geotech ``litho_layer`` rows (LL→FC trigger deletes their FC mirrors).
  3. Geotech ``BodyOrm`` rows.
Existing classified ``geological_formation`` rows are DB-backed find-or-create
(key = ``(nad_class, source_litho_formation_id, source_geo_formation_id)``)
so a re-run reuses them without duplication.

Edge derivation — depth-overlap mapping
----------------------------------------
For each approved litho ``litho_contact_correlation_edge`` (layer_A ↔ layer_B),
the depth of layer_A's top is looked up, and the geotech sub-layer on the same
investigation that contains that depth (``depth_top_m <= litho_top < depth_base_m``,
with a tolerance of 1 mm for exact-boundary cases) is selected as the geotech
edge endpoint.  Similarly for layer_B on investigation_B.  A geotech edge is
then emitted between those two geotech sub-layers (canonical a < b).

This approach:
- Produces ~1 geotech edge per litho edge (minus dedup when multiple litho
  layers map to the same geotech sub-layer pair).
- Preserves the TRAP 1 / SAB-7 over-merge guard: a litho edge at depth d maps
  to the geotech sub-layer covering d, which is always the same packing-class
  band at that depth — it can never bridge to a DIFFERENT packing-class sub-body
  unless the packing-class boundary itself is located at exactly depth d, in
  which case the edge maps to the deeper sub-layer (the band above the split).
- Is section- and group-independent: it works in a single post-materialisation
  pass over all approved litho edges, regardless of body group boundaries.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.build_geotech_model_from_litho import (
    BuildGeotechModelFromLitho,
    _GeoSurface,
)
from groundmodel.application.project_investigations_onto_section import (
    project_investigations_onto_section,
)
from groundmodel.application.resolve_litho_instances_use_case import ResolveLithoInstances
from groundmodel.application.scope_guard import load_scoped_or_raise
from groundmodel.domain.services.geotech_body_aggregation import (
    BandProfile,
    BodySubdivisionPlan,
    plan_body_subdivision,
)
from groundmodel.domain.services.geotech_split_surface import ColumnXY, interpolate_split_elevations
from groundmodel.domain.services.geotech_subdivision import (
    suggest_geotech_subdivision,
)
from groundmodel.domain.services.litho_body_pick import BodyLayerPick
from groundmodel.domain.services.litho_geo_bounding import (
    divide_picks_by_geology,
    mark_and_truncate_shallow_tests,
)
from groundmodel.domain.value_objects.admixture import Admixture
from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cpt_series_orm import CptSeriesOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.repositories.litho_layer_repository import LithoLayerRepository
from groundmodel.infrastructure.db.repositories.project_repository import ProjectRepository
from groundmodel.shared.constants.litho_constants import BASE_LITHOLOGIES
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# Minimum geotech sub-unit thickness when the view-state knob is absent.
# Matches ``SuggestGeotechSubdivision._DEFAULT_MIN_THICKNESS_M``.
_DEFAULT_MIN_THICKNESS_M: float = 0.30


@dataclass(frozen=True)
class SubdivideAllBodiesResult:
    """Return value of :meth:`SubdivideAllBodies.execute`.

    Attributes
    ----------
    geotech_model_id : UUID
        The geotechnical model used (created or reused).
    created_formation_ids : list[UUID]
        Classified geotech ``geological_formation`` rows created in this call.
    layer_count : int
        Total ``litho_layer`` rows inserted into the geotech model.
    body_count : int
        Total ``BodyOrm`` rows created after resolution.
    split_body_count : int
        Number of body groups that received a consistent multi-band split
        (``plan.consistent and len(plan.band_classes) > 1``).
    one_class_body_count : int
        Number of body groups assigned one representative NAD class
        (inconsistent CPT profiles → thickness-dominant single class).
    borehole_only_count : int
        Number of body groups that were borehole-only (no CPT qc → one
        skeleton sub-body with ``nad_class=None``).
    """

    geotech_model_id: UUID
    created_formation_ids: list[UUID]
    layer_count: int
    body_count: int
    split_body_count: int
    one_class_body_count: int
    borehole_only_count: int


# ---------------------------------------------------------------------------
# Internal data holders (not domain DTOs — private to this module)
# ---------------------------------------------------------------------------


@dataclass
class _ColumnPlan:
    """Computed per-column sub-interval depths for one body group.

    Attributes
    ----------
    investigation_id : str
        CPT or borehole id.
    anchor_kind : str
        ``"cpt"`` or ``"borehole"``.
    geo_bounded_top_m : float
        Top of the geo-bounded extent (clamped floor for sub-intervals).
    geo_bounded_base_m : float
        Base of the geo-bounded extent (clamped ceiling for sub-intervals).
    sub_intervals : list[tuple[float, float]]
        ``(depth_top_m, depth_base_m)`` for each band position k, ordered
        top to bottom, already clamped to the geo-bounded extent.
    """

    investigation_id: str
    anchor_kind: str
    geo_bounded_top_m: float
    geo_bounded_base_m: float
    sub_intervals: list[tuple[float, float]] = field(default_factory=list)


class SubdivideAllBodies(GroundModelLogger):
    """Classify + materialise geotech spatial bodies for a section corridor.

    Runs after ``BuildGeotechModelFromLitho`` (C1) has ensured the geotech
    model exists. Does NOT assume C1 contacts exist — it works from the litho
    model's accepted layers + body resolver directly.

    The caller owns the session; this use case flushes during the write phase
    and commits once at the end.

    Parameters
    ----------
    session : AsyncSession
        Active SQLAlchemy async session.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session
        self._litho_repo = LithoLayerRepository(session)
        # Delegate geo-surface loading + geo-bounding helpers to C1's class
        # (they are private but the module is a sibling, so we instantiate C1
        # for its helper methods without calling its execute()).  This is the
        # minimum code-reuse that avoids duplicating the geo-surface logic.
        self._c1 = BuildGeotechModelFromLitho(session)

    async def execute(
        self,
        *,
        project_id: UUID,
        litho_model_id: UUID,
        section_id: UUID,
    ) -> SubdivideAllBodiesResult:
        """Subdivide all in-corridor bodies and materialise geotech spatial bodies.

        Parameters
        ----------
        project_id : UUID
            Project scope guard — the litho model + section must both belong to
            this project.
        litho_model_id : UUID
            The lithostratigraphic model to subdivide.  Must be
            ``kind='lithostratigraphic'``.
        section_id : UUID
            The cross-section whose in-corridor investigations are subdivided.

        Returns
        -------
        SubdivideAllBodiesResult
            Geotech model id + per-phase counts.

        Raises
        ------
        ValueError
            When the litho model is missing / out of project, or the section
            is not in the project.
        """
        self.info(f"SubdivideAllBodies: litho_model={litho_model_id} section={section_id}")

        litho_model = await load_scoped_or_raise(
            self._session,
            GeologicalModelOrm,
            litho_model_id,
            project_id,
            label="Litho model",
        )

        # Phase 1 — ensure the geotech model + resolve litho body_id stamps.
        geotech_model, _ = await self._c1._ensure_geotech_model(litho_model)
        await ResolveLithoInstances(self._session).execute(model_id=litho_model_id, commit=False)
        self.info(f"SubdivideAllBodies: geotech_model={geotech_model.id} (litho bodies resolved)")

        # Phase 2 — load section-scoped picks with body_id.
        in_corridor = await project_investigations_onto_section(
            self._session, project_id=project_id, section_id=section_id
        )
        picks = await self._litho_repo.load_body_picks(
            litho_model_id,
            restrict_to_investigation_ids=set(in_corridor.keys()),
        )
        self.info(
            f"SubdivideAllBodies: {len(picks)} pick(s) over "
            f"{len(in_corridor)} in-corridor investigation(s)"
        )
        if not picks:
            await self._session.commit()
            self.warning(
                "SubdivideAllBodies: no in-corridor picks — geotech model "
                "created/reused but no bodies materialised"
            )
            return SubdivideAllBodiesResult(
                geotech_model_id=geotech_model.id,
                created_formation_ids=[],
                layer_count=0,
                body_count=0,
                split_body_count=0,
                one_class_body_count=0,
                borehole_only_count=0,
            )

        # Phase 3 — geo-bound picks (same pipeline as C1).
        snap_tol = await self._c1._read_litho_snap_tolerance_m(litho_model_id)
        geo_surfaces = await self._c1._load_geo_surfaces_with_formation(
            litho_model.parent_geological_model_id
        )
        boundary_sampler = self._c1._make_boundary_sampler(geo_surfaces)
        lowest_sampler = self._c1._make_lowest_boundary_sampler(geo_surfaces)

        shallow = mark_and_truncate_shallow_tests(picks, lowest_sampler)
        if shallow.marked_investigation_ids:
            self.debug(
                f"SubdivideAllBodies: {len(shallow.marked_investigation_ids)} "
                "shallow test(s) marked"
            )
        divided = divide_picks_by_geology(shallow.picks, boundary_sampler, snap_tol)
        self.info(
            f"SubdivideAllBodies: {len(divided)} geo-bounded segment(s) (snap_tol={snap_tol} m)"
        )

        # Phase 4 — idempotent reset: delete prior geotech layers/edges/bodies
        # for the corridor's investigations under the geotech model.
        # Order: edges → layers (trigger deletes their FCs) → bodies.
        corridor_ids = list(in_corridor.keys())
        await self._delete_prior_geotech_data(geotech_model.id, corridor_ids)

        # Phase 5 — group geo-bounded segments by (body_id, source_geo_formation_id).
        # A BodyLayerPick carries body_id + formation_id from the litho layer;
        # source_geo_formation_id is derived from which geo band the segment sits in.
        groups = await self._group_segments(divided, geo_surfaces)
        self.info(f"SubdivideAllBodies: {len(groups)} body group(s) to process")

        # Phase 6 — anchor-kind lookup for the corridor.
        anchor_kind = await self._resolve_anchor_kinds(set(in_corridor.keys()))

        # Phase 7 — load CPT series + total depths + min_thickness.
        cpt_ids_in_corridor = {
            UUID(inv_id) for inv_id, kind in anchor_kind.items() if kind == "cpt"
        }
        cpt_series = await self._load_cpt_series(cpt_ids_in_corridor)
        total_depths = await self._load_total_depths(set(in_corridor.keys()))
        min_thickness_m = await self._read_min_thickness_m(geotech_model.app_project_id)
        self.debug(f"SubdivideAllBodies: min_thickness_m={min_thickness_m}")

        # Phase 8 — load the approved litho edges and litho layer depths needed
        # to derive geotech edges via depth-overlap mapping after materialisation.
        litho_approved_edges = await self._load_approved_litho_edges(litho_model_id, section_id)
        litho_layer_depths = await self._load_litho_layer_depths(
            litho_model_id, set(in_corridor.keys())
        )
        self.debug(
            f"SubdivideAllBodies: {len(litho_approved_edges)} approved litho edge(s), "
            f"{len(litho_layer_depths)} litho layer depth entries loaded"
        )

        # Phase 9 — per-group materialise.
        created_formation_ids: list[UUID] = []
        classified_by_key: dict[tuple[int, UUID, UUID | None], GeologicalFormationOrm] = {}
        skeleton_by_key: dict[tuple[UUID, UUID | None], GeologicalFormationOrm] = {}

        total_layers = 0
        split_body_count = 0
        one_class_body_count = 0
        borehole_only_count = 0

        # Global depth-indexed map built during materialisation: for each
        # investigation, the list of (depth_top_m, depth_base_m,
        # geotech_layer_id, geotech_formation_id) tuples for all created
        # geotech sub-layers on that investigation.  Consumed after the group
        # loop by _derive_geotech_edges_from_litho.
        #
        # formation_id is stored so the edge pass can apply the TRAP 1 / SAB-7
        # same-formation guard: only emit a geotech edge when both endpoints
        # resolve to the same formation_id.  Without this guard a litho edge
        # that crosses a geo-band boundary (the two investigations land in
        # different body groups with different source_geo_formation_id, and
        # therefore different geotech formations) would create a cross-class
        # edge that the resolver would wrongly merge.
        geotech_layer_by_inv_depth: dict[str, list[tuple[float, float, UUID, UUID]]] = defaultdict(
            list
        )

        for group_idx, (group_key, group_segs) in enumerate(groups.items()):
            body_id_str, source_geo_fid = group_key
            self.debug(
                f"[{group_idx + 1}/{len(groups)}] "
                f"SubdivideAllBodies: body={body_id_str} "
                f"geo_formation={source_geo_fid} "
                f"{len(group_segs)} segment(s)"
            )

            # Identify the litho formation for this group (all segs share one).
            source_litho_fid = UUID(group_segs[0].formation_id)

            # Collect CPT members of the group.
            cpt_segs = [s for s in group_segs if anchor_kind.get(s.investigation_id) == "cpt"]

            # Hoist formation attributes: they are constant for the whole group
            # (all segs share one source_litho_fid), so fetching them once per
            # group avoids N redundant DB round-trips (one per CPT member).
            soil_code = await self._formation_soil_code(source_litho_fid)
            admixtures = await self._formation_admixtures(source_litho_fid)

            # Build a BandProfile per CPT member.
            profiles: list[BandProfile] = []
            for seg in cpt_segs:
                series = cpt_series.get(UUID(seg.investigation_id))
                if series is None:
                    # CPT without a loaded series — treat as no-splits.
                    profiles.append(BandProfile(investigation_id=seg.investigation_id, splits=[]))
                    continue
                if soil_code is None or soil_code not in BASE_LITHOLOGIES:
                    profiles.append(BandProfile(investigation_id=seg.investigation_id, splits=[]))
                    continue
                splits = suggest_geotech_subdivision(
                    soil=soil_code,  # type: ignore[arg-type]
                    admixtures=admixtures,
                    depth_m=series.depths_m,
                    qc_mpa=series.qc_mpa,
                    segment_top_m=seg.top_depth_m,
                    segment_base_m=seg.base_depth_m,
                    min_thickness_m=min_thickness_m,
                )
                profiles.append(BandProfile(investigation_id=seg.investigation_id, splits=splits))

            plan = plan_body_subdivision(profiles)

            # Classify group outcome for reporting.
            if not cpt_segs:
                borehole_only_count += 1
            elif plan.consistent and len(plan.band_classes) > 1:
                split_body_count += 1
            else:
                one_class_body_count += 1

            n_bands = len(plan.band_classes)
            self.debug(
                f"[{group_idx + 1}/{len(groups)}] "
                f"consistent={plan.consistent} bands={n_bands} "
                f"classes={plan.band_classes}"
            )

            # Build a per-column plan: split depths for each investigation.
            column_plans = self._build_column_plans(
                group_segs=group_segs,
                anchor_kind=anchor_kind,
                plan=plan,
                profiles=profiles,
                geo_surfaces=geo_surfaces,
                total_depths=total_depths,
            )

            # Materialise litho_layer rows per column × band position.
            # Accumulate (depth_top_m, depth_base_m, geotech_layer_id) tuples
            # per investigation so the post-loop edge pass can map litho layer
            # depths to geotech sub-layer ids.
            for col_plan in column_plans:
                if not col_plan.sub_intervals:
                    continue
                inv_id = col_plan.investigation_id
                inv_uuid = UUID(inv_id)
                anchor_kwargs: dict[str, UUID] = {}
                if col_plan.anchor_kind == "borehole":
                    anchor_kwargs = {"borehole_id": inv_uuid}
                else:
                    anchor_kwargs = {"cpt_id": inv_uuid}

                for k, (top_m, base_m) in enumerate(col_plan.sub_intervals):
                    nad_class = plan.band_classes[k]
                    formation = await self._find_or_create_formation(
                        project_id=project_id,
                        classified_by_key=classified_by_key,
                        skeleton_by_key=skeleton_by_key,
                        created_formation_ids=created_formation_ids,
                        nad_class=nad_class,
                        source_litho_formation_id=source_litho_fid,
                        source_geo_formation_id=source_geo_fid,
                    )

                    layer = LithoLayerOrm(
                        id=uuid7(),
                        model_id=geotech_model.id,
                        formation_id=formation.id,
                        depth_top_m=top_m,
                        depth_base_m=base_m,
                        status="accepted",
                        source="segmenter",
                        confidence="medium",
                        **anchor_kwargs,
                    )
                    self._session.add(layer)
                    geotech_layer_by_inv_depth[inv_id].append(
                        (top_m, base_m, layer.id, formation.id)
                    )
                    total_layers += 1

            await self._session.flush()

        # Phase 9b — derive geotech edges from the full approved litho edge set
        # via depth-overlap mapping.  This runs AFTER all groups have been
        # materialised so every geotech sub-layer id is known.
        await self._derive_geotech_edges_from_litho(
            geotech_model_id=geotech_model.id,
            section_id=section_id,
            litho_approved_edges=litho_approved_edges,
            litho_layer_depths=litho_layer_depths,
            geotech_layer_by_inv_depth=geotech_layer_by_inv_depth,
        )

        # Phase 10 — run resolver: creates BodyOrm + stamps litho_layer.body_id.
        await ResolveLithoInstances(self._session).execute(model_id=geotech_model.id, commit=False)

        # Count bodies created for the geotech model.
        body_count = (
            (
                await self._session.execute(
                    select(BodyOrm).where(BodyOrm.model_id == geotech_model.id)
                )
            )
            .scalars()
            .all()
        )

        # Phase 11 — single commit.
        await self._session.commit()

        result = SubdivideAllBodiesResult(
            geotech_model_id=geotech_model.id,
            created_formation_ids=created_formation_ids,
            layer_count=total_layers,
            body_count=len(body_count),
            split_body_count=split_body_count,
            one_class_body_count=one_class_body_count,
            borehole_only_count=borehole_only_count,
        )
        self.success(
            f"SubdivideAllBodies: geotech_model={geotech_model.id} "
            f"layers={total_layers} bodies={result.body_count} "
            f"split={split_body_count} one_class={one_class_body_count} "
            f"borehole_only={borehole_only_count}"
        )
        return result

    # ------------------------------------------------------------------
    # Phase 4 — idempotent reset
    # ------------------------------------------------------------------

    async def _delete_prior_geotech_data(
        self, geotech_model_id: UUID, corridor_ids: list[UUID]
    ) -> None:
        """Delete prior geotech layers, edges, and bodies for the corridor.

        Order: edges first (FK to litho_layer CASCADE prevents reverse order),
        then layers (LL→FC trigger deletes their FC mirrors), then bodies.

        Parameters
        ----------
        geotech_model_id : UUID
            The geotechnical model to clean up.
        corridor_ids : list[UUID]
            In-corridor investigation ids scoping the delete.
        """
        if not corridor_ids:
            return

        # 1. Delete correlation edges for the geotech model on this section.
        # Edges are model-scoped but their endpoints (contact_a_id/contact_b_id)
        # reference litho_layer.id rows for the geotech model — delete all edges
        # for the model so a re-run starts fresh.  Section-scope is implicit
        # (edges can only be authored on the section they came from, and we're
        # operating section-by-section).
        geotech_layer_ids = (
            (
                await self._session.execute(
                    select(LithoLayerOrm.id).where(
                        LithoLayerOrm.model_id == geotech_model_id,
                        LithoLayerOrm.borehole_id.in_(corridor_ids)
                        | LithoLayerOrm.cpt_id.in_(corridor_ids),
                    )
                )
            )
            .scalars()
            .all()
        )
        if geotech_layer_ids:
            await self._session.execute(
                delete(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.model_id == geotech_model_id,
                    LithoContactCorrelationEdgeOrm.contact_a_id.in_(geotech_layer_ids)
                    | LithoContactCorrelationEdgeOrm.contact_b_id.in_(geotech_layer_ids),
                )
            )

        # 2. Delete layers (LL→FC trigger cleans up the FC mirrors).
        await self._session.execute(
            delete(LithoLayerOrm).where(
                LithoLayerOrm.model_id == geotech_model_id,
                LithoLayerOrm.borehole_id.in_(corridor_ids)
                | LithoLayerOrm.cpt_id.in_(corridor_ids),
            )
        )

        # 2b. Delete any remaining FormationContact rows for the geotech model
        # in the corridor.  BuildGeotechModelFromLitho (C1) writes FC rows
        # DIRECTLY (not via the LL→FC trigger), so the trigger-based cleanup in
        # step 2 does not remove them.  Without this step a subsequent SAB run
        # on the same section fires the LL→FC trigger which tries to INSERT the
        # same FC row → uq_formation_contact_model_formation_borehole_depth
        # violation.  Deleting all corridor FC rows here is safe: SAB does not
        # use C1's skeleton FC rows at all — it writes its own via the trigger.
        await self._session.execute(
            delete(FormationContactOrm).where(
                FormationContactOrm.model_id == geotech_model_id,
                FormationContactOrm.borehole_id.in_(corridor_ids)
                | FormationContactOrm.cpt_id.in_(corridor_ids),
            )
        )

        # 3. Delete BodyOrm rows for the geotech model.  After the layer delete
        # the resolver will recreate them; the bodies from the previous run must
        # be cleared first so we don't violate the (model, formation, ordinal)
        # uniqueness when the resolver tries to create the same key again.
        await self._session.execute(delete(BodyOrm).where(BodyOrm.model_id == geotech_model_id))

        await self._session.flush()
        self.debug(
            f"_delete_prior_geotech_data: cleared prior geotech data "
            f"for {len(corridor_ids)} corridor investigation(s)"
        )

    # ------------------------------------------------------------------
    # Phase 5 — grouping
    # ------------------------------------------------------------------

    async def _group_segments(
        self,
        divided: list[BodyLayerPick],
        geo_surfaces: list[_GeoSurface],
    ) -> dict[tuple[str, UUID | None], list[BodyLayerPick]]:
        """Group geo-bounded segments by ``(body_id, source_geo_formation_id)``.

        The body_id is already stamped on each pick (from the litho model's
        resolver run in Phase 1).  The source_geo_formation_id is derived by
        evaluating which geological band each segment sits within — the same
        ``_geo_formation_at_midpoint`` rule C1 uses.

        Parameters
        ----------
        divided : list[BodyLayerPick]
            Geo-bounded picks from ``divide_picks_by_geology``.
        geo_surfaces : list[_GeoSurface]
            Parent geology band surfaces.

        Returns
        -------
        dict[tuple[str, UUID | None], list[BodyLayerPick]]
            Keyed by ``(body_id_str, source_geo_formation_id)``.
        """
        groups: dict[tuple[str, UUID | None], list[BodyLayerPick]] = defaultdict(list)
        for seg in divided:
            geo_fid = self._c1._geo_formation_at_midpoint(seg, geo_surfaces)
            groups[(seg.body_id, geo_fid)].append(seg)
        return dict(groups)

    # ------------------------------------------------------------------
    # Phase 6 — column plan builder
    # ------------------------------------------------------------------

    def _build_column_plans(
        self,
        *,
        group_segs: list[BodyLayerPick],
        anchor_kind: dict[str, str],
        plan: BodySubdivisionPlan,
        profiles: list[BandProfile],
        geo_surfaces: list[_GeoSurface],
        total_depths: dict[UUID, float],
    ) -> list[_ColumnPlan]:
        """Build per-column sub-interval plans for one body group.

        For a multi-band consistent plan (``n > 1``), the interior split
        elevations are interpolated from the CPT control points onto every
        column.  For a one-band plan, each column gets a single sub-interval
        spanning its full geo-bounded extent.

        Parameters
        ----------
        group_segs : list[BodyLayerPick]
            All geo-bounded segment picks for the group (one per column in
            the group — some columns may have multiple picks if the body
            spans multiple geo bands, but those produce separate groups).
        anchor_kind : dict[str, str]
            ``investigation_id (str) -> "borehole" | "cpt"``.
        plan : BodySubdivisionPlan
            The B-policy aggregator's decision for this group.
        profiles : list[BandProfile]
            Per-CPT packing-band profiles.
        geo_surfaces : list[_GeoSurface]
            Parent geology surfaces (for surface elevation at each column).
        total_depths : dict[UUID, float]
            CPT / borehole total depths.

        Returns
        -------
        list[_ColumnPlan]
            One entry per column in the group.
        """
        n = len(plan.band_classes)
        profiles_by_inv = {p.investigation_id: p for p in profiles}
        col_plans: list[_ColumnPlan] = []

        if n == 1:
            # One band — each column spans its full geo-bounded extent.
            for seg in group_segs:
                col_plans.append(
                    _ColumnPlan(
                        investigation_id=seg.investigation_id,
                        anchor_kind=anchor_kind.get(seg.investigation_id, "borehole"),
                        geo_bounded_top_m=seg.top_depth_m,
                        geo_bounded_base_m=seg.base_depth_m,
                        sub_intervals=[(seg.top_depth_m, seg.base_depth_m)],
                    )
                )
            return col_plans

        # Multi-band — interpolate split elevations for each interior boundary
        # (positions 1..n-1).  The elevation of the split at position k on CPT i
        # is: surface_elev_m - splits[k].depth_top_m.
        all_columns = [
            ColumnXY(
                investigation_id=seg.investigation_id,
                x_m=seg.x_m,
                y_m=seg.y_m,
            )
            for seg in group_segs
        ]

        # Build depth→elevation split maps per column by interpolating each
        # interior boundary.
        # split_depth_by_inv[inv_id][k] = depth_m of split at position k
        split_depth_by_inv: dict[str, dict[int, float]] = defaultdict(dict)

        for k in range(1, n):
            # Collect CPT control points that read at least k splits.
            cpt_points: list[ColumnXY] = []
            cpt_elevations: list[float] = []
            for seg in group_segs:
                profile = profiles_by_inv.get(seg.investigation_id)
                if profile is None or len(profile.splits) < k:
                    continue
                split = profile.splits[k - 1]
                # The k-th split interior boundary is the TOP of band k.
                transition_elevation = seg.surface_elev_m - split.depth_base_m
                cpt_points.append(
                    ColumnXY(
                        investigation_id=seg.investigation_id,
                        x_m=seg.x_m,
                        y_m=seg.y_m,
                    )
                )
                cpt_elevations.append(transition_elevation)

            if not cpt_points:
                # No CPT data for this position — fall back to evenly dividing
                # the geo-bounded extent on each column.
                for seg in group_segs:
                    thickness = seg.base_depth_m - seg.top_depth_m
                    frac_depth = seg.top_depth_m + thickness * (k / n)
                    split_depth_by_inv[seg.investigation_id][k] = frac_depth
                continue

            elevation_map = interpolate_split_elevations(
                cpt_points=cpt_points,
                cpt_elevations=cpt_elevations,
                all_columns=all_columns,
            )
            for seg in group_segs:
                elev = elevation_map.get(seg.investigation_id)
                if elev is None:
                    continue
                split_depth = seg.surface_elev_m - elev
                split_depth_by_inv[seg.investigation_id][k] = split_depth

        # Assemble sub_intervals per column.
        for seg in group_segs:
            geo_top = seg.top_depth_m
            geo_base = seg.base_depth_m
            if geo_base <= geo_top:
                # Zero-thickness segment — skip.
                continue

            # Build ordered split depths within [geo_top, geo_base].
            raw_splits: list[float] = []
            for k in range(1, n):
                d = split_depth_by_inv[seg.investigation_id].get(k)
                if d is not None:
                    raw_splits.append(d)
            raw_splits.sort()

            # Clamp and deduplicate: each split must be strictly inside the
            # geo-bounded extent.  Splits outside or equal to boundaries are
            # dropped so the tiling always covers [geo_top, geo_base] exactly.
            valid_splits: list[float] = [d for d in raw_splits if geo_top < d < geo_base]

            # Build sub-intervals from the boundary list.
            boundaries = [geo_top] + valid_splits + [geo_base]
            sub_intervals = [
                (boundaries[i], boundaries[i + 1])
                for i in range(len(boundaries) - 1)
                if boundaries[i + 1] - boundaries[i] > 1e-6  # skip degenerate
            ]
            if not sub_intervals:
                # All splits landed outside the extent — fall back to one band.
                sub_intervals = [(geo_top, geo_base)]

            col_plans.append(
                _ColumnPlan(
                    investigation_id=seg.investigation_id,
                    anchor_kind=anchor_kind.get(seg.investigation_id, "borehole"),
                    geo_bounded_top_m=geo_top,
                    geo_bounded_base_m=geo_base,
                    sub_intervals=sub_intervals,
                )
            )

        return col_plans

    # ------------------------------------------------------------------
    # Phase 9b — edge derivation via depth-overlap mapping (TRAP 1 guard)
    # ------------------------------------------------------------------

    async def _derive_geotech_edges_from_litho(
        self,
        *,
        geotech_model_id: UUID,
        section_id: UUID,
        litho_approved_edges: set[tuple[UUID, UUID]],
        litho_layer_depths: dict[UUID, tuple[str, float, float]],
        geotech_layer_by_inv_depth: dict[str, list[tuple[float, float, UUID, UUID]]],
    ) -> None:
        """Derive geotech correlation edges by mapping each litho edge via depth overlap.

        For each approved litho edge ``(litho_layer_A_id, litho_layer_B_id)``:

        1. Look up each endpoint's investigation id and ``depth_top_m`` from
           ``litho_layer_depths``.
        2. Find the geotech sub-layer on that investigation whose
           ``[depth_top_m, depth_base_m)`` interval contains the litho layer's
           ``depth_top_m`` (within 1 mm tolerance for exact-boundary alignment
           after a geo-band divide).
        3. Emit a geotech edge between those two geotech sub-layers ONLY when
           they share the same ``formation_id`` (same NAD class / same packing
           band).  This is the TRAP 1 / SAB-7 same-class guard: a litho edge
           that crosses a geo-band boundary lands the two investigations in
           different body groups → different geotech formations → blocked here.
           Canonical ``a < b`` ordering; dedup on layer-pair.

        This produces ~1 geotech edge per litho edge (with dedup when multiple
        litho layers collapse to the same geotech sub-layer pair), faithfully
        inheriting the litho body's connectivity without cross-class edges.

        TRAP 1 / SAB-7 correctness proof: within one body group (same
        ``body_id`` + ``source_geo_formation_id``), all investigations receive
        the same B-policy ``plan.band_classes``, so same-depth geotech
        sub-layers on different investigations always share the same
        ``formation_id``.  A litho edge that crosses a geo-band boundary maps
        to sub-layers in DIFFERENT body groups, which have DIFFERENT
        ``formation_id`` values even at the same depth → filtered out by the
        same-formation check.

        Parameters
        ----------
        geotech_model_id : UUID
            The geotech model id for the edge rows.
        section_id : UUID
            Section id (NOT NULL on ``litho_contact_correlation_edge``).
        litho_approved_edges : set[tuple[UUID, UUID]]
            Canonical ``(min_id, max_id)`` pairs of approved litho edges.
        litho_layer_depths : dict[UUID, tuple[str, float, float]]
            ``litho_layer_id → (investigation_id_str, depth_top_m, depth_base_m)``
            for every accepted litho layer in the corridor.
        geotech_layer_by_inv_depth : dict[str, list[tuple[float, float, UUID, UUID]]]
            ``investigation_id_str →
            [(depth_top_m, depth_base_m, geotech_layer_id, geotech_formation_id)]``
            accumulated during materialisation (all geotech sub-layers, any order).
        """
        # Sort each investigation's geotech layers by depth_top_m once so the
        # depth lookup is a fast linear scan (most investigations have 1–3
        # sub-layers after subdivision).
        sorted_geotech: dict[str, list[tuple[float, float, UUID, UUID]]] = {
            inv_id: sorted(intervals, key=lambda t: t[0])
            for inv_id, intervals in geotech_layer_by_inv_depth.items()
        }

        # 1 mm tolerance: a geo-band divide can place a geotech layer's top at
        # the same floating-point value as the litho layer's depth_top_m minus
        # tiny rounding noise.
        _DEPTH_TOL_M = 0.001

        seen_layer_pairs: set[tuple[UUID, UUID]] = set()
        edge_count = 0
        skipped_no_litho_depth = 0
        skipped_no_geotech_layer = 0
        skipped_cross_formation = 0

        for litho_a_id, litho_b_id in litho_approved_edges:
            entry_a = litho_layer_depths.get(litho_a_id)
            entry_b = litho_layer_depths.get(litho_b_id)
            if entry_a is None or entry_b is None:
                # One or both endpoints are not in the corridor — skip.
                skipped_no_litho_depth += 1
                continue

            inv_a_str, top_a, _base_a = entry_a
            inv_b_str, top_b, _base_b = entry_b

            result_a = self._find_geotech_layer_at_depth(
                sorted_geotech.get(inv_a_str, []), top_a, _DEPTH_TOL_M
            )
            result_b = self._find_geotech_layer_at_depth(
                sorted_geotech.get(inv_b_str, []), top_b, _DEPTH_TOL_M
            )

            if result_a is None or result_b is None:
                # The litho layer's depth is outside the materialised geotech
                # range for that investigation (e.g. excluded from subdivision).
                skipped_no_geotech_layer += 1
                self.debug(
                    f"_derive_geotech_edges_from_litho: no geotech layer for "
                    f"litho edge ({litho_a_id}, {litho_b_id}) — "
                    f"inv_a={inv_a_str} top_a={top_a:.3f} → {result_a}, "
                    f"inv_b={inv_b_str} top_b={top_b:.3f} → {result_b}"
                )
                continue

            geotech_a_id, formation_a_id = result_a
            geotech_b_id, formation_b_id = result_b

            if geotech_a_id == geotech_b_id:
                # Same layer — would violate the contact_a_id != contact_b_id
                # CHECK constraint.  Can only happen if both endpoints map to the
                # same investigation, which would be an intra-investigation edge
                # (forbidden by the litho schema) — skip defensively.
                continue

            # TRAP 1 / SAB-7 guard: only connect same-formation sub-layers.
            # A cross-formation edge would bridge two DIFFERENT packing-class
            # sub-bodies, causing the resolver to merge them into one body.
            # Litho edges that cross geo-band boundaries land their endpoints in
            # different body groups (different source_geo_formation_id) whose
            # geotech sub-layers have different formation_ids — filtered here.
            if formation_a_id != formation_b_id:
                skipped_cross_formation += 1
                continue

            canonical_a, canonical_b = (
                (geotech_a_id, geotech_b_id)
                if geotech_a_id < geotech_b_id
                else (geotech_b_id, geotech_a_id)
            )
            if (canonical_a, canonical_b) in seen_layer_pairs:
                continue
            seen_layer_pairs.add((canonical_a, canonical_b))

            edge = LithoContactCorrelationEdgeOrm(
                id=uuid7(),
                model_id=geotech_model_id,
                section_id=section_id,
                contact_a_id=canonical_a,
                contact_b_id=canonical_b,
                contact_a_side="top",
                contact_b_side="top",
                source="manual",
                user_approved=True,
            )
            self._session.add(edge)
            edge_count += 1

        await self._session.flush()
        self.info(
            f"_derive_geotech_edges_from_litho: "
            f"{edge_count} geotech edge(s) derived from "
            f"{len(litho_approved_edges)} litho edge(s) "
            f"(skipped_no_depth={skipped_no_litho_depth}, "
            f"skipped_no_geotech={skipped_no_geotech_layer}, "
            f"skipped_cross_formation={skipped_cross_formation})"
        )

    @staticmethod
    def _find_geotech_layer_at_depth(
        sorted_intervals: list[tuple[float, float, UUID, UUID]],
        depth_top_m: float,
        tol_m: float,
    ) -> tuple[UUID, UUID] | None:
        """Find the geotech sub-layer whose interval contains ``depth_top_m``.

        Scans ``sorted_intervals`` (sorted by ``depth_top_m``) for the first
        interval ``[top, base)`` that contains the query depth.  A depth is
        considered contained when ``top - tol_m <= depth_top_m < base + tol_m``.
        Returns ``(geotech_layer_id, geotech_formation_id)``, or ``None``.

        The tolerance handles floating-point noise introduced by the geo-band
        divide pass (a segment top may be a few ULP away from the litho layer
        top that it was derived from).

        Parameters
        ----------
        sorted_intervals : list[tuple[float, float, UUID, UUID]]
            ``(depth_top_m, depth_base_m, geotech_layer_id, geotech_formation_id)``
            tuples for one investigation, sorted ascending by ``depth_top_m``.
        depth_top_m : float
            The litho layer top depth to find a geotech sub-layer for.
        tol_m : float
            Containment tolerance in metres (typically 0.001 = 1 mm).

        Returns
        -------
        tuple[UUID, UUID] | None
            ``(geotech_layer_id, geotech_formation_id)``, or ``None`` when not
            found.
        """
        for top, base, layer_id, formation_id in sorted_intervals:
            if top - tol_m <= depth_top_m < base + tol_m:
                return layer_id, formation_id
        return None

    # ------------------------------------------------------------------
    # Formation find-or-create (delegates to C2b's pattern)
    # ------------------------------------------------------------------

    async def _find_or_create_formation(
        self,
        *,
        project_id: UUID,
        classified_by_key: dict[tuple[int, UUID, UUID | None], GeologicalFormationOrm],
        skeleton_by_key: dict[tuple[UUID, UUID | None], GeologicalFormationOrm],
        created_formation_ids: list[UUID],
        nad_class: int | None,
        source_litho_formation_id: UUID,
        source_geo_formation_id: UUID | None,
    ) -> GeologicalFormationOrm:
        """Find-or-create the geotech formation for one sub-unit.

        Delegates to ``_find_or_create_classified`` for ``nad_class is not None``
        or to ``_find_or_create_skeleton`` for the borehole-only carry-through.

        Parameters
        ----------
        project_id : UUID
            Owning project.
        classified_by_key : dict
            In-memory cache for classified formations (mutated).
        skeleton_by_key : dict
            In-memory cache for skeleton formations (mutated).
        created_formation_ids : list[UUID]
            Accumulator of classified formation ids created (mutated).
        nad_class : int | None
            NAD packing class, or ``None`` for a borehole carry-through.
        source_litho_formation_id : UUID
            The litho formation this geotech unit subdivides.
        source_geo_formation_id : UUID | None
            The geological formation the unit sits within.

        Returns
        -------
        GeologicalFormationOrm
            The found-or-created formation row.
        """
        if nad_class is None:
            return await self._find_or_create_skeleton(
                project_id=project_id,
                skeleton_by_key=skeleton_by_key,
                source_litho_formation_id=source_litho_formation_id,
                source_geo_formation_id=source_geo_formation_id,
            )
        return await self._find_or_create_classified(
            project_id=project_id,
            classified_by_key=classified_by_key,
            created_formation_ids=created_formation_ids,
            nad_class=nad_class,
            source_litho_formation_id=source_litho_formation_id,
            source_geo_formation_id=source_geo_formation_id,
        )

    async def _find_or_create_classified(
        self,
        *,
        project_id: UUID,
        classified_by_key: dict[tuple[int, UUID, UUID | None], GeologicalFormationOrm],
        created_formation_ids: list[UUID],
        nad_class: int,
        source_litho_formation_id: UUID,
        source_geo_formation_id: UUID | None,
    ) -> GeologicalFormationOrm:
        """Find-or-create a classified geotech formation by the full triple.

        The triple ``(nad_class, source_litho_formation_id,
        source_geo_formation_id)`` is the stable find-or-create key shared
        with C2b's ``AcceptGeotechSuggestions._find_or_create_classified``.

        Parameters
        ----------
        project_id : UUID
            Owning project.
        classified_by_key : dict
            In-memory find-or-create cache (mutated).
        created_formation_ids : list[UUID]
            Accumulator of ids created in this call (mutated).
        nad_class : int
            The NAD packing class.
        source_litho_formation_id : UUID
            The litho formation this geotech unit subdivides.
        source_geo_formation_id : UUID | None
            The geological formation the unit sits within.

        Returns
        -------
        GeologicalFormationOrm
            The found-or-created classified formation row.
        """
        key = (nad_class, source_litho_formation_id, source_geo_formation_id)
        cached = classified_by_key.get(key)
        if cached is not None:
            return cached

        geo_filter = (
            GeologicalFormationOrm.source_geo_formation_id.is_(None)
            if source_geo_formation_id is None
            else GeologicalFormationOrm.source_geo_formation_id == source_geo_formation_id
        )
        db_row = (
            (
                await self._session.execute(
                    select(GeologicalFormationOrm).where(
                        GeologicalFormationOrm.app_project_id == project_id,
                        GeologicalFormationOrm.nad_class == nad_class,
                        GeologicalFormationOrm.source_litho_formation_id
                        == source_litho_formation_id,
                        geo_filter,
                    )
                )
            )
            .scalars()
            .first()
        )
        if db_row is not None:
            classified_by_key[key] = db_row
            self.debug(
                f"_find_or_create_classified: reused {db_row.id} "
                f"nad={nad_class} litho={source_litho_formation_id} "
                f"geo={source_geo_formation_id}"
            )
            return db_row

        source_litho = await self._session.get(GeologicalFormationOrm, source_litho_formation_id)
        soil_code = source_litho.litho_main_soil_code if source_litho is not None else None
        admixtures = source_litho.litho_admixtures if source_litho is not None else None
        color = source_litho.color if source_litho is not None else "#bbbbbb"
        base_name = source_litho.name if source_litho is not None else "geotech unit"
        display_order = source_litho.display_order if source_litho is not None else 0

        formation = GeologicalFormationOrm(
            id=uuid7(),
            app_project_id=project_id,
            name=f"{base_name} (NAD {nad_class})",
            color=color,
            display_order=display_order,
            nad_class=nad_class,
            litho_main_soil_code=soil_code,
            litho_admixtures=admixtures,
            source_litho_formation_id=source_litho_formation_id,
            source_geo_formation_id=source_geo_formation_id,
        )
        self._session.add(formation)
        await self._session.flush()
        classified_by_key[key] = formation
        created_formation_ids.append(formation.id)
        self.debug(
            f"_find_or_create_classified: created {formation.id} "
            f"nad={nad_class} soil={soil_code} "
            f"litho={source_litho_formation_id} geo={source_geo_formation_id}"
        )
        return formation

    async def _find_or_create_skeleton(
        self,
        *,
        project_id: UUID,
        skeleton_by_key: dict[tuple[UUID, UUID | None], GeologicalFormationOrm],
        source_litho_formation_id: UUID,
        source_geo_formation_id: UUID | None,
    ) -> GeologicalFormationOrm:
        """Find-or-create a skeleton (``nad_class=None``) formation for a carry-through.

        Used for borehole-only sub-bodies that cannot be NAD-classified.

        Parameters
        ----------
        project_id : UUID
            Owning project.
        skeleton_by_key : dict
            In-memory find-or-create cache (mutated).
        source_litho_formation_id : UUID
            The litho formation this geotech unit subdivides.
        source_geo_formation_id : UUID | None
            The geological formation the unit sits within.

        Returns
        -------
        GeologicalFormationOrm
            The found-or-created skeleton formation row.
        """
        key = (source_litho_formation_id, source_geo_formation_id)
        cached = skeleton_by_key.get(key)
        if cached is not None:
            return cached

        geo_filter = (
            GeologicalFormationOrm.source_geo_formation_id.is_(None)
            if source_geo_formation_id is None
            else GeologicalFormationOrm.source_geo_formation_id == source_geo_formation_id
        )
        db_row = (
            (
                await self._session.execute(
                    select(GeologicalFormationOrm).where(
                        GeologicalFormationOrm.app_project_id == project_id,
                        GeologicalFormationOrm.nad_class.is_(None),
                        GeologicalFormationOrm.source_litho_formation_id
                        == source_litho_formation_id,
                        geo_filter,
                    )
                )
            )
            .scalars()
            .first()
        )
        if db_row is not None:
            skeleton_by_key[key] = db_row
            return db_row

        source_litho = await self._session.get(GeologicalFormationOrm, source_litho_formation_id)
        soil_code = source_litho.litho_main_soil_code if source_litho is not None else None
        admixtures = source_litho.litho_admixtures if source_litho is not None else None
        color = source_litho.color if source_litho is not None else "#bbbbbb"
        name = f"{source_litho.name} (geotech)" if source_litho is not None else "geotech unit"
        display_order = source_litho.display_order if source_litho is not None else 0

        formation = GeologicalFormationOrm(
            id=uuid7(),
            app_project_id=project_id,
            name=name,
            color=color,
            display_order=display_order,
            nad_class=None,
            litho_main_soil_code=soil_code,
            litho_admixtures=admixtures,
            source_litho_formation_id=source_litho_formation_id,
            source_geo_formation_id=source_geo_formation_id,
        )
        self._session.add(formation)
        await self._session.flush()
        skeleton_by_key[key] = formation
        self.debug(
            f"_find_or_create_skeleton: created {formation.id} "
            f"litho={source_litho_formation_id} geo={source_geo_formation_id}"
        )
        return formation

    # ------------------------------------------------------------------
    # DB helpers
    # ------------------------------------------------------------------

    async def _resolve_anchor_kinds(self, investigation_ids: set[UUID]) -> dict[str, str]:
        """Classify each investigation id as ``"borehole"`` or ``"cpt"``.

        Parameters
        ----------
        investigation_ids : set[UUID]
            Investigation UUIDs to classify.

        Returns
        -------
        dict[str, str]
            ``investigation_id (str) -> "borehole" | "cpt"``.
        """
        if not investigation_ids:
            return {}
        kinds: dict[str, str] = {}
        bh_ids = (
            await self._session.execute(
                select(BoreholeOrm.id).where(BoreholeOrm.id.in_(investigation_ids))
            )
        ).scalars()
        for bid in bh_ids:
            kinds[str(bid)] = "borehole"
        cpt_ids = (
            await self._session.execute(select(CptOrm.id).where(CptOrm.id.in_(investigation_ids)))
        ).scalars()
        for cid in cpt_ids:
            kinds[str(cid)] = "cpt"
        return kinds

    async def _load_cpt_series(self, cpt_ids: set[UUID]) -> dict[UUID, CptSeriesOrm]:
        """Load qc series rows for a set of CPT ids.

        Parameters
        ----------
        cpt_ids : set[UUID]
            CPT ids for which to load series rows.

        Returns
        -------
        dict[UUID, CptSeriesOrm]
            ``cpt_id -> CptSeriesOrm``; absent when the CPT has no series row.
        """
        if not cpt_ids:
            return {}
        rows = (
            (
                await self._session.execute(
                    select(CptSeriesOrm).where(CptSeriesOrm.cpt_id.in_(cpt_ids))
                )
            )
            .scalars()
            .all()
        )
        return {s.cpt_id: s for s in rows}

    async def _load_total_depths(self, investigation_ids: set[UUID]) -> dict[UUID, float]:
        """Load total depth for each in-corridor investigation.

        Parameters
        ----------
        investigation_ids : set[UUID]
            In-corridor investigation UUIDs.

        Returns
        -------
        dict[UUID, float]
            ``investigation_id -> total_depth_m``.
        """
        total_depths: dict[UUID, float] = {}
        cpt_rows = (
            await self._session.execute(
                select(CptOrm.id, CptOrm.max_depth_m).where(CptOrm.id.in_(investigation_ids))
            )
        ).all()
        for row in cpt_rows:
            if row.max_depth_m is not None:
                total_depths[row.id] = row.max_depth_m
        bh_rows = (
            await self._session.execute(
                select(BoreholeOrm.id, BoreholeOrm.total_depth_m).where(
                    BoreholeOrm.id.in_(investigation_ids)
                )
            )
        ).all()
        for row in bh_rows:
            if row.total_depth_m is not None:
                total_depths[row.id] = row.total_depth_m
        return total_depths

    async def _load_litho_layer_depths(
        self, litho_model_id: UUID, investigation_ids: set[UUID]
    ) -> dict[UUID, tuple[str, float, float]]:
        """Load top and base depths for accepted litho layers in the corridor.

        Used by ``_derive_geotech_edges_from_litho`` to map each litho edge
        endpoint to the correct geotech sub-layer via depth overlap.

        Parameters
        ----------
        litho_model_id : UUID
            The litho model to query.
        investigation_ids : set[UUID]
            In-corridor investigation ids to restrict to.

        Returns
        -------
        dict[UUID, tuple[str, float, float]]
            ``litho_layer_id → (investigation_id_str, depth_top_m, depth_base_m)``
            for every accepted litho layer on any in-corridor investigation.
        """
        if not investigation_ids:
            return {}
        rows = (
            await self._session.execute(
                select(
                    LithoLayerOrm.id,
                    LithoLayerOrm.borehole_id,
                    LithoLayerOrm.cpt_id,
                    LithoLayerOrm.depth_top_m,
                    LithoLayerOrm.depth_base_m,
                ).where(
                    LithoLayerOrm.model_id == litho_model_id,
                    LithoLayerOrm.status == "accepted",
                    LithoLayerOrm.borehole_id.in_(investigation_ids)
                    | LithoLayerOrm.cpt_id.in_(investigation_ids),
                )
            )
        ).all()
        result: dict[UUID, tuple[str, float, float]] = {}
        for r in rows:
            inv_id = str(r.borehole_id if r.borehole_id is not None else r.cpt_id)
            result[r.id] = (inv_id, r.depth_top_m, r.depth_base_m)
        return result

    async def _load_approved_litho_edges(
        self, litho_model_id: UUID, section_id: UUID
    ) -> set[tuple[UUID, UUID]]:
        """Load approved litho edges for the section as canonical pairs.

        Returns the set of ``(min_id, max_id)`` canonical pairs from the
        litho model's ``litho_contact_correlation_edge`` rows (user_approved,
        section-scoped).  These pairs are used to derive which investigation
        pairs are correlated in the litho model.

        Parameters
        ----------
        litho_model_id : UUID
            The litho model.
        section_id : UUID
            The section to restrict to (edges are section-scoped).

        Returns
        -------
        set[tuple[UUID, UUID]]
            Canonical ``(min_id, max_id)`` pairs of approved litho edges.
        """
        rows = (
            await self._session.execute(
                select(
                    LithoContactCorrelationEdgeOrm.contact_a_id,
                    LithoContactCorrelationEdgeOrm.contact_b_id,
                ).where(
                    LithoContactCorrelationEdgeOrm.model_id == litho_model_id,
                    LithoContactCorrelationEdgeOrm.section_id == section_id,
                    LithoContactCorrelationEdgeOrm.user_approved.is_(True),
                )
            )
        ).all()
        # Edges already store canonical (a < b) order, but re-canonicalise for
        # safety in case any legacy row slipped through without the CHECK guard.
        return {(min(a, b), max(a, b)) for a, b in rows}

    async def _read_min_thickness_m(self, project_id: UUID) -> float:
        """Read the project's ``minimum_layer_thickness_m`` from its view-state.

        Mirrors ``SuggestGeotechSubdivision._read_min_thickness_m``.

        Parameters
        ----------
        project_id : UUID
            Owning project id.

        Returns
        -------
        float
            The configured minimum thickness, or ``_DEFAULT_MIN_THICKNESS_M``
            (0.30 m) when absent, non-positive, or non-numeric.
        """
        project = await ProjectRepository(self._session).get_by_id(project_id)
        view_state = project.view_state if project is not None else None
        seg = (view_state or {}).get("litho_segmenter") or {}
        try:
            val = float(seg.get("minimum_layer_thickness_m", _DEFAULT_MIN_THICKNESS_M))
            return val if val > 0 else _DEFAULT_MIN_THICKNESS_M
        except (TypeError, ValueError):
            return _DEFAULT_MIN_THICKNESS_M

    # ------------------------------------------------------------------
    # Formation attribute helpers
    # ------------------------------------------------------------------

    async def _formation_soil_code(self, formation_id: UUID) -> str | None:
        """Load the ``litho_main_soil_code`` from a formation row.

        Parameters
        ----------
        formation_id : UUID
            The litho formation id.

        Returns
        -------
        str | None
            The soil code string, or ``None`` when absent or the row is not found.
        """
        row = await self._session.get(GeologicalFormationOrm, formation_id)
        return row.litho_main_soil_code if row is not None else None

    async def _formation_admixtures(self, formation_id: UUID) -> tuple[Admixture, ...]:
        """Load and parse the admixtures from a formation row.

        Parameters
        ----------
        formation_id : UUID
            The litho formation id.

        Returns
        -------
        tuple[Admixture, ...]
            Domain admixture objects; empty tuple when none are stored.
        """
        row = await self._session.get(GeologicalFormationOrm, formation_id)
        if row is None or not row.litho_admixtures:
            return ()
        return tuple(
            Admixture(
                soil_code=entry.get("soil_code", ""),
                amount=entry.get("amount", ""),
                locally=bool(entry.get("locally", False)),
            )
            for entry in row.litho_admixtures
            if isinstance(entry, dict)
        )
