"""Subdivide all lithostratigraphic bodies into geotech NAD sub-bodies (Task E3).

Geotechnical stage — Slice B (spec
``docs/superpowers/specs/2026-06-23-geotech-stage-slice-1-design.md`` §0.1).

``SubdivideAllBodies`` is the **classify-and-materialise** step of the
body-centric geotech flow.  It groups the geo-bounded litho
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
   and derives geotech edges by LCS packing match within each litho body
   (``_derive_geotech_edges_from_litho``): for each correlated litho-unit pair,
   the LCS of the two NAD-class sequences is computed (``aligned_same_class_pairs``)
   and each position in the LCS becomes a geotech edge.  Bands absent from the LCS
   stay unconnected (the engineer connects those manually).  Edges are tagged with
   that section's id.
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
   All edges are PROPOSALS: ``user_approved=False``, ``source='auto'``.  The
   engineer promotes them with the section Accept-correlations verb, exactly as
   on the litho axis.  Until he does, they connect nothing — the resolver reads
   only approved edges — so a fresh subdivide leaves each packing band its own
   body, and geotech bodies span investigations only where he accepted a tie.

3. **``BodyOrm`` rows** — created by ``ResolveLithoInstances`` from the
   ACCEPTED edges; ``litho_layer.body_id`` is stamped in the same step.

Idempotency on re-run
---------------------
Before writing new rows the use case deletes the model's geotech data (not just
a corridor), so a re-run always starts from a clean state.  The geotech model
row itself is not deleted; only its content is.  See
``_delete_all_geotech_data``.

Accepted ties survive the reset by being RE-ANCHORED (owner ruling 2026-08-01).
A correlation edge names two band ids, and the rebuild gives every band a fresh
``uuid7``, so the endpoint FKs' ``ON DELETE CASCADE`` used to take every
accepted packing tie with the layer wipe — silently, without passing through
application code.  The use case therefore captures each accepted tie's endpoint
identity BEFORE the reset (``GeotechTieReanchor.capture``) and re-creates the
tie against the rebuilt bands AFTER materialisation
(``GeotechTieReanchor.reanchor``), inside the same transaction, so a failure
leaves neither half applied.  A rebuilt band **is** the old band when the
investigation, the depth interval and the NAD class all match — exactly; no
tolerance.  A tie whose band moved, changed class, or is gone cannot be
re-anchored: it is logged at WARNING with both endpoints' identities and
counted in ``lost_tie_count`` / ``lost_tie_reasons`` so the UI can say so.
The re-anchored ties are written BEFORE the per-section derivation pass, whose
dedup set is preloaded from them, so the auto pass never proposes a duplicate
of a tie that was just restored.

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

Edge derivation — LCS packing match
-------------------------------------
For each approved litho ``litho_contact_correlation_edge`` (layer_A ↔ layer_B),
the geotech sub-band stacks within that litho unit on both tests are compared.
A stack is the list of ``(layer_id, nad_class)`` tuples top→base for all geotech
sub-layers whose ``[top, base]`` interval is contained within the litho unit's
``[depth_top_m, depth_base_m]`` (1 mm tolerance for geo-band divide noise).
The LCS of the two NAD-class sequences is computed via ``aligned_same_class_pairs``;
each position in the LCS emits one geotech edge.  Bands absent from the LCS are
left unconnected (the engineer connects those manually).  Null-class bands
(skeleton / last-resort) never match per spec §8.
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
from groundmodel.application.geotech_edge_derivation import (
    EdgeDerivationCounts,
    derive_geotech_edges_from_litho,
    load_approved_litho_edges,
    load_existing_geotech_edge_pairs_by_section,
    load_litho_layer_depths,
    load_project_sections,
)
from groundmodel.application.geotech_tie_reanchor import (
    REASON_BAND_ABSENT,
    BandIdentity,
    GeotechTieReanchor,
    RebuiltBand,
    depth_to_mm,
)
from groundmodel.application.resolve_litho_instances_use_case import ResolveLithoInstances
from groundmodel.application.scope_guard import load_scoped_or_raise
from groundmodel.application.view_state_helpers import (
    load_project_view_state,
    read_view_state_float,
)
from groundmodel.domain.services.geotech_body_aggregation import (
    BandProfile,
    plan_body_subdivision,
)
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
from groundmodel.infrastructure.db.models.cpt_series_orm import CptSeriesOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.shared.constants.litho_constants import BASE_LITHOLOGIES

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
        Number of body groups that were borehole-only (no CPT qc → each
        borehole in a CPT-bearing body carries skeleton nad_class=None in SAB;
        run ``DivideBoreholes`` afterward to TIN-divide them by the CPT
        packing-transition surface).
    section_count : int
        Number of project sections processed for edge derivation.
    reanchored_tie_count : int
        Accepted packing ties carried across the rebuild — the band they point
        at came back on the same investigation, over the same depth interval,
        with the same NAD class, so the tie was re-created against it (still
        accepted, still carrying its original ``source``).
    lost_tie_count : int
        Accepted packing ties that could NOT be carried: at least one endpoint's
        band is not in the rebuild under the owner's exact three-part rule.
        Each is logged at WARNING with both endpoints' identities.
    lost_tie_reasons : dict[str, int]
        Per-reason breakdown of ``lost_tie_count`` — ``class_changed`` (the qc
        re-derived a different packing class over the same depths),
        ``interval_moved`` (a boundary shifted), ``band_absent`` (the rebuild
        no longer draws geology there), ``borehole_endpoint_deferred`` (the
        endpoint is a borehole column, whose bands ``DivideBoreholes``
        materialises after this use case runs).  A tie whose two endpoints
        failed differently is counted under each reason.
    """

    geotech_model_id: UUID
    created_formation_ids: list[UUID]
    layer_count: int
    body_count: int
    split_body_count: int
    one_class_body_count: int
    borehole_only_count: int
    section_count: int = 0
    reanchored_tie_count: int = 0
    lost_tie_count: int = 0
    lost_tie_reasons: dict[str, int] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Internal data holders (not domain DTOs — private to this module)
