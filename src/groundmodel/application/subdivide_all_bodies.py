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

Architecture — MODEL-WIDE layers, PER-SECTION edges
-----------------------------------------------------
An investigation's geotech *layers* (packing-class sub-units) depend only on
that investigation's qc series and its body membership — they are the SAME
regardless of which section views the investigation.  Only the correlation
*edges* are section-scoped (each section has its own litho-edge set; geotech
edges inherit that scoping).

The old per-section design processed one section's corridor and, in its
idempotent reset, deleted geotech layers for that corridor's investigations.
Tie-sections sharing an investigation with a cross-section therefore clobbered
each other's geotech layers (and cascade-deleted the other section's edges).

The new design:

1. Resolves body_id model-wide.
2. Loads ALL model investigations' picks (no section restriction).
3. **Idempotent reset: deletes ALL geotech data for the WHOLE geotech model
   (not a corridor subset)** — edges → layers → FC rows → bodies.
4. Groups geo-bounded segments by ``(body_id, source_geo_formation_id)``
   across the whole model.
5. Classifies each group (CPT-bearing: B-policy; borehole-only: deferred to
   step 6b extrapolation).
6. Materialises ``litho_layer`` rows ONCE per (investigation, sub-band) —
   each investigation appears in at most one group per geo-band so there is
   no double-materialisation.
6b. **Borehole extrapolation (NEW):** for each borehole-only sub-body,
    finds the nearest CPT of the SAME lithology with a classified sub-body
    overlapping that depth range and assigns its nad_class.  Falls back to
    nearest CPT of any lithology, then (last resort) nad_class=None.
7. **Edges — PER SECTION:** loads each project section's approved litho edges
   and derives geotech edges by same-class packing match within each litho
   body (``_derive_geotech_edges_from_litho``): within a correlated litho-unit
   pair, each geotech sub-band connects to EVERY band on the other test that
   shares its (non-null) NAD class, regardless of count or order; the resolver
   then unions a recurring class into one body.  Edges are tagged with that
   section's id.
8. Runs the resolver model-wide.
9. ONE commit.

What it persists (one transaction, single commit at the end)
------------------------------------------------------------
1. **``litho_layer`` rows** — one per geotech sub-body position per column
   in the geotech model, ``status='accepted'``, ``source='segmenter'``.  The
   LL→FC trigger auto-derives the matching ``formation_contact`` row for each
   accepted insert (SAB-8 / TRAP 2 guard: never write FC directly).

2. **``litho_contact_correlation_edge`` rows** — one per approved litho edge,
   mapped from the litho layer's depth to the geotech sub-layer covering that
   same depth on each investigation, tagged with the source ``section_id``.
   All edges are ``user_approved=True``, ``source='manual'``.

3. **``BodyOrm`` rows** — created by ``ResolveLithoInstances`` from the above
   edges; ``litho_layer.body_id`` is stamped in the same step.

Idempotency on re-run
---------------------
Before writing new rows the use case deletes ALL geotech data for the model
(not just a corridor), so a re-run always starts from a clean state.  The
geotech model row itself is not deleted; only its content is.

Borehole extrapolation — nearest-CPT same-lithology rule
---------------------------------------------------------
Boreholes carry lithology but not packing-class (no qc series).  After all
CPT-bearing groups are classified, each borehole-only sub-body is resolved:

1. Find every CPT in the model whose classified geotech sub-body has the SAME
   ``litho_main_soil_code`` AND overlaps the borehole's depth range
   (``top_a < base_b`` and ``top_b < base_a``).
2. Among those candidates, pick the one closest in map-plane xy distance to
   the borehole.
3. Assign the candidate CPT's ``nad_class`` to the borehole sub-body.
4. Fallback 1: if no same-lithology CPT candidate exists, pick the nearest
   CPT candidate of any lithology at that depth.
5. Fallback 2: if the model has zero CPTs at all, keep ``nad_class=None``
   (last resort; the frontend should not show a "No qc" ghost when a
   same-lithology CPT exists anywhere in the model).