# ---------------------------------------------------------------------------


def _rebuilt_bands(
    geotech_layer_by_inv_depth: dict[str, list[tuple[float, float, UUID, UUID, int | None]]],
) -> list[RebuiltBand]:
    """Describe the bands the materialise phase just wrote, for the re-anchor.

    Translates the phase's ``investigation → [(top_m, base_m, layer_id,
    formation_id, nad_class)]`` accumulator into the three-part band identity
    the owner's rule matches on.

    Parameters
    ----------
    geotech_layer_by_inv_depth : dict[str, list[tuple[float, float, UUID, UUID, int | None]]]
        The materialise phase's per-investigation band accumulator.

    Returns
    -------
    list[RebuiltBand]
        One entry per band written in this run.
    """
    return [
        RebuiltBand(
            identity=BandIdentity(
                investigation_id=investigation_id,
                depth_top_mm=depth_to_mm(top_m),
                depth_base_mm=depth_to_mm(base_m),
                nad_class=nad_class,
            ),
            layer_id=layer_id,
        )
        for investigation_id, entries in geotech_layer_by_inv_depth.items()
        for top_m, base_m, layer_id, _formation_id, nad_class in entries
    ]


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
        its own qc. ``None`` means no packing transition was resolved (a borehole
        in a CPT-free body, or a CPT with no usable qc); those receive a skeleton
        formation (``nad_class=None``) — boreholes in a CPT-bearing body are
        TIN-divided into real classes by Phase 8c instead.
    """

    investigation_id: str
    anchor_kind: str
    geo_bounded_top_m: float
    geo_bounded_base_m: float
    sub_intervals: list[tuple[float, float]] = field(default_factory=list)
    nad_classes: list[int | None] = field(default_factory=list)


class SubdivideAllBodies(GeotechBoreholeMaterialiser):
    """Classify + materialise geotech spatial bodies for the whole litho model.

    Find-or-creates the geotech sibling model itself and works from the litho
    model's accepted layers + body resolver directly.

    Key design: geotech *layers* are materialised model-wide (one per
    investigation per sub-band — investigation appears in exactly one body
    group per geo-band).  Geotech correlation *edges* are derived per section,
    each tagged with that section's ``section_id``.  This prevents tie-sections
    from clobbering each other's geotech data.

    Borehole TIN-division has been extracted to the separate
    :class:`~groundmodel.application.divide_boreholes.DivideBoreholes` use case
    so that borehole bands can be re-materialised after manual packing
    correlations without wiping CPT data.  Run ``DivideBoreholes`` after this
    use case (and after any manual correlate gestures) to assign TIN-divided
    bands to borehole columns.

    The caller owns the session; this use case flushes during the write phase
    and commits once at the end.

    Parameters
    ----------
    session : AsyncSession
        Active SQLAlchemy async session.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        # Pass __name__ so the logger path reflects this module, not the base.
        super().__init__(__name__, session)

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
        geotech_model, _ = await self._ensure_geotech_model(litho_model)
        await ResolveLithoInstances(self._session).execute(model_id=litho_model_id, commit=False)
        self.info(f"SubdivideAllBodies: geotech_model={geotech_model.id} (litho bodies resolved)")

        # Phase 1b — capture the engineer's ACCEPTED packing ties BEFORE anything
        # is deleted. Their endpoints are geotech litho_layer rows that the reset
        # removes, and the edge FKs cascade, so once the wipe fires there is
        # nothing left to read: what the tie connected can only be recorded now.
        tie_reanchor = GeotechTieReanchor(self._session)
        captured_ties = await tie_reanchor.capture(geotech_model.id)

        # Phase 2 — load ALL model picks (no section restriction).
        picks = await self._litho_repo.load_body_picks(litho_model_id)
        self.info(f"SubdivideAllBodies: {len(picks)} pick(s) across whole model")
        if not picks:
            # Model-wide idempotent reset MUST run on the empty path too: a
            # rebuild after the litho picks were cleared (e.g. the litho model
            # was emptied) has no new geotech content to materialise, but any
            # geotech layers/bodies/FC mirrors/edges from a PRIOR run are now
            # stale and must be deleted — otherwise they survive the rebuild and
            # the geotech model no longer reflects the (empty) litho input
            # . Delete, commit the wipe, return zeroed.
            await self._delete_all_geotech_data(geotech_model.id)
            await self._session.commit()
            self.warning(
                "SubdivideAllBodies: no picks in the model — geotech model "
                "created/reused, prior geotech data cleared, no bodies materialised"
            )
            if captured_ties:
                # There is no rebuild on this path, so there is no band for any
                # accepted tie to re-anchor onto. Say so rather than letting the
                # cascade take them in silence.
                self.warning(
                    f"SubdivideAllBodies: {len(captured_ties)} ACCEPTED packing tie(s) "
                    f"could not be carried — the litho model has no picks, so the "
                    f"rebuild produced no bands to re-anchor them to "
                    f"(model {geotech_model.id})"
                )
            return SubdivideAllBodiesResult(
                geotech_model_id=geotech_model.id,
                created_formation_ids=[],
                layer_count=0,
                body_count=0,
                split_body_count=0,
                one_class_body_count=0,
                borehole_only_count=0,
                lost_tie_count=len(captured_ties),
                lost_tie_reasons=(
                    {REASON_BAND_ABSENT: len(captured_ties)} if captured_ties else {}
                ),
            )

        # Phase 3 — geo-bound picks (same pipeline as C1, but a wider geotech
        # snap tolerance so true near-coincident geo slivers snap to the litho
        # contact instead of carving thin geotech sub-units).
        snap_tol = await self._read_geotech_snap_tolerance_m(geotech_model.app_project_id)
        geo_surfaces = await self._load_geo_surfaces_with_formation(litho_model.parent_model_id)
        boundary_sampler = self._make_boundary_sampler(geo_surfaces)
        lowest_sampler = self._make_lowest_boundary_sampler(geo_surfaces)

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
        # immediately; boreholes in a CPT-bearing body are TIN-divided by the
        # body's CPT packing-transition surfaces in the same pass).
        created_formation_ids: list[UUID] = []
        classified_by_key: dict[tuple[int, UUID, UUID | None], GeologicalFormationOrm] = {}
        skeleton_by_key: dict[tuple[UUID, UUID | None], GeologicalFormationOrm] = {}

        total_layers = 0
        split_body_count = 0
        one_class_body_count = 0
        borehole_only_count = 0
        # Materialise-phase counters (L6).
        cpt_band_count = 0
        skeleton_band_count = 0
        skipped_empty_plan_count = 0

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
            # ``profile_by_seg_key`` is keyed by ``(investigation_id, top_depth_m)``
            # so a CPT with multiple segments in the same body group (e.g. two
            # non-adjacent ZAND layers correlated transitively to the same body)
            # always receives the profile computed for ITS OWN depth window — a
            # plain ``investigation_id``-only dict would overwrite the first entry
            # with the second, causing the first segment's splits to clamp entirely
            # outside its depth range and fall back to skeleton (nad_class = None).
            profiles: list[BandProfile] = []
            profile_by_seg_key: dict[tuple[str, float], BandProfile] = {}
            for seg in cpt_segs:
                series = cpt_series.get(UUID(seg.investigation_id))
                if series is None:
                    self.debug(
                        f"SubdivideAllBodies: inv={seg.investigation_id} "
                        f"seg_top={seg.top_depth_m:.2f}m → skeleton band "
                        "(no qc series row in DB)"
                    )
                    bp = BandProfile(investigation_id=seg.investigation_id, splits=[])
                    profiles.append(bp)
                    profile_by_seg_key[(seg.investigation_id, seg.top_depth_m)] = bp
                    continue
                if soil_code is None or soil_code not in BASE_LITHOLOGIES:
                    self.debug(
                        f"SubdivideAllBodies: inv={seg.investigation_id} "
                        f"seg_top={seg.top_depth_m:.2f}m → skeleton band "
                        f"(soil_code={soil_code!r} not in BASE_LITHOLOGIES)"
                    )
                    bp = BandProfile(investigation_id=seg.investigation_id, splits=[])
                    profiles.append(bp)
                    profile_by_seg_key[(seg.investigation_id, seg.top_depth_m)] = bp
                    continue
                splits = suggest_geotech_subdivision(
                    soil=soil_code,
                    admixtures=admixtures,
                    depth_m=series.depths_m,
                    qc_mpa=series.qc_mpa,
                    segment_top_m=seg.top_depth_m,
                    segment_base_m=seg.base_depth_m,
                    min_thickness_m=min_thickness_m,
                    gradient_snap=gradient_snap,
                    gradient_snap_window_m=gradient_snap_window_m,
                )
                bp = BandProfile(investigation_id=seg.investigation_id, splits=splits)
                profiles.append(bp)
                profile_by_seg_key[(seg.investigation_id, seg.top_depth_m)] = bp

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

            # Build a per-column plan for CPT segments only.
            # Borehole columns are handled separately via TIN-based division.
            cpt_column_plans = self._build_column_plans(
                group_segs=cpt_segs,
                anchor_kind=anchor_kind,
                profile_by_seg_key=profile_by_seg_key,
            )

            # Phase 8 CPT pass — materialise one band per CPT's own A3 splits.
            # Borehole TIN-division is now a separate step (DivideBoreholes),
            # run AFTER manual packing correlations so borehole bands reflect
            # the final body membership.
            for col_plan in cpt_column_plans:
                if not col_plan.sub_intervals:
                    skipped_empty_plan_count += 1
                    continue
                inv_id = col_plan.investigation_id
                inv_uuid = UUID(inv_id)

                for k, (top_m, base_m) in enumerate(col_plan.sub_intervals):
                    nad_class = col_plan.nad_classes[k] if k < len(col_plan.nad_classes) else None
                    if nad_class is None:
                        # CPT with no usable qc — one skeleton band.
                        skeleton_band_count += 1
                        formation = await self._find_or_create_skeleton(
                            project_id=project_id,
                            skeleton_by_key=skeleton_by_key,
                            source_litho_formation_id=source_litho_fid,
                            source_geo_formation_id=source_geo_fid,
                        )
                    else:
                        cpt_band_count += 1
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
                        cpt_id=inv_uuid,
                    )
                    self._session.add(layer)
                    geotech_layer_by_inv_depth[inv_id].append(
                        (top_m, base_m, layer.id, formation.id, nad_class)
                    )
                    total_layers += 1

            await self._session.flush()

        # Phase 8 summary — materialise totals across all groups.
        self.info(
            f"SubdivideAllBodies: Phase-8 CPT materialise complete — "
            f"cpt_bands={cpt_band_count} skeleton_bands={skeleton_band_count} "
            f"skipped_empty_plan={skipped_empty_plan_count}"
        )

        # Phase 8c — re-anchor the accepted ties captured in Phase 1b onto the
        # bands just rebuilt. This runs BEFORE the derivation pass so the pass's
        # per-section dedup set (loaded below) already carries the restored ties
        # and cannot stack an unapproved proposal beside one of them.
        reanchor_plan = await tie_reanchor.reanchor(
            geotech_model_id=geotech_model.id,
            captured=captured_ties,
            rebuilt_bands=_rebuilt_bands(geotech_layer_by_inv_depth),
        )

        # Phase 9 — load all project sections; derive geotech edges per section.
        # This pass sees ONLY the CPT geotech bands (materialised above); a litho
        # edge with a borehole endpoint finds an empty geotech stack and is
        # skipped here. DivideBoreholes re-runs the SAME shared derivation after
        # it materialises the borehole bands, adding the borehole-mediated edges
        # (groundmodel.application.geotech_edge_derivation).
        sections = await load_project_sections(self._session, project_id)
        self.info(
            f"SubdivideAllBodies: deriving edges for {len(sections)} section(s) "
            f"[{time.monotonic() - t0:.1f}s]"
        )

        # Build the model-wide litho layer depth index once (all accepted litho
        # layers across all investigations — no section restriction).
        litho_layer_depths = await load_litho_layer_depths(self._session, litho_model_id, None)
        self.debug(
            f"SubdivideAllBodies: {len(litho_layer_depths)} litho layer depth entries loaded"
        )

        # Per-section dedup, preloaded with the ties Phase 8c just restored (the
        # only edges in the model at this point — the reset emptied the rest).
        # Without the preload the derivation would re-propose a band pair an
        # accepted tie already joins, and the pair would carry two edges.
        seen_pairs_by_section = await load_existing_geotech_edge_pairs_by_section(
            self._session, geotech_model.id
        )

        edge_totals = EdgeDerivationCounts()
        sections_with_edges = 0
        for section in sections:
            litho_approved_edges = await load_approved_litho_edges(
                self._session, litho_model_id, section.id
            )
            if not litho_approved_edges:
                continue
            sections_with_edges += 1
            self.debug(
                f"SubdivideAllBodies: section={section.id} ({section.name!r}) "
                f"{len(litho_approved_edges)} approved litho edge(s)"
            )
            edge_totals.add(
                await derive_geotech_edges_from_litho(
                    self._session,
                    self,
                    geotech_model_id=geotech_model.id,
                    section_id=section.id,
                    litho_approved_edges=litho_approved_edges,
                    litho_layer_depths=litho_layer_depths,
                    geotech_layer_by_inv_depth=geotech_layer_by_inv_depth,
                    seen_layer_pairs=seen_pairs_by_section.setdefault(section.id, set()),
                )
            )
        self.info(
            f"SubdivideAllBodies: {edge_totals.edges_emitted} geotech edge(s) emitted "
            f"(skipped_empty_stack={edge_totals.skipped_empty_stack} — borehole-mediated, "
            f"deferred to DivideBoreholes; skipped_no_lcs={edge_totals.skipped_no_lcs})"
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
            section_count=sections_with_edges,
            reanchored_tie_count=len(reanchor_plan.matched),
            lost_tie_count=len(reanchor_plan.lost),
            lost_tie_reasons=reanchor_plan.loss_reason_counts(),
        )
        self.success(
            f"SubdivideAllBodies: geotech_model={geotech_model.id} "
            f"layers={total_layers} bodies={body_count} "
            f"split={split_body_count} one_class={one_class_body_count} "
            f"borehole_only={borehole_only_count} "
            f"sections_with_edges={sections_with_edges}/{len(sections)} "
            f"accepted_ties_reanchored={len(reanchor_plan.matched)}/{len(captured_ties)} "
            f"accepted_ties_lost={len(reanchor_plan.lost)} "
            f"elapsed={elapsed:.1f}s"
        )
        return result

    # ------------------------------------------------------------------
    # Phase 4 — model-wide idempotent reset
    # ------------------------------------------------------------------

    async def _delete_all_geotech_data(self, geotech_model_id: UUID) -> None:
        """Delete the model's prior geotech layers, edges, FC rows, and bodies.

        Scoped to the entire geotech model (not a corridor subset), so that
        re-running the model-wide subdivide always starts from a clean state.
        Order: dirty edges → layers (LL→FC trigger cleans their FC mirrors) →
        direct FC rows written by C1 → bodies.

        Every edge of the model is gone once this returns — the accepted ones
        too, taken by the endpoint FK cascade.  They come back: the caller
        captured them before calling this
        (:meth:`GeotechTieReanchor.capture`) and re-creates each one against the
        rebuilt band that matches its investigation, depth interval and NAD
        class (:meth:`GeotechTieReanchor.reanchor`), in this same transaction.

        Parameters
        ----------
        geotech_model_id : UUID
            The geotechnical model to wipe clean.
        """
        # 1. Delete the DIRTY correlation edges — everything the program derived
        # and the engineer never accepted.  Accepted ties are spared by this
        # statement (the machine never deletes what the user accepted), but see
        # step 2: the cascade takes them anyway, and the re-anchor pass — not
        # this predicate — is what actually carries them across the rebuild.
        await self._session.execute(
            delete(LithoContactCorrelationEdgeOrm).where(
                LithoContactCorrelationEdgeOrm.model_id == geotech_model_id,
                LithoContactCorrelationEdgeOrm.user_approved.is_(False),
            )
        )

        # 2. Delete all litho_layer rows (LL→FC trigger removes their FC mirrors).
        #
        # This also destroys the edges step 1 spared.  A geotech edge's endpoints
        # (layer_a_id / layer_b_id) are geotech litho_layer rows — the very rows
        # this statement removes — and both FKs are ON DELETE CASCADE
        # (litho_contact_correlation_edge_orm.py:155,160), so Postgres deletes
        # every spared edge as a side effect of this line, without a rowcount
        # and without passing through any application code.
        #
        # No WHERE clause can prevent that: the rebuild re-derives every band
        # with a fresh uuid7, so the rows an accepted tie points at genuinely
        # cease to exist.  The tie is preserved one level up instead — captured
        # by identity before this runs, re-created against the matching rebuilt
        # band afterwards (owner ruling 2026-08-01: same investigation, same
        # depth interval, same NAD class).
        await self._session.execute(
            delete(LithoLayerOrm).where(LithoLayerOrm.model_id == geotech_model_id)
        )

        # 2b. Delete any remaining FormationContact rows for the geotech model.
        # The retired C1 skeleton flow wrote FC rows DIRECTLY (not via the
        # LL→FC trigger), so step 2's trigger-based cleanup does not remove
        # them; projects built before #237.2 may still carry such rows.
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
    # Phase 6 — column plan builder
    # ------------------------------------------------------------------

    def _build_column_plans(
        self,
        *,
        group_segs: list[BodyLayerPick],
        anchor_kind: dict[str, str],
        profile_by_seg_key: dict[tuple[str, float], BandProfile],
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
            All geo-bounded segment picks for the group (CPT segments only when
            called from the main loop; each seg is a unique ``(investigation_id,
            top_depth_m)`` pair).
        anchor_kind : dict[str, str]
            ``investigation_id (str) -> "borehole" | "cpt"``.
        profile_by_seg_key : dict[tuple[str, float], BandProfile]
            Per-segment packing profiles keyed by ``(investigation_id,
            top_depth_m)``.  Using the segment's top depth as part of the key
            ensures that a CPT with multiple segments in the same body group
            (each with a distinct depth window) always retrieves its OWN profile
            — a plain ``investigation_id``-only dict would silently overwrite the
            first entry with the second.

        Returns
        -------
        list[_ColumnPlan]
            One entry per column in the group, carrying per-band NAD classes.
        """
        col_plans: list[_ColumnPlan] = []

        for seg in group_segs:
            kind = anchor_kind.get(seg.investigation_id, "borehole")
            geo_top = seg.top_depth_m
            geo_base = seg.base_depth_m
            if geo_base <= geo_top:
                continue

            sub_intervals: list[tuple[float, float]] = []
            nad_classes: list[int | None] = []

            # Safe float key: ``seg`` here is the same frozen BodyLayerPick
            # instance that populated ``profile_by_seg_key`` (no arithmetic
            # between set and get), so ``top_depth_m`` matches exactly.
            profile = profile_by_seg_key.get((seg.investigation_id, seg.top_depth_m))
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
        view_state = await load_project_view_state(self._session, project_id)
        return read_view_state_float(
            view_state,
            "geotech_subdivision",
            "minimum_layer_thickness_m",
            _DEFAULT_MIN_THICKNESS_M,
        )

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
        view_state = await load_project_view_state(self._session, project_id)
        bag = (view_state or {}).get("geotech_subdivision") or {}
        enabled = bool(bag.get("gradient_snap_enabled", True))
        window = read_view_state_float(
            view_state, "geotech_subdivision", "gradient_snap_window_m", 0.5
        )
        return (enabled, window)

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