Edge derivation — same-class packing match
-------------------------------------------
For each approved litho ``litho_contact_correlation_edge`` (layer_A ↔ layer_B),
the geotech sub-band stacks within that litho unit on both tests are compared.
A stack is the list of ``(layer_id, nad_class)`` tuples top→base for all geotech
sub-layers whose ``[top, base]`` interval is contained within the litho unit's
``[depth_top_m, depth_base_m]`` (1 mm tolerance for geo-band divide noise).
Via ``same_class_pairs`` (spec §5, 2026-06-26), each band on one test connects
to EVERY band on the other test that shares its (non-null) NAD class, regardless
of count or order; the resolver's connected-components then unions a recurring
class within the unit into ONE body (the engineer splits manually).  A litho
pair where no class matches connects nothing.  Null-class bands (skeleton /
last-resort) never auto-connect (spec §8).
"""

from __future__ import annotations

import math
import time
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
from groundmodel.application.resolve_litho_instances_use_case import ResolveLithoInstances
from groundmodel.application.scope_guard import load_scoped_or_raise
from groundmodel.domain.services.geotech_body_aggregation import (
    BandProfile,
    plan_body_subdivision,
)
from groundmodel.domain.services.geotech_packing_edges import same_class_pairs
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
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
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
# Geotech packing bands are intentionally COARSER than litho layers (a 27 cm
# NAD-class sliver is not a meaningful packing unit), so the geotech default is
# kept SEPARATE from the litho segmenter's 0.30 m (which stays fine for
# lithology layering). Read from ``view_state["geotech_subdivision"]``, not the
# shared ``litho_segmenter`` knob, so tuning one never moves the other.
# 0.35 m (owner directive 2026-06-25): 0.50 m was over-merging real packing
# transitions; 0.35 m resolves a dense-sand-over-medium boundary the engineer
# would place by hand without descending to sliver noise.
_DEFAULT_MIN_THICKNESS_M: float = 0.35

# Geo↔litho snap tolerance for the geotech geo-bounding. When a geological
# surface crosses a litho unit within this distance of a litho contact, the
# division SNAPS to the contact instead of carving a thin sliver. Geotech uses a
# wider default (0.3 m) than the litho stage's 0.20 m so true near-coincident
# slivers snap, while a genuine mid-unit geo boundary further than 0.3 m from any
# contact still divides (a 0.44 m division is real, not a sliver — owner). Read
# from ``view_state["geotech_subdivision"]``, kept separate from the litho
# stage's ``litho_segmenter.litho_snap_tolerance_m``.
_DEFAULT_GEOTECH_SNAP_TOLERANCE_M: float = 0.30


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
        Number of body groups that were borehole-only (no CPT qc → classified
        via nearest-CPT extrapolation or last-resort nad_class=None).
    extrapolated_borehole_count : int
        Subset of borehole_only_count that were successfully extrapolated from
        a nearest same-lithology CPT (not the last-resort None path).
    section_count : int
        Number of project sections processed for edge derivation.
    """

    geotech_model_id: UUID
    created_formation_ids: list[UUID]
    layer_count: int
    body_count: int
    split_body_count: int
    one_class_body_count: int
    borehole_only_count: int
    extrapolated_borehole_count: int = 0
    section_count: int = 0


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
    nad_classes : list[int | None]
        The NAD packing class for each sub-interval (parallel to
        ``sub_intervals``). For a CPT this is the CPT's OWN A3 segmentation
        class per band — NOT a body-consensus class — so each test segments by
        its own qc. ``None`` means "classify later by extrapolation" (boreholes,
        or a CPT with no usable qc); those are materialised with a skeleton
        formation and resolved in Phase 8b.
    """

    investigation_id: str
    anchor_kind: str
    geo_bounded_top_m: float
    geo_bounded_base_m: float
    sub_intervals: list[tuple[float, float]] = field(default_factory=list)
    nad_classes: list[int | None] = field(default_factory=list)


@dataclass
class _PendingBoreholeSubBody:
    """One borehole sub-body awaiting nearest-CPT extrapolation.

    Attributes
    ----------
    investigation_id : str
        Borehole id string.
    x_m : float
        Borehole world x-coordinate.
    y_m : float
        Borehole world y-coordinate.
    top_m : float
        Sub-body depth top (m).
    base_m : float
        Sub-body depth base (m).
    litho_soil_code : str | None
        Lithology soil code from the source litho formation.
    source_litho_formation_id : UUID
        Source litho formation id (for formation find-or-create).
    source_geo_formation_id : UUID | None
        Source geo-band formation id.
    layer_id : UUID
        The ``LithoLayerOrm`` id already inserted (formation_id is a
        placeholder skeleton; this id is updated after extrapolation).
    """

    investigation_id: str
    x_m: float
    y_m: float
    top_m: float
    base_m: float
    litho_soil_code: str | None
    source_litho_formation_id: UUID
    source_geo_formation_id: UUID | None
    layer_id: UUID


class SubdivideAllBodies(GroundModelLogger):
    """Classify + materialise geotech spatial bodies for the whole litho model.

    Runs after ``BuildGeotechModelFromLitho`` (C1) has ensured the geotech
    model exists.  Does NOT assume C1 contacts exist — it works from the litho
    model's accepted layers + body resolver directly.

    Key design: geotech *layers* are materialised model-wide (one per
    investigation per sub-band — investigation appears in exactly one body
    group per geo-band).  Geotech correlation *edges* are derived per section,
    each tagged with that section's ``section_id``.  This prevents tie-sections
    from clobbering each other's geotech data.

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
    ) -> SubdivideAllBodiesResult:
        """Subdivide all model bodies and materialise geotech spatial bodies.

        Processes the WHOLE litho model (all investigations, all sections) in
        one transaction.  Geotech layers are model-wide; geotech edges are
        per-section (each section's approved litho edges are mapped to geotech
        sub-layers and tagged with that section's id).

        Parameters
        ----------
        project_id : UUID
            Project scope guard — the litho model must belong to this project.
        litho_model_id : UUID
            The lithostratigraphic model to subdivide.  Must be
            ``kind='lithostratigraphic'``.

        Returns
        -------
        SubdivideAllBodiesResult
            Geotech model id + per-phase counts.

        Raises
        ------
        ValueError
            When the litho model is missing / out of project.
        """
        t0 = time.monotonic()
        self.info(f"SubdivideAllBodies: litho_model={litho_model_id} (model-wide)")

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

        # Phase 2 — load ALL model picks (no section restriction).
        picks = await self._litho_repo.load_body_picks(litho_model_id)
        self.info(f"SubdivideAllBodies: {len(picks)} pick(s) across whole model")
        if not picks:
            await self._session.commit()
            self.warning(
                "SubdivideAllBodies: no picks in the model — geotech model "
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

        # Phase 3 — geo-bound picks (same pipeline as C1, but a wider geotech
        # snap tolerance so true near-coincident geo slivers snap to the litho
        # contact instead of carving thin geotech sub-units).
        snap_tol = await self._read_geotech_snap_tolerance_m(geotech_model.app_project_id)
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
            f"SubdivideAllBodies: {len(divided)} geo-bounded segment(s) "
            f"(snap_tol={snap_tol} m) [{time.monotonic() - t0:.1f}s]"
        )

        # Phase 4 — model-wide idempotent reset: delete ALL geotech data.
        # Order: edges → layers (trigger deletes their FCs) → stale direct
        # FC rows (from C1) → bodies.
        await self._delete_all_geotech_data(geotech_model.id)

        # Phase 5 — group geo-bounded segments by (body_id, source_geo_formation_id).
        groups = await self._group_segments(divided, geo_surfaces)
        self.info(f"SubdivideAllBodies: {len(groups)} body group(s) to process")

        # Phase 6 — anchor-kind lookup for ALL model investigations.
        all_investigation_ids = {UUID(s.investigation_id) for s in divided}
        anchor_kind = await self._resolve_anchor_kinds(all_investigation_ids)

        # Phase 7 — load CPT series + min_thickness (per-CPT segmentation needs
        # no body-wide total depths now that split surfaces aren't interpolated).
        all_cpt_ids = {UUID(inv_id) for inv_id, kind in anchor_kind.items() if kind == "cpt"}
        cpt_series = await self._load_cpt_series(all_cpt_ids)
        min_thickness_m = await self._read_min_thickness_m(geotech_model.app_project_id)
        gradient_snap, gradient_snap_window_m = await self._read_gradient_snap(
            geotech_model.app_project_id
        )
        self.debug(f"SubdivideAllBodies: min_thickness_m={min_thickness_m}")

        # Global depth-indexed map built during materialisation: for each
        # investigation, the list of (depth_top_m, depth_base_m,
        # geotech_layer_id, geotech_formation_id, nad_class) tuples for all
        # created geotech sub-layers on that investigation.  Consumed after the
        # group loop by _derive_geotech_edges_from_litho.
        geotech_layer_by_inv_depth: dict[str, list[tuple[float, float, UUID, UUID, int | None]]] = (
            defaultdict(list)
        )

        # Phase 8 — per-group materialise (CPT-bearing groups get classified
        # immediately; borehole-only groups are deferred to extrapolation).
        created_formation_ids: list[UUID] = []
        classified_by_key: dict[tuple[int, UUID, UUID | None], GeologicalFormationOrm] = {}
        skeleton_by_key: dict[tuple[UUID, UUID | None], GeologicalFormationOrm] = {}

        total_layers = 0
        split_body_count = 0
        one_class_body_count = 0
        borehole_only_count = 0

        # Pending borehole sub-bodies awaiting extrapolation.  Each entry is a
        # _PendingBoreholeSubBody describing the geometry + provenance of one
        # borehole sub-unit that was written with a skeleton (nad_class=None)
        # formation and will be reclassified in Phase 8b.
        pending_borehole_sub_bodies: list[_PendingBoreholeSubBody] = []

        # Classified CPT sub-body registry: maps (soil_code, geotech_formation_id)
        # to a list of (x_m, y_m, nad_class, top_m, base_m) tuples.  Built during
        # the per-group loop and consumed in Phase 8b for distance lookups.
        # key = litho_soil_code (str|None)
        # value = list[(x_m, y_m, nad_class, top_m, base_m)]
        cpt_classified_sub_bodies: list[tuple[str | None, float, float, int, float, float]] = []

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

            # Hoist formation attributes (constant for the whole group).
            soil_code = await self._formation_soil_code(source_litho_fid)
            admixtures = await self._formation_admixtures(source_litho_fid)

            # Build a BandProfile per CPT member.
            profiles: list[BandProfile] = []
            for seg in cpt_segs:
                series = cpt_series.get(UUID(seg.investigation_id))
                if series is None:
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
                    gradient_snap=gradient_snap,
                    gradient_snap_window_m=gradient_snap_window_m,
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

            # Build a per-column plan for all segments (CPT + borehole).
            column_plans = self._build_column_plans(
                group_segs=group_segs,
                anchor_kind=anchor_kind,
                profiles=profiles,
            )

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

                # Look up xy for this investigation (needed for borehole
                # extrapolation and for CPT registry).
                inv_seg = next((s for s in group_segs if s.investigation_id == inv_id), None)
                inv_x = inv_seg.x_m if inv_seg else 0.0
                inv_y = inv_seg.y_m if inv_seg else 0.0

                for k, (top_m, base_m) in enumerate(col_plan.sub_intervals):
                    # Each column carries its OWN per-band NAD class (CPT = its A3
                    # segmentation; borehole/unclassified = None). A None class is
                    # materialised with a skeleton formation + queued for Phase-8b
                    # extrapolation from the nearest CPT.
                    nad_class = col_plan.nad_classes[k] if k < len(col_plan.nad_classes) else None

                    if nad_class is None:
                        # No local class (borehole, or CPT w/o usable qc): skeleton
                        # formation; queue for Phase 8b extrapolation.
                        formation = await self._find_or_create_skeleton(
                            project_id=project_id,
                            skeleton_by_key=skeleton_by_key,
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
                        # nad_class is None here (skeleton); updated during Phase 8b
                        # extrapolation IF a nearest-CPT candidate is found;
                        # otherwise stays None.
                        geotech_layer_by_inv_depth[inv_id].append(
                            (top_m, base_m, layer.id, formation.id, nad_class)
                        )
                        total_layers += 1
                        pending_borehole_sub_bodies.append(
                            _PendingBoreholeSubBody(
                                investigation_id=inv_id,
                                x_m=inv_x,
                                y_m=inv_y,
                                top_m=top_m,
                                base_m=base_m,
                                litho_soil_code=soil_code,
                                source_litho_formation_id=source_litho_fid,
                                source_geo_formation_id=source_geo_fid,
                                layer_id=layer.id,
                            )
                        )
                    else:
                        # CPT's OWN A3 class for this band (no body consensus).
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
                            (top_m, base_m, layer.id, formation.id, nad_class)
                        )
                        total_layers += 1

                        # Register CPT sub-bodies for borehole extrapolation.
                        if col_plan.anchor_kind == "cpt" and nad_class is not None:
                            cpt_classified_sub_bodies.append(
                                (soil_code, inv_x, inv_y, nad_class, top_m, base_m)
                            )

            await self._session.flush()

        # Phase 8b — borehole extrapolation: resolve pending borehole sub-bodies
        # by nearest-CPT same-lithology lookup.
        extrapolated_borehole_count = await self._extrapolate_borehole_sub_bodies(
            project_id=project_id,
            pending=pending_borehole_sub_bodies,
            cpt_classified_sub_bodies=cpt_classified_sub_bodies,
            classified_by_key=classified_by_key,
            created_formation_ids=created_formation_ids,
            geotech_model_id=geotech_model.id,
            geotech_layer_by_inv_depth=geotech_layer_by_inv_depth,
        )

        # Phase 9 — load all project sections; derive geotech edges per section.
        sections = await self._load_project_sections(project_id)
        self.info(
            f"SubdivideAllBodies: deriving edges for {len(sections)} section(s) "
            f"[{time.monotonic() - t0:.1f}s]"
        )

        # Build the model-wide litho layer depth index once (all accepted litho
        # layers across all investigations — no section restriction).
        litho_layer_depths = await self._load_litho_layer_depths(litho_model_id, None)
        self.debug(
            f"SubdivideAllBodies: {len(litho_layer_depths)} litho layer depth entries loaded"
        )

        sections_with_edges = 0
        for section in sections:
            litho_approved_edges = await self._load_approved_litho_edges(litho_model_id, section.id)
            if not litho_approved_edges:
                continue
            sections_with_edges += 1
            self.debug(
                f"SubdivideAllBodies: section={section.id} ({section.name!r}) "
                f"{len(litho_approved_edges)} approved litho edge(s)"
            )
            await self._derive_geotech_edges_from_litho(
                geotech_model_id=geotech_model.id,
                section_id=section.id,
                litho_approved_edges=litho_approved_edges,
                litho_layer_depths=litho_layer_depths,
                geotech_layer_by_inv_depth=geotech_layer_by_inv_depth,
            )

        # Phase 10 — run resolver model-wide: creates BodyOrm + stamps
        # litho_layer.body_id.
        await ResolveLithoInstances(self._session).execute(model_id=geotech_model.id, commit=False)

        body_count = len(
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

        elapsed = time.monotonic() - t0
        result = SubdivideAllBodiesResult(
            geotech_model_id=geotech_model.id,
            created_formation_ids=created_formation_ids,
            layer_count=total_layers,
            body_count=body_count,
            split_body_count=split_body_count,
            one_class_body_count=one_class_body_count,
            borehole_only_count=borehole_only_count,
            extrapolated_borehole_count=extrapolated_borehole_count,
            section_count=sections_with_edges,
        )
        self.success(
            f"SubdivideAllBodies: geotech_model={geotech_model.id} "
            f"layers={total_layers} bodies={body_count} "
            f"split={split_body_count} one_class={one_class_body_count} "
            f"borehole_only={borehole_only_count} extrapolated={extrapolated_borehole_count} "
            f"sections={len(sections)} elapsed={elapsed:.1f}s"
        )
        return result

    # ------------------------------------------------------------------
    # Phase 4 — model-wide idempotent reset
    # ------------------------------------------------------------------

    async def _delete_all_geotech_data(self, geotech_model_id: UUID) -> None:
        """Delete ALL prior geotech layers, edges, FC rows, and bodies for the model.

        Scoped to the entire geotech model (not a corridor subset), so that
        re-running the model-wide subdivide always starts from a clean state.
        Order: edges → layers (LL→FC trigger cleans their FC mirrors) →
        direct FC rows written by C1 → bodies.

        Parameters
        ----------
        geotech_model_id : UUID
            The geotechnical model to wipe clean.
        """
        # 1. Delete all correlation edges for the geotech model.
        await self._session.execute(
            delete(LithoContactCorrelationEdgeOrm).where(
                LithoContactCorrelationEdgeOrm.model_id == geotech_model_id,
            )
        )

        # 2. Delete all litho_layer rows (LL→FC trigger removes their FC mirrors).
        await self._session.execute(
            delete(LithoLayerOrm).where(LithoLayerOrm.model_id == geotech_model_id)
        )

        # 2b. Delete any remaining FormationContact rows for the geotech model.
        # BuildGeotechModelFromLitho (C1) writes FC rows DIRECTLY (not via the
        # LL→FC trigger), so step 2's trigger-based cleanup does not remove them.
        # Without this step a subsequent SAB run fires the LL→FC trigger which
        # tries to INSERT the same FC row again →
        # uq_formation_contact_model_formation_borehole_depth violation.
        await self._session.execute(
            delete(FormationContactOrm).where(
                FormationContactOrm.model_id == geotech_model_id,
            )
        )

        # 3. Delete all BodyOrm rows for the geotech model.  The resolver
        # recreates them; the bodies from the previous run must be cleared so we
        # don't violate (model, formation, ordinal) uniqueness on re-run.
        await self._session.execute(delete(BodyOrm).where(BodyOrm.model_id == geotech_model_id))

        await self._session.flush()
        self.debug(
            f"_delete_all_geotech_data: cleared all geotech data for model {geotech_model_id}"
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
        profiles: list[BandProfile],
    ) -> list[_ColumnPlan]:
        """Build per-column sub-interval plans for one body group.

        PER-CPT (owner directive 2026-06-25): each CPT column uses its OWN A3
        segmentation (``profile.splits``) — its own band depths AND its own NAD
        class per band — so a test segments by its qc independently of its
        neighbours (no body-consensus collapse). Boreholes (no qc) get one band
        over their geo-bounded extent with ``nad_class = None``, resolved later by
        Phase-8b extrapolation from the nearest CPT.

        Parameters
        ----------
        group_segs : list[BodyLayerPick]
            All geo-bounded segment picks for the group.
        anchor_kind : dict[str, str]
            ``investigation_id (str) -> "borehole" | "cpt"``.
        profiles : list[BandProfile]
            Per-CPT packing-band profiles (the A3 segmentation per test).

        Returns
        -------
        list[_ColumnPlan]
            One entry per column in the group, carrying per-band NAD classes.
        """
        profiles_by_inv = {p.investigation_id: p for p in profiles}
        col_plans: list[_ColumnPlan] = []

        for seg in group_segs:
            kind = anchor_kind.get(seg.investigation_id, "borehole")
            geo_top = seg.top_depth_m
            geo_base = seg.base_depth_m
            if geo_base <= geo_top:
                continue

            sub_intervals: list[tuple[float, float]] = []
            nad_classes: list[int | None] = []

            profile = profiles_by_inv.get(seg.investigation_id)
            if kind == "cpt" and profile is not None and profile.splits:
                # PER-CPT (owner directive 2026-06-25): each test segments by its
                # OWN qc (the A3 ``profile.splits``), NOT a body-consensus class. A
                # sand whose qc crosses 10/15 MPa splits los/matig/dicht on THIS
                # test even if its neighbours disagree. The A3 splits already tile
                # [seg.top, seg.base] (== the geo-bounded extent); clamp defensively.
                for sp in profile.splits:
                    top_m = max(sp.depth_top_m, geo_top)
                    base_m = min(sp.depth_base_m, geo_base)
                    if base_m - top_m > 1e-6:
                        sub_intervals.append((top_m, base_m))
                        nad_classes.append(sp.nad_class)

            if not sub_intervals:
                # Borehole (no qc), or a CPT with no usable segmentation → ONE band
                # spanning the geo-bounded extent, classified later by Phase-8b
                # extrapolation (nearest CPT). ``None`` flags the skeleton path.
                sub_intervals = [(geo_top, geo_base)]
                nad_classes = [None]

            col_plans.append(
                _ColumnPlan(
                    investigation_id=seg.investigation_id,
                    anchor_kind=kind,
                    geo_bounded_top_m=geo_top,
                    geo_bounded_base_m=geo_base,
                    sub_intervals=sub_intervals,
                    nad_classes=nad_classes,
                )
            )

        return col_plans

    # ------------------------------------------------------------------
    # Phase 8b — borehole extrapolation
    # ------------------------------------------------------------------

    async def _extrapolate_borehole_sub_bodies(
        self,
        *,
        project_id: UUID,
        pending: list[_PendingBoreholeSubBody],
        cpt_classified_sub_bodies: list[tuple[str | None, float, float, int, float, float]],
        classified_by_key: dict[tuple[int, UUID, UUID | None], GeologicalFormationOrm],
        created_formation_ids: list[UUID],
        geotech_model_id: UUID,
        geotech_layer_by_inv_depth: dict[str, list[tuple[float, float, UUID, UUID, int | None]]],
    ) -> int:
        """Resolve borehole-only sub-bodies via nearest-CPT extrapolation.

        For each pending borehole sub-body:
        1. Find same-lithology CPT sub-bodies that overlap the borehole's depth
           range (``top_a < base_b AND top_b < base_a``).
        2. Among those, pick the nearest by map-plane xy distance.
        3. Assign its ``nad_class`` and update the layer's ``formation_id``.
        4. If no same-lithology candidate: try any-lithology at that depth.
        5. If no CPT candidates at all: keep the skeleton (nad_class=None).

        Updates the ``LithoLayerOrm`` row's ``formation_id`` in place (an
        UPDATE via the SQLAlchemy ORM) and updates ``geotech_layer_by_inv_depth``
        so the post-materialisation edge pass sees the correct formation_id.

        Parameters
        ----------
        project_id : UUID
            Owning project.
        pending : list[_PendingBoreholeSubBody]
            Borehole sub-bodies to resolve.
        cpt_classified_sub_bodies : list
            ``(soil_code, x_m, y_m, nad_class, top_m, base_m)`` tuples for all
            classified CPT sub-bodies in the model.
        classified_by_key : dict
            In-memory find-or-create cache for classified formations (mutated).
        created_formation_ids : list[UUID]
            Accumulator of created formation ids (mutated).
        geotech_model_id : UUID
            The geotech model id (for logging only).
        geotech_layer_by_inv_depth : dict
            Per-investigation depth→layer-id map (mutated: formation_id and
            nad_class updated for the extrapolated layer).

        Returns
        -------
        int
            Number of borehole sub-bodies successfully extrapolated (got a
            real nad_class from a CPT, not the last-resort None).
        """
        if not pending:
            return 0

        extrapolated = 0

        for pb in pending:
            # Candidates: CPT sub-bodies whose depth range overlaps [top_m, base_m].
            overlapping = [
                (sc, x, y, nad, t, b)
                for (sc, x, y, nad, t, b) in cpt_classified_sub_bodies
                if t < pb.base_m and b > pb.top_m
            ]

            # Prefer same-lithology candidates.
            same_litho = [c for c in overlapping if c[0] == pb.litho_soil_code]
            candidates = same_litho if same_litho else overlapping

            if candidates:
                # Nearest by map-plane xy distance.
                def _dist(c: tuple) -> float:
                    dx = c[1] - pb.x_m
                    dy = c[2] - pb.y_m
                    return math.hypot(dx, dy)

                best = min(candidates, key=_dist)
                _, best_x, best_y, nad_class, _, _ = best
                dist_m = _dist(best)
                matched_litho = best[0]

                formation = await self._find_or_create_classified(
                    project_id=project_id,
                    classified_by_key=classified_by_key,
                    created_formation_ids=created_formation_ids,
                    nad_class=nad_class,
                    source_litho_formation_id=pb.source_litho_formation_id,
                    source_geo_formation_id=pb.source_geo_formation_id,
                )

                # Update the existing layer row in-place.
                layer_row = await self._session.get(LithoLayerOrm, pb.layer_id)
                if layer_row is not None:
                    layer_row.formation_id = formation.id

                # Update the in-memory depth index so the edge pass sees the
                # correct formation_id AND the extrapolated nad_class for this layer.
                inv_entries = geotech_layer_by_inv_depth.get(pb.investigation_id, [])
                geotech_layer_by_inv_depth[pb.investigation_id] = [
                    (t, b, lid, formation.id, nad_class)
                    if lid == pb.layer_id
                    else (t, b, lid, fid, nad)
                    for (t, b, lid, fid, nad) in inv_entries
                ]

                self.debug(
                    f"_extrapolate_borehole_sub_bodies: borehole={pb.investigation_id} "
                    f"depth=[{pb.top_m:.2f},{pb.base_m:.2f}] "
                    f"→ nad_class={nad_class} from nearest CPT "
                    f"(dist={dist_m:.0f} m, soil={matched_litho!r}, "
                    f"same_litho={bool(same_litho)})"
                )
                extrapolated += 1
            else:
                # No CPT candidates anywhere — keep the skeleton (nad_class=None).
                self.debug(
                    f"_extrapolate_borehole_sub_bodies: borehole={pb.investigation_id} "
                    f"depth=[{pb.top_m:.2f},{pb.base_m:.2f}] "
                    f"→ no CPT candidates, keeping nad_class=None (last resort)"
                )

        await self._session.flush()
        self.info(
            f"_extrapolate_borehole_sub_bodies: {extrapolated}/{len(pending)} "
            f"borehole sub-bodies extrapolated from nearest CPT"
        )
        return extrapolated

    # ------------------------------------------------------------------
    # Phase 9 — edge derivation by same-class packing match
    # ------------------------------------------------------------------

    async def _derive_geotech_edges_from_litho(
        self,
        *,
        geotech_model_id: UUID,
        section_id: UUID,
        litho_approved_edges: set[tuple[UUID, UUID]],
        litho_layer_depths: dict[UUID, tuple[str, float, float]],
        geotech_layer_by_inv_depth: dict[str, list[tuple[float, float, UUID, UUID, int | None]]],
    ) -> None:
        """Derive geotech edges by same-class packing match within each litho body.

        Each approved litho edge already identifies a correlated litho-unit
        pair (the same litho body, traced across two adjacent tests).  For each
        such pair this method connects the geotech packing sub-bands within that
        litho unit on both tests by SHARED NAD class:

        1. Resolve each endpoint's ``(investigation_id, depth_top_m,
           depth_base_m)`` from ``litho_layer_depths`` — the litho unit's depth
           extent on each test.
        2. Collect the geotech sub-band stack (``layer_id, nad_class`` top→base)
           that falls within that litho unit on each test.
        3. Via ``same_class_pairs``, emit a geotech edge for every (left, right)
           band pair that shares the same (non-null) NAD class — regardless of
           count or order (spec §5, 2026-06-26).  The resolver's connected-
           components then unions a recurring class within the unit into ONE
           body; the engineer splits manually.  A litho pair where no class
           matches on either side emits nothing.

        Per spec §8, a band whose ``nad_class`` is ``None`` cannot auto-connect
        and is skipped (``same_class_pairs`` already drops null-class bands).
        Canonical ``a < b`` ordering; dedup on layer-pair within this section.

        Parameters
        ----------
        geotech_model_id : UUID
            The geotech model id for the edge rows.
        section_id : UUID
            Section id tagged on each emitted edge row.
        litho_approved_edges : set[tuple[UUID, UUID]]
            Canonical ``(min_id, max_id)`` pairs of approved litho edges for
            this section.  Each pair is a correlated litho-unit pair.
        litho_layer_depths : dict[UUID, tuple[str, float, float]]
            ``litho_layer_id → (investigation_id_str, depth_top_m, depth_base_m)``
            for every accepted litho layer in the model.
        geotech_layer_by_inv_depth : dict[str, list[tuple[float, float, UUID, UUID, int | None]]]
            ``investigation_id_str →
            [(depth_top_m, depth_base_m, geotech_layer_id, geotech_formation_id, nad_class)]``
            accumulated during materialisation (all geotech sub-layers, any order).
        """
        sorted_geotech: dict[str, list[tuple[float, float, UUID, UUID, int | None]]] = {
            inv_id: sorted(intervals, key=lambda t: t[0])
            for inv_id, intervals in geotech_layer_by_inv_depth.items()
        }

        # 1 mm tolerance for geo-band divide floating-point noise.
        _DEPTH_TOL_M = 0.001

        def _stack(inv_str: str, lit_top: float, lit_base: float) -> list[tuple[str, int | None]]:
            """Geotech sub-band stack (layer_id, nad_class) within a litho unit, top->base."""
            out: list[tuple[str, int | None]] = []
            for top, base, layer_id, _fid, nad in sorted_geotech.get(inv_str, []):
                if top >= lit_top - _DEPTH_TOL_M and base <= lit_base + _DEPTH_TOL_M:
                    out.append((str(layer_id), nad))
            return out

        seen_layer_pairs: set[tuple[UUID, UUID]] = set()
        edge_count = 0
        skipped_no_litho_depth = 0
        skipped_no_class_match = 0

        for litho_a_id, litho_b_id in litho_approved_edges:
            entry_a = litho_layer_depths.get(litho_a_id)
            entry_b = litho_layer_depths.get(litho_b_id)
            if entry_a is None or entry_b is None:
                # One or both endpoints are not in the model — skip.
                skipped_no_litho_depth += 1
                continue

            inv_a_str, top_a, base_a = entry_a
            inv_b_str, top_b, base_b = entry_b

            left_stack = _stack(inv_a_str, top_a, base_a)
            right_stack = _stack(inv_b_str, top_b, base_b)

            # Spec §5: same-class connection (NOT full-sequence). Every same-class
            # pair becomes an edge; the resolver unions recurring classes into one
            # body. None-class bands are skipped inside same_class_pairs.
            aligned = same_class_pairs(left_stack, right_stack)
            if not aligned:
                if left_stack and right_stack:
                    skipped_no_class_match += 1
                continue

            for la, rb in aligned:
                # same_class_pairs already filters None-class bands (spec §8), so
                # every (la, rb) here is a real same-class pair.
                geotech_a_id = UUID(la)
                geotech_b_id = UUID(rb)
                if geotech_a_id == geotech_b_id:
                    # Same layer — intra-investigation edge (forbidden); skip.
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
            f"_derive_geotech_edges_from_litho: section={section_id} "
            f"{edge_count} geotech edge(s) derived from "
            f"{len(litho_approved_edges)} litho edge(s) "
            f"(skipped_no_depth={skipped_no_litho_depth}, "
            f"skipped_no_class_match={skipped_no_class_match})"
        )

    # ------------------------------------------------------------------
    # Formation find-or-create
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
            NAD packing class, or ``None`` for a skeleton carry-through.
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
        """Find-or-create a skeleton (``nad_class=None``) formation.

        Used for borehole-only sub-bodies temporarily before Phase 8b
        extrapolation, and as a last resort when no CPT data exists in the
        model at all.

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

    async def _load_project_sections(self, project_id: UUID) -> list[CrossSectionOrm]:
        """Load all cross-sections for the project, ordered by display_order.

        Parameters
        ----------
        project_id : UUID
            Owning project.

        Returns
        -------
        list[CrossSectionOrm]
            All project sections, ordered by display_order then name.
        """
        rows = (
            (
                await self._session.execute(
                    select(CrossSectionOrm)
                    .where(CrossSectionOrm.app_project_id == project_id)
                    .order_by(CrossSectionOrm.display_order, CrossSectionOrm.name)
                )
            )
            .scalars()
            .all()
        )
        return list(rows)

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
        """Load total depth for each investigation.

        Parameters
        ----------
        investigation_ids : set[UUID]
            Investigation UUIDs.

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
        self,
        litho_model_id: UUID,
        investigation_ids: set[UUID] | None,
    ) -> dict[UUID, tuple[str, float, float]]:
        """Load top and base depths for accepted litho layers in the model.

        When ``investigation_ids`` is ``None``, loads all accepted litho layers
        for the model (model-wide, no investigation restriction).

        Parameters
        ----------
        litho_model_id : UUID
            The litho model to query.
        investigation_ids : set[UUID] | None
            Investigation ids to restrict to, or ``None`` for all.

        Returns
        -------
        dict[UUID, tuple[str, float, float]]
            ``litho_layer_id → (investigation_id_str, depth_top_m, depth_base_m)``
            for every accepted litho layer.
        """
        stmt = select(
            LithoLayerOrm.id,
            LithoLayerOrm.borehole_id,
            LithoLayerOrm.cpt_id,
            LithoLayerOrm.depth_top_m,
            LithoLayerOrm.depth_base_m,
        ).where(
            LithoLayerOrm.model_id == litho_model_id,
            LithoLayerOrm.status == "accepted",
        )
        if investigation_ids is not None:
            stmt = stmt.where(
                LithoLayerOrm.borehole_id.in_(investigation_ids)
                | LithoLayerOrm.cpt_id.in_(investigation_ids)
            )
        rows = (await self._session.execute(stmt)).all()
        result: dict[UUID, tuple[str, float, float]] = {}
        for r in rows:
            inv_id = str(r.borehole_id if r.borehole_id is not None else r.cpt_id)
            result[r.id] = (inv_id, r.depth_top_m, r.depth_base_m)
        return result

    async def _load_approved_litho_edges(
        self, litho_model_id: UUID, section_id: UUID
    ) -> set[tuple[UUID, UUID]]:
        """Load approved litho edges for one section as canonical pairs.

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
        return {(min(a, b), max(a, b)) for a, b in rows}

    async def _read_min_thickness_m(self, project_id: UUID) -> float:
        """Read the geotech minimum sub-unit thickness from the project view-state.

        Reads ``view_state["geotech_subdivision"]["minimum_layer_thickness_m"]``
        — a GEOTECH-specific knob, distinct from the litho segmenter's, so
        coarsening packing bands never affects lithology layering.

        Parameters
        ----------
        project_id : UUID
            Owning project id.

        Returns
        -------
        float
            The configured geotech minimum thickness, or
            ``_DEFAULT_MIN_THICKNESS_M`` (0.35 m) when absent, non-positive, or
            non-numeric.
        """
        project = await ProjectRepository(self._session).get_by_id(project_id)
        view_state = project.view_state if project is not None else None
        seg = (view_state or {}).get("geotech_subdivision") or {}
        try:
            val = float(seg.get("minimum_layer_thickness_m", _DEFAULT_MIN_THICKNESS_M))
            return val if val > 0 else _DEFAULT_MIN_THICKNESS_M
        except (TypeError, ValueError):
            return _DEFAULT_MIN_THICKNESS_M

    async def _read_gradient_snap(self, project_id: UUID) -> tuple[bool, float]:
        """Read the geotech gradient-snap knobs from the project view-state.

        Returns ``(enabled, window_m)`` from
        ``view_state["geotech_subdivision"]``, defaulting to ``(True, 0.5)`` when
        absent or malformed.

        Parameters
        ----------
        project_id : UUID
            Owning project id.

        Returns
        -------
        tuple[bool, float]
            ``(gradient_snap_enabled, gradient_snap_window_m)``.
        """
        project = await ProjectRepository(self._session).get_by_id(project_id)
        seg = ((project.view_state if project is not None else None) or {}).get(
            "geotech_subdivision"
        ) or {}
        enabled = seg.get("gradient_snap_enabled", True)
        try:
            window = float(seg.get("gradient_snap_window_m", 0.5))
        except (TypeError, ValueError):
            window = 0.5
        return (bool(enabled), window if window > 0 else 0.5)

    async def _read_geotech_snap_tolerance_m(self, project_id: UUID) -> float:
        """Read the geotech geo↔litho snap tolerance from the project view-state.

        Reads ``view_state["geotech_subdivision"]["litho_snap_tolerance_m"]`` — a
        GEOTECH-specific, WIDER tolerance than the litho stage's, so a geological
        surface that crosses a litho unit within this distance of a litho contact
        snaps to the contact (no sliver) rather than dividing.

        Parameters
        ----------
        project_id : UUID
            Owning project id.

        Returns
        -------
        float
            The configured geotech snap tolerance, or
            ``_DEFAULT_GEOTECH_SNAP_TOLERANCE_M`` (0.30 m) when absent,
            non-positive, or non-numeric.
        """
        project = await ProjectRepository(self._session).get_by_id(project_id)
        view_state = project.view_state if project is not None else None
        seg = (view_state or {}).get("geotech_subdivision") or {}
        try:
            val = float(seg.get("litho_snap_tolerance_m", _DEFAULT_GEOTECH_SNAP_TOLERANCE_M))
            return val if val > 0 else _DEFAULT_GEOTECH_SNAP_TOLERANCE_M
        except (TypeError, ValueError):
            return _DEFAULT_GEOTECH_SNAP_TOLERANCE_M

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
