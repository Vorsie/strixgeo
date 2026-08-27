"""Subdivide all lithostratigraphic bodies into geotech NAD sub-bodies (Task E3).

Geotechnical stage — Slice B (spec
``docs/superpowers/specs/2026-06-23-geotech-stage-slice-1-design.md`` §0.1).

``SubdivideAllBodies`` is the **classify-and-materialise** step of the
body-centric geotech flow.  It groups the litho
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
2. Loads the picks of every investigation IN SCOPE — on any cross-section for
   the model-wide press, on ONE for the section-scoped press.
3. **Idempotent reset over exactly what will be rebuilt** — edges → layers →
   FC rows → bodies.  The model-wide press clears the whole geotech model; a
   section-scoped press clears only that section's members and leaves every
   other column's bands, ties and bodies standing, so two sections can be
   subdivided at the same time (owner ruling 2026-08-15).
4. Groups geo-bounded segments by ``(body_id, source_geo_formation_id)``
   across the whole model.
5. Classifies each group (CPT-bearing: B-policy; borehole-only: deferred to
   step 6b extrapolation).
6. Materialises ``litho_layer`` rows ONCE per (investigation, sub-band) —
   each investigation appears in at most one group per geo-band so there is
   no double-materialisation.
6b. **Borehole columns are left unclassified here** (``nad_class=None``) —
    ``DivideBoreholes`` classifies them later, from donors the engineer's own
    ties and the section flanks name.  Every donor rule there is SAME-SOIL:
    a packing class describes one soil column, so no borehole ever borrows
    one from a test of another lithology (owner ruling 2026-08-26, *"no a
    zand body can never carry a silt packing class"*).
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
   Approval per the owner's 2026-08-06 refinement of ruling A: an edge is
   born ACCEPTED only when it RESTATES a direct litho tie (the top sub-band
   pair — same contact surfaces the engineer tied); the packing-density
   pairs inside the body and every bridged jump pair arrive PENDING for the
   accept/reject flow and the divide gate.  ``source='auto'`` on all.

3. **``BodyOrm`` rows** — created by ``ResolveLithoInstances`` from the
   ACCEPTED edges; ``litho_layer.body_id`` is stamped in the same step.

Idempotency on re-run
---------------------
Before writing new rows the use case deletes the geotech data it is about to
re-create, so a re-run always starts from a clean state — the whole model when
the run is model-wide, that section's members when it is scoped.  The geotech
model row itself is never deleted; only its content is.  See
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

Boreholes are not classified in this use case
----------------------------------------------
Boreholes carry lithology but not packing class (no qc series), and this use
case does not guess one for them: every borehole column leaves here with
``nad_class=None``.  ``DivideBoreholes`` classifies them afterwards, so the
bands reflect the ties accepted since the last press.

The rule it applies is SAME-SOIL throughout — donors are filtered by
``litho_main_soil_code`` (``layer_donor_picks``), the conservative floors are
derived from the unit's own soil (``loosest_class_for``), and a class from
another soil family never reaches a band.  There is no "nearest CPT of any
lithology" fallback: a silt's firmness is not evidence about a sand, so where
no same-soil column speaks the answer is the soil's own floor, not a
neighbour's class.

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
from collections.abc import Collection
from dataclasses import dataclass, field
from uuid import UUID

from sqlalchemy import ColumnElement, delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.body_partition_lock import lock_body_partition
from groundmodel.application.geotech_borehole_materialiser import GeotechBoreholeMaterialiser
from groundmodel.application.geotech_edge_derivation import (
    EdgeDerivationCounts,
    bridge_edges_over_bandless_columns,
    derive_geotech_edges_from_litho,
    load_accepted_geotech_sided_edges_by_section,
    load_approved_litho_edge_sets,
    load_existing_geotech_edge_pairs_by_section,
    load_existing_geotech_sided_edges_by_section,
    load_litho_layer_depths,
    load_project_sections,
)
from groundmodel.application.geotech_tie_reanchor import (
    REASON_BAND_ABSENT,
    GeotechTieReanchor,
    rebuilt_bands_from_layer_index,
)
from groundmodel.application.geotech_tie_tombstones import build_tombstone_gates
from groundmodel.application.geotech_view_state import read_geotech_min_thickness_m
from groundmodel.application.orphan_formation_sweep import OrphanFormationSweep
from groundmodel.application.resolve_litho_instances_use_case import ResolveLithoInstances
from groundmodel.application.scope_guard import load_scoped_or_raise
from groundmodel.application.section_membership import (
    load_investigation_labels,
    load_investigation_names,
    load_members_by_section,
    load_section_member_investigation_ids,
)
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
from groundmodel.domain.services.litho_geo_bounding import mark_and_truncate_shallow_tests
from groundmodel.domain.services.representative_statistic import REPRESENTATIVE_STATISTICS
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
        Accepted packing ties carried across the rebuild, re-created against the
        band they point at (still accepted, still carrying their original
        ``source``).  Includes the ties counted in ``review_tie_reasons``.
    review_tie_reasons : dict[str, int]
        Carried ties whose anchor could not be identified with confidence,
        broken down by why — ``class_changed`` (nothing of the tie's own packing
        class overlaps its old depths any more) or ``ambiguous_band`` (several
        same-class bands do).  These are re-created against the band covering
        most of where the tie used to be and stamped with ``review_reason`` so
        the engineer confirms or deletes them.  They are NOT losses: the owner's
        rule is that an accepted tie never disappears without them deleting it.
    lost_tie_count : int
        Accepted packing ties that could NOT be carried at all — at least one
        endpoint has no rebuilt band overlapping it anywhere.  Each is logged at
        WARNING with both endpoints' identities.
    lost_tie_reasons : dict[str, int]
        Per-reason breakdown of ``lost_tie_count`` — ``class_changed`` (the qc
        re-derived a different packing class over the same depths),
        ``interval_moved`` (a boundary shifted), ``band_absent`` (the rebuild
        no longer draws geology there), ``borehole_endpoint_deferred`` (the
        endpoint is a borehole column, whose bands ``DivideBoreholes``
        materialises after this use case runs).  A tie whose two endpoints
        failed differently is counted under each reason.
    lost_tie_labels : list[str]
        One line per lost tie naming BOTH investigations and the depth of each
        endpoint (``"GEO-22/115-S10 4.20-6.10 m <-> BH-3 4.00-5.90 m"``).  The
        count alone tells the engineer that accepted work vanished and nothing
        about WHERE to redraw it (audit 2026-08-02).
    edges_derived : bool
        Whether this run also proposed packing ties (pipeline step 2).  The
        combined legacy verb says ``True``; the step-1-only verb says ``False``
        so the caller can tell the engineer that auto-correlate is his next
        press rather than leaving him to guess why no ties appeared.
    proposed_tie_count : int
        Packing ties this run PROPOSED — unapproved suggestions, not accepted
        work.  ``0`` whenever ``edges_derived`` is ``False``.
    skipped_existing_count : int
        Columns imported as-is because they already carried geotech bands
        (owner ruling 2026-08-18, ``skip_existing`` — the first subdivision
        wins; a tie section must not tell a second story).
    skipped_off_section_count : int
        Investigations that carry accepted litho layers but appear on NO
        cross-section in scope, and were therefore left out of the geotech
        model (owner ruling 2026-08-15).  Reported so the caller can say the
        model came out smaller on purpose — a silent skip is exactly the kind
        of thing that surfaces in an export instead.
    skipped_off_section_labels : list[str]
        The names of those investigations.  A count alone cannot be acted on;
        the names tell the engineer which columns to put on a section.
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
    review_tie_reasons: dict[str, int] = field(default_factory=dict)
    lost_tie_count: int = 0
    lost_tie_reasons: dict[str, int] = field(default_factory=dict)
    lost_tie_labels: list[str] = field(default_factory=list)
    edges_derived: bool = True
    proposed_tie_count: int = 0
    skipped_off_section_count: int = 0
    skipped_existing_count: int = 0
    skipped_off_section_labels: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Internal data holders (not domain DTOs — private to this module)
# ---------------------------------------------------------------------------


def _mm_clamped_intervals(
    splits: list,
    geo_top_m: float,
    geo_base_m: float,
) -> tuple[list[tuple[float, float]], list[int | None]]:
    """Clamp a segment's A3 splits into its geo-bounded extent, on the mm grid.

    The splits arrive mm-rounded (the build rounds at emit); the geo bounds arrive
    RAW from TIN interpolation. Clamping rounded edges against raw bounds put the
    band above and the band below a segment boundary on different values of the
    same physical depth — 72 of 479 adjacent pairs on the owner's model carried a
    sub-mm no-band sliver, and the drag-merge 422d at half of them because the
    landing "fell outside the pair" (audit F13). Rounding the BOUNDS first puts
    every edge on the same millimetre grid: two segments sharing a boundary share
    its rounded value, so their bands meet exactly.

    A band may thereby extend up to half a millimetre past the raw TIN surface —
    three orders of magnitude inside the DB contiguity tolerance (1 cm) and far
    below anything a render or export resolves.

    Parameters
    ----------
    splits : list
        The segment's ``GeotechSplit``s, mm-rounded, tiling the segment.
    geo_top_m, geo_base_m : float
        The geo-bounded extent, raw.

    Returns
    -------
    tuple[list[tuple[float, float]], list[int | None]]
        The clamped ``(top, base)`` intervals and their classes, parallel; empty
        when the extent degenerates on the mm grid.
    """
    top_r = round(geo_top_m, 3)
    base_r = round(geo_base_m, 3)
    intervals: list[tuple[float, float]] = []
    classes: list[int | None] = []
    for sp in splits:
        top_m = max(sp.depth_top_m, top_r)
        base_m = min(sp.depth_base_m, base_r)
        if base_m - top_m > 1e-6:
            intervals.append((top_m, base_m))
            classes.append(sp.nad_class)
    return intervals, classes


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
    litho_layer_id : str | None
        The accepted litho band this column plan subdivides (one plan per
        segment). Stamped onto every band's ``parent_litho_layer_id`` so the
        Parameters tree can place the band under its litho body. ``None`` when
        the segment carried no layer id (defensive — every real pick has one).
    """

    investigation_id: str
    anchor_kind: str
    geo_bounded_top_m: float
    geo_bounded_base_m: float
    sub_intervals: list[tuple[float, float]] = field(default_factory=list)
    nad_classes: list[int | None] = field(default_factory=list)
    litho_layer_id: str | None = None


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
        derive_edges: bool = True,
        section_id: UUID | None = None,
        representative_statistic: str | None = None,
        skip_existing: bool = False,
    ) -> SubdivideAllBodiesResult:
        """Subdivide the model's on-section bodies and materialise geotech bodies.

        Processes the litho model in one transaction.  Geotech layers are
        written once per investigation (section-independent); geotech edges are
        per-section (each section's approved litho edges are mapped to geotech
        sub-layers and tagged with that section's id).

        **Membership rule** (owner ruling 2026-08-15): only investigations that
        appear on a cross-section take part.  A CPT on no section cannot be
        drawn, correlated or corrected in the section view, so subdividing it
        would put bands in the model that nobody can reach — yet they would
        still enter the resolver, the 3-D build and every export.

        **A scoped run only WIPES what it rebuilds** (owner ruling 2026-08-15,
        the morning after the scoping landed: *"I didn't ask for the on all
        sections option, it's ugly and confusing delete it and keep only on
        this section"*).  With the all-sections escape gone, the scoped press is
        the only press there is, so a reset that still cleared the whole geotech
        model would mean subdividing CS1 stripped CS2 and no project could ever
        hold two subdivided sections at once.  With a ``section_id`` the
        destructive phase is therefore limited to that section's MEMBERS —
        their geotech layers and the edges hanging off them — and every other
        investigation's bands, ties and bodies are left exactly as they were.
        Without one, the historic wholesale rebuild is unchanged.

        An investigation that sits on TWO sections is legitimately rebuilt when
        EITHER of them is subdivided: its bands come from its own qc and its
        body membership, not from the section it is being viewed on, so
        rebuilding it from either side produces the same rows.  What must
        survive is the neighbour section's ties onto it, which the re-anchor
        carries (its endpoints are captured whenever ONE of them is in scope).

        Two phases stay model-wide by nature and are deliberately NOT scoped:
        the body resolver, which is idempotent and must see the whole edge
        graph to number instances consistently; and the geotech formation
        find-or-create, whose rows are shared by every column of the same class.

        Parameters
        ----------
        project_id : UUID
            Project scope guard — the litho model must belong to this project.
        litho_model_id : UUID
            The lithostratigraphic model to subdivide.  Must be
            ``kind='lithostratigraphic'``.
        section_id : UUID | None
            Restrict the rebuild — and the delete that precedes it — to the
            investigations on ONE section.  ``None`` (the default) takes every
            investigation on ANY section — the historic breadth minus the
            off-section ones the membership rule excludes in both modes.
        derive_edges : bool
            Whether to run the per-section packing-tie derivation (Phase 9).
            ``True`` — the historic behaviour — keeps the combined verb doing
            steps 1 AND 2 of the four-step pipeline, so the old endpoint stays
            usable.  ``False`` is the pipeline's step 1, *"subdivide CPTs into
            packing — bands only, NO edge derivation"* (owner ruling
            2026-08-04); the engineer then presses auto-correlate to get
            proposals he can review before accepting them.  Accepted ties are
            re-anchored either way: carrying the engineer's own work across a
            rebuild is not edge *derivation*.
        representative_statistic : str | None
            Create the geotech model under this representative-qc choice
            (owner ruling 2026-08-15: *"i can't choose harmonic qc before
            first subdivide, that's friction we don't need?"*).  The choice
            lives on the geotech model, which does not exist until this call
            makes it — so without this the engineer had to build everything
            under the default and re-run.  Applied ONLY when this call creates
            the model: on a re-run the model's own choice stands, and
            ``SetGeotechStatistic`` remains the single writer of a change.

        Returns
        -------
        SubdivideAllBodiesResult
            Geotech model id + per-phase counts.

        Raises
        ------
        ValueError
            When the litho model is missing / out of project, or
            *representative_statistic* is not a known token.
        """
        t0 = time.monotonic()
        self.info(
            f"SubdivideAllBodies: litho_model={litho_model_id} "
            f"scope={section_id or 'all sections'} derive_edges={derive_edges} "
            f"requested_statistic={representative_statistic or 'model default'}"
        )
        # Validated BEFORE anything is loaded: a token the classifier does not
        # know must never fall back to median silently — a whole model built
        # under a statistic nobody asked for is the kind of thing that is only
        # noticed in an export.
        if (
            representative_statistic is not None
            and representative_statistic not in REPRESENTATIVE_STATISTICS
        ):
            raise ValueError(
                f"Unknown representative statistic {representative_statistic!r} — "
                f"expected one of {REPRESENTATIVE_STATISTICS}"
            )

        litho_model = await load_scoped_or_raise(
            self._session,
            GeologicalModelOrm,
            litho_model_id,
            project_id,
            label="Litho model",
        )

        # TAKE THE PARTITION LOCKS BEFORE THE FIRST WRITE, not after it. This
        # verb rewrites TWO body partitions — the litho model's (the Phase-1
        # resolver) and the geotech child's (Phase 4's reset, Phase 8's inserts,
        # the Phase-10 resolver) — and it used to take each lock only inside
        # ``ResolveLithoInstances``, by which point this transaction had already
        # deleted and inserted layers unguarded. Those writes raced the debounced
        # background ``bodies/recompute``, which UPDATEs ``litho_layer.body_id``
        # over the same rows in a different order (owner dogfeed 2026-08-23:
        # DeadlockDetectedError on ``DELETE FROM litho_layer``). Both locks are
        # re-entrant per session, so the two resolvers' later acquisitions stay
        # free.
        #
        # Read the geotech child's id HERE rather than reusing
        # ``_ensure_geotech_model``: that helper may INSERT and flush, and a
        # flush before the lock is exactly the hole being closed.
        existing_geotech_id = (
            (
                await self._session.execute(
                    select(GeologicalModelOrm.id).where(
                        GeologicalModelOrm.parent_model_id == litho_model.id,
                        GeologicalModelOrm.kind == "geotechnical",
                    )
                )
            )
            .scalars()
            .first()
        )
        # LITHO PARENT FIRST, THEN THE GEOTECH CHILD — the one multi-model lock
        # order, stated once in ``body_partition_lock``. Two holders taking this
        # pair in opposite orders would deadlock on the locks themselves.
        to_lock = [litho_model_id]
        if existing_geotech_id is not None:
            to_lock.append(existing_geotech_id)
        for locked_model_id in to_lock:
            await lock_body_partition(
                self._session, model_id=locked_model_id, operation="subdivide-all-bodies"
            )

        # Phase 1 — ensure the geotech model + resolve litho body_id stamps.
        geotech_model, geotech_model_created = await self._ensure_geotech_model(litho_model)
        # A geotech model born in THIS transaction has an id no other session can
        # know yet, so this take never waits and cannot invert the order above.
        # Re-entrant when the loop already took it.
        await lock_body_partition(
            self._session, model_id=geotech_model.id, operation="subdivide-all-bodies"
        )
        # The pre-model choice, applied at the ONE moment it can be: creation.
        # A re-run deliberately ignores it — the model's own choice is what
        # every band on screen was classified with, and letting a request body
        # overwrite it would re-classify the whole model from a stale renderer.
        if representative_statistic is not None:
            if geotech_model_created:
                geotech_model.representative_statistic = representative_statistic
                self.info(
                    f"SubdivideAllBodies: geotech model created under "
                    f"representative_statistic={representative_statistic}"
                )
            else:
                self.info(
                    f"SubdivideAllBodies: requested statistic "
                    f"{representative_statistic!r} IGNORED — geotech model "
                    f"{geotech_model.id} already exists and keeps "
                    f"{geotech_model.representative_statistic!r} "
                    f"(change it via POST .../geotech/statistic)"
                )
        await ResolveLithoInstances(self._session).execute(model_id=litho_model_id, commit=False)
        self.info(f"SubdivideAllBodies: geotech_model={geotech_model.id} (litho bodies resolved)")

        # Phase 2 — load the model's picks, then keep only the ones IN SCOPE.
        #
        # The membership rule (owner ruling 2026-08-15) is applied HERE, on the
        # picks, rather than by restricting the query: the difference between
        # the two sets is exactly the report the engineer needs — which of his
        # interpreted columns were left out, and why his model came back
        # smaller than the sidebar's investigation count.
        #
        # Two membership sets, deliberately: ``members`` is what this RUN
        # rebuilds; ``all_members`` is what the MODEL admits at all. The skip
        # report is measured against the latter, because a column on another
        # section is not "left out of the model" — this press simply did not
        # touch it, and its bands are still there.
        all_picks = await self._litho_repo.load_body_picks(litho_model_id)
        members = await load_section_member_investigation_ids(
            self._session, project_id=project_id, section_id=section_id
        )
        all_members = (
            members
            if section_id is None
            else await load_section_member_investigation_ids(
                self._session, project_id=project_id, section_id=None
            )
        )
        # What the destructive phase is allowed to touch. ``None`` is the
        # wholesale rebuild; a set is "these columns and nothing else".
        scoped_members: set[UUID] | None = None if section_id is None else members
        picks = [pick for pick in all_picks if UUID(pick.investigation_id) in members]
        off_section_ids = {UUID(pick.investigation_id) for pick in all_picks} - all_members
        skipped_labels: list[str] = []
        if off_section_ids:
            names = await load_investigation_names(self._session, off_section_ids)
            skipped_labels = sorted(names.get(inv_id, str(inv_id)) for inv_id in off_section_ids)
            # NAMES, at INFO: a model that silently came out smaller is the
            # class of surprise that only shows up in an export. Note that
            # "off-section" here also covers a column the section EXCLUDES —
            # project_investigations_onto_section honours excluded_cpt_ids.
            self.info(
                f"SubdivideAllBodies: {len(off_section_ids)} interpreted column(s) skipped — "
                f"they project onto no cross-section in the project: "
                f"{', '.join(skipped_labels)}"
            )

        # Phase 2a-skip (owner ruling 2026-08-18): *"does this test already have
        # a subdivision? if yes import and skip"*. A test is usually subdivided
        # once BEFORE the tie section, and a later press on a section that
        # shares it must not tell a second story — the FIRST subdivision wins.
        # A column that already carries geotech bands is imported as-is: its
        # picks leave the build, and the destructive phase's scope narrows so
        # neither its bands nor its ties are touched. Boreholes are protected
        # the same way (they carry no picks, but the scoped delete would take
        # their bands).
        skipped_existing_count = 0
        if skip_existing:
            banded_rows = await self._session.execute(
                select(LithoLayerOrm.cpt_id, LithoLayerOrm.borehole_id).where(
                    LithoLayerOrm.model_id == geotech_model.id
                )
            )
            banded = {c or b for c, b in banded_rows if (c or b) is not None}
            protected = (members if scoped_members is None else scoped_members) & banded
            if protected:
                skipped_existing_count = len(protected)
                picks = [pick for pick in picks if UUID(pick.investigation_id) not in protected]
                scoped_members = (members if scoped_members is None else scoped_members) - protected
                self.info(
                    f"SubdivideAllBodies: {skipped_existing_count} already-subdivided "
                    f"column(s) imported as-is and skipped (skip_existing)"
                )

        # Phase 2b — capture the engineer's ACCEPTED packing ties BEFORE anything
        # is deleted. Their endpoints are geotech litho_layer rows that the reset
        # removes, and the edge FKs cascade, so once the wipe fires there is
        # nothing left to read: what the tie connected can only be recorded now.
        # It runs after phase 2 rather than before it because the scope it needs
        # — which columns this run rebuilds — is what phase 2 works out.
        #
        # A scoped run deletes only its own columns, so only the ties with an
        # endpoint on one of THOSE are at risk; a tie entirely on another
        # section keeps its row and both its endpoints and must not be captured
        # (re-creating it would double it, and counting it would claim this verb
        # carried work it never endangered).
        tie_reanchor = GeotechTieReanchor(self._session)
        captured_ties = await tie_reanchor.capture(
            geotech_model.id, restrict_to_investigation_ids=scoped_members
        )
        self.info(
            f"SubdivideAllBodies: {len(picks)} pick(s) on section "
            f"(of {len(all_picks)} in the litho model)"
        )
        if not picks:
            # The idempotent reset MUST run on the empty path too: a rebuild
            # after the litho picks were cleared (e.g. the litho model was
            # emptied) has no new geotech content to materialise, but any
            # geotech layers/bodies/FC mirrors/edges from a PRIOR run are now
            # stale and must be deleted — otherwise they survive the rebuild and
            # the geotech model no longer reflects the (empty) litho input
            # . Delete, commit the wipe, return zeroed.  Scoped exactly like the
            # main path: an empty section clears its own columns, never the
            # neighbour's.
            await self._delete_all_geotech_data(geotech_model.id, restrict_to=scoped_members)
            if section_id is None and skipped_existing_count == 0:
                # Nothing was classified, so nothing can be stale: clear the
                # stamp to the never-subdivided state the migration deliberately
                # leaves NULL. Left behind, it makes a later statistic change
                # advertise "re-run under <statistic>" over bands that no longer
                # exist — and pressing the verb re-enters this path, so the tag
                # could not clear.  A SCOPED empty run leaves the stamp alone:
                # the other sections' bands are still there and were classified
                # with it.
                geotech_model.classified_with_statistic = None
            # Debt #266 — the wipe took bands away, so the provenance map must
            # stop vouching for the columns it took them from. Nothing was
            # rebuilt, so this stamps nothing: it prunes the map down to the
            # columns that still carry bands. A stale count that includes an
            # empty column sends the engineer to press a verb with nothing to do.
            await self._stamp_litho_provenance(
                geotech_model=geotech_model,
                litho_model_id=litho_model_id,
                rebuilt_column_ids=(),
            )
            # The wipe above is the most orphaning thing this verb does: every
            # band is gone and nothing replaces it, so every geotech unit the
            # prior run created now describes nothing. Sweep before the commit
            # so the roster empties with the model instead of keeping a
            # vocabulary of ground that is no longer there.
            await OrphanFormationSweep(self._session).sweep_geotech_units(project_id)
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
                edges_derived=derive_edges,
                skipped_off_section_count=len(off_section_ids),
                skipped_existing_count=skipped_existing_count,
                skipped_off_section_labels=skipped_labels,
            )

        # Phase 3 — flag the tests too shallow to floor the model. NOTHING cuts
        # the picks here: the geological surfaces LABEL each segment in phase 5
        # and divide none of it (owner, 2026-08-26 — "just drop the wall
        # everywhere, user wil have to manually do it").
        geo_surfaces = await self._load_geo_surfaces_with_formation(litho_model.parent_model_id)
        lowest_sampler = self._make_lowest_boundary_sampler(geo_surfaces)

        shallow = mark_and_truncate_shallow_tests(picks, lowest_sampler)
        if shallow.marked_investigation_ids:
            self.debug(
                f"SubdivideAllBodies: {len(shallow.marked_investigation_ids)} "
                "shallow test(s) marked"
            )
        divided = shallow.picks
        self.info(
            f"SubdivideAllBodies: {len(divided)} litho segment(s) uncut "
            f"across {len(geo_surfaces)} geological surface(s) "
            f"[{time.monotonic() - t0:.1f}s]"
        )

        # Phase 4 — idempotent reset: delete the geotech data this run rebuilds.
        # Order: edges → layers (trigger deletes their FCs) → stale direct
        # FC rows (from C1) → bodies.
        await self._delete_all_geotech_data(geotech_model.id, restrict_to=scoped_members)

        # Phase 4b — what the delete SPARED. A scoped run leaves the other
        # sections' bands standing, and a carried tie may have one endpoint on
        # one of them; the matcher has to see those rows or it would report an
        # intact tie as lost. Read here, between the delete and the write, so
        # this run's own rows cannot come back twice.
        surviving_bands = (
            [] if scoped_members is None else await tie_reanchor.surviving_bands(geotech_model.id)
        )

        # Phase 5 — LABEL each segment with its geological unit and group by
        # (body_id, source_geo_formation_id). The label is derived, never a cut.
        groups = self._group_segments(divided, geo_surfaces)
        self.info(f"SubdivideAllBodies: {len(groups)} body group(s) to process")

        # Phase 6 — anchor-kind lookup for ALL model investigations.
        all_investigation_ids = {UUID(s.investigation_id) for s in divided}
        anchor_kind = await self._resolve_anchor_kinds(all_investigation_ids)

        # Phase 7 — load CPT series + min_thickness (per-CPT segmentation needs
        # no body-wide total depths now that split surfaces aren't interpolated).
        all_cpt_ids = {UUID(inv_id) for inv_id, kind in anchor_kind.items() if kind == "cpt"}
        cpt_series = await self._load_cpt_series(all_cpt_ids)
        min_thickness_m = await read_geotech_min_thickness_m(
            self._session, geotech_model.app_project_id
        )
        gradient_snap, gradient_snap_window_m = await self._read_gradient_snap(
            geotech_model.app_project_id
        )
        # The model's representative-qc statistic (ruling 7) — every band this
        # build classifies uses it, and the build stamps it as
        # ``classified_with_statistic`` on success so the derived staleness
        # (classified != representative) self-clears (ruling 8).
        statistic = geotech_model.representative_statistic
        self.debug(f"SubdivideAllBodies: min_thickness_m={min_thickness_m} statistic={statistic}")

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
                    statistic=statistic,
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
                        # The covering litho band this band subdivides — the
                        # Parameters tree derives its litho body live through it.
                        parent_litho_layer_id=(
                            UUID(col_plan.litho_layer_id) if col_plan.litho_layer_id else None
                        ),
                    )
                    self._session.add(layer)
                    # The formation, not the plan, is the authority on the
                    # class that was actually stamped: the materialiser's
                    # soil-family clamp can turn a foreign class into a
                    # skeleton, and everything keyed on this index (tie
                    # re-anchor, edge derivation) must see the band as it was
                    # written.
                    geotech_layer_by_inv_depth[inv_id].append(
                        (top_m, base_m, layer.id, formation.id, formation.nad_class)
                    )
                    total_layers += 1

            await self._session.flush()

        # Phase 8 summary — materialise totals across all groups.
        self.info(
            f"SubdivideAllBodies: Phase-8 CPT materialise complete — "
            f"cpt_bands={cpt_band_count} skeleton_bands={skeleton_band_count} "
            f"skipped_empty_plan={skipped_empty_plan_count}"
        )

        # Phase 8c — re-anchor the accepted ties captured in Phase 2b onto the
        # bands just rebuilt, PLUS the ones a scoped run left standing (phase
        # 4b): a carried tie can have one endpoint on a column this run never
        # touched, and without that band in the matcher's hands an intact tie
        # would be reported lost.
        # This runs BEFORE the derivation pass so the pass's per-section dedup
        # set (loaded below) already carries the restored ties and cannot stack
        # an unapproved proposal beside one of them.
        reanchor_plan = await tie_reanchor.reanchor(
            geotech_model_id=geotech_model.id,
            captured=captured_ties,
            rebuilt_bands=[
                *rebuilt_bands_from_layer_index(geotech_layer_by_inv_depth),
                *surviving_bands,
            ],
        )

        # Phase 9 — load all project sections; derive geotech edges per section.
        # This pass sees ONLY the CPT geotech bands (materialised above); a litho
        # edge with a borehole endpoint finds an empty geotech stack and is
        # skipped here. DivideBoreholes re-runs the SAME shared derivation after
        # it materialises the borehole bands, adding the borehole-mediated edges
        # (groundmodel.application.geotech_edge_derivation).
        sections = await load_project_sections(self._session, project_id)
        if section_id is not None:
            # A scoped run rebuilt one section's columns, so it may only
            # propose on that section — deriving elsewhere would tie bands that
            # this pass just deleted and did not re-create.
            sections = [s for s in sections if s.id == section_id]
        edge_totals = EdgeDerivationCounts()
        sections_with_edges = 0
        if not derive_edges:
            # Pipeline step 1 — bands only. The engineer presses auto-correlate
            # next and reviews the proposals before any of them is accepted.
            self.info(
                f"SubdivideAllBodies: edge derivation SKIPPED (derive_edges=False) — "
                f"{len(sections)} section(s) left without proposals; run the geotech "
                f"auto-correlate verb to propose packing ties [{time.monotonic() - t0:.1f}s]"
            )
        else:
            self.info(
                f"SubdivideAllBodies: deriving edges for {len(sections)} section(s) "
                f"[{time.monotonic() - t0:.1f}s]"
            )

            # Build the model-wide litho layer depth index once (all accepted
            # litho layers across all investigations — no section restriction).
            litho_layer_depths = await load_litho_layer_depths(self._session, litho_model_id, None)
            self.debug(
                f"SubdivideAllBodies: {len(litho_layer_depths)} litho layer depth entries loaded"
            )

            # Per-section dedup, preloaded with the ties Phase 8c just restored
            # (the only edges in the model at this point — the reset emptied the
            # rest). Without the preload the derivation would re-propose a band
            # pair an accepted tie already joins, and the pair would carry two
            # edges.
            seen_pairs_by_section = await load_existing_geotech_edge_pairs_by_section(
                self._session, geotech_model.id
            )
            seen_sided_by_section = await load_existing_geotech_sided_edges_by_section(
                self._session, geotech_model.id
            )
            # Seeds the crossing guard: a proposal that would cross an approval
            # already in the model is refused rather than shipped as a conflict
            # that stops the whole gap from banding (owner §8 Q4).
            accepted_sided_by_section = await load_accepted_geotech_sided_edges_by_section(
                self._session, geotech_model.id
            )
            # The engineer's deleted ties, per section — consulted at the emit
            # gate so a deletion stays deleted (owner 2026-08-17). Empty dict
            # in the ordinary never-deleted case.
            tombstone_gates = await build_tombstone_gates(
                self._session, geotech_model.id, project_id
            )

            # Per-section membership (owner ruling 2026-08-25: "yeah make it
            # section scoped ofcourse"). Phase 2's ``members`` is a UNION across
            # the sections in scope, which cannot answer "does THIS section draw
            # both ends of this tie?" — the question the derivation input needs.
            members_by_section = await load_members_by_section(
                self._session,
                project_id=project_id,
                section_ids=[section.id for section in sections],
            )

            for section in sections:
                edge_sets = await load_approved_litho_edge_sets(
                    self._session,
                    litho_model_id,
                    section.id,
                    section_member_investigation_ids=members_by_section.get(section.id, set()),
                    litho_layer_depths=litho_layer_depths,
                )
                off_section = edge_sets.off_section_investigations
                if off_section:
                    # NAMES, at INFO: a litho correlation the engineer can see
                    # produced no packing tie here, and the reason — the column
                    # is not drawn on this section — is invisible in the result.
                    self.info(
                        f"SubdivideAllBodies: section={section.id} ({section.name!r}) excluded "
                        f"{len(off_section)} litho-tie endpoint column(s) it does not draw: "
                        f"{await load_investigation_labels(self._session, off_section)}"
                    )
                litho_approved_edges = edge_sets.pairs
                if not litho_approved_edges:
                    continue
                sections_with_edges += 1
                # Jump ties: no borehole carries a packing band yet, so bridge
                # the litho chain across those columns and propose the CPT↔CPT
                # pair the borehole sits between (owner ruling 2026-08-04).
                bridged = bridge_edges_over_bandless_columns(
                    litho_approved_edges, litho_layer_depths, geotech_layer_by_inv_depth
                )
                self.debug(
                    f"SubdivideAllBodies: section={section.id} ({section.name!r}) "
                    f"{len(litho_approved_edges)} approved litho edge(s), "
                    f"{len(bridged) - len(litho_approved_edges)} bridged jump pair(s)"
                )
                edge_totals.add(
                    await derive_geotech_edges_from_litho(
                        self._session,
                        self,
                        geotech_model_id=geotech_model.id,
                        section_id=section.id,
                        litho_approved_edges=bridged,
                        litho_layer_depths=litho_layer_depths,
                        geotech_layer_by_inv_depth=geotech_layer_by_inv_depth,
                        seen_layer_pairs=seen_pairs_by_section.setdefault(section.id, set()),
                        # 2026-08-06 refinement: restating pairs accepted,
                        # interior + bridged pairs pending.
                        direct_litho_pairs=litho_approved_edges,
                        # Owner rulings 2026-08-13/14: every non-top↔top litho
                        # tie (bottom ties AND mixed onlap declarations)
                        # restates side-preserved.
                        litho_sided_edges=edge_sets.sided_edges,
                        seen_sided_edges=seen_sided_by_section.setdefault(section.id, set()),
                        existing_accepted_sided_edges=accepted_sided_by_section.get(
                            section.id, set()
                        ),
                        tie_tombstoned=tombstone_gates.get(section.id),
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

        # The build classified every band with ``statistic`` — stamp it so the
        # derived staleness (classified != representative) reads false again
        # (ruling 8: the ONLY thing that re-derives bands is this build).
        geotech_model.classified_with_statistic = statistic

        # Debt #266 — record WHICH litho stack each rebuilt CPT column's bands
        # came from, so a later litho contact drag can be seen. Only the columns
        # this press materialised are re-stamped: the borehole columns belong to
        # DivideBoreholes, and a column skip_existing protected really was built
        # from the older stack, so it must keep saying so.
        await self._stamp_litho_provenance(
            geotech_model=geotech_model,
            litho_model_id=litho_model_id,
            rebuilt_column_ids=set(geotech_layer_by_inv_depth.keys()),
        )

        # Phase 10b — retire the vocabulary the rebuild stopped using. The
        # delete pass wiped every band and the rebuild re-derived them from
        # live qc, so any packing class the fresh data no longer produces is
        # left with a formation row and nothing in it. Runs after the resolver
        # above so bodies it retired do not spuriously spare a formation, and
        # before the commit so the sweep is part of the same transaction as the
        # rebuild that caused it.
        await OrphanFormationSweep(self._session).sweep_geotech_units(project_id)

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
            review_tie_reasons=reanchor_plan.review_reason_counts(),
            lost_tie_count=len(reanchor_plan.lost),
            lost_tie_reasons=reanchor_plan.loss_reason_counts(),
            lost_tie_labels=reanchor_plan.lost_tie_labels,
            edges_derived=derive_edges,
            proposed_tie_count=edge_totals.edges_emitted,
            skipped_off_section_count=len(off_section_ids),
            skipped_existing_count=skipped_existing_count,
            skipped_off_section_labels=skipped_labels,
        )
        self.success(
            f"SubdivideAllBodies: geotech_model={geotech_model.id} "
            f"layers={total_layers} bodies={body_count} "
            f"split={split_body_count} one_class={one_class_body_count} "
            f"borehole_only={borehole_only_count} "
            f"sections_with_edges={sections_with_edges}/{len(sections)} "
            f"ties_proposed={edge_totals.edges_emitted} (derive_edges={derive_edges}) "
            f"accepted_ties_reanchored={len(reanchor_plan.matched)}/{len(captured_ties)} "
            f"accepted_ties_lost={len(reanchor_plan.lost)} "
            f"unclassified_foreign_family={self._family_clamp_count} "
            f"elapsed={elapsed:.1f}s"
        )
        if self._family_clamp_count:
            # Never let a press that dropped classes read like a clean one. The
            # per-band WARNINGs above name each unit and its soil; this is the
            # count to notice in a log that scrolls.
            self.warning(
                f"SubdivideAllBodies: {self._family_clamp_count} band(s) left unclassified "
                "because the only class offered belonged to another soil family — see the "
                "per-band warnings above for which units and set them by hand"
            )
        return result

    # ------------------------------------------------------------------
    # Phase 4 — model-wide idempotent reset
    # ------------------------------------------------------------------

    @staticmethod
    def _anchor_in(investigation_ids: Collection[UUID]) -> ColumnElement[bool]:
        """Match ``litho_layer`` rows anchored on any of these investigations.

        ``litho_layer`` carries a DB XOR constraint over ``cpt_id`` /
        ``borehole_id``, so one predicate per column OR'd together names the
        investigation regardless of which kind it is.

        Parameters
        ----------
        investigation_ids : Collection[UUID]
            CPT and/or borehole ids, mixed.

        Returns
        -------
        ColumnElement[bool]
            The SQL predicate.
        """
        ids = list(investigation_ids)
        return LithoLayerOrm.cpt_id.in_(ids) | LithoLayerOrm.borehole_id.in_(ids)

    async def _delete_all_geotech_data(
        self, geotech_model_id: UUID, *, restrict_to: set[UUID] | None = None
    ) -> None:
        """Delete the model's prior geotech layers, edges, FC rows, and bodies.

        Order: dirty edges → layers (LL→FC trigger cleans their FC mirrors) →
        direct FC rows written by C1 → bodies.

        Every edge in range is gone once this returns — the accepted ones too,
        taken by the endpoint FK cascade.  They come back: the caller captured
        them before calling this (:meth:`GeotechTieReanchor.capture`) and
        re-creates each one against the rebuilt band that matches its
        investigation, depth interval and NAD class
        (:meth:`GeotechTieReanchor.reanchor`), in this same transaction.

        Parameters
        ----------
        geotech_model_id : UUID
            The geotechnical model to wipe clean.
        restrict_to : set[UUID] | None
            When given, delete only what hangs off THESE investigations — the
            members of the section being subdivided.  Every other column's
            bands, ties and bodies are left exactly as they are, which is what
            lets two sections be subdivided at the same time (owner ruling
            2026-08-15, after the all-sections escape was deleted).  ``None``
            (the default) is the historic wholesale reset.
        """
        # 1. Delete the DIRTY correlation edges — everything the program derived
        # and the engineer never accepted.  Accepted ties are spared by this
        # statement (the machine never deletes what the user accepted), but see
        # step 2: the cascade takes them anyway, and the re-anchor pass — not
        # this predicate — is what actually carries them across the rebuild.
        #
        # In the scoped mode the same reasoning narrows the range: a proposal
        # between two columns this run does not rebuild is not stale, because
        # the bands it names are not being re-derived.  Selecting by ENDPOINT
        # rather than by section id is deliberate — an edge on the open section
        # can name a column the section excludes, and it is the column being
        # rebuilt, not the section it is drawn on, that makes an edge stale.
        edge_conditions = [
            LithoContactCorrelationEdgeOrm.model_id == geotech_model_id,
            LithoContactCorrelationEdgeOrm.user_approved.is_(False),
        ]
        if restrict_to is not None:
            in_scope_layer_ids = select(LithoLayerOrm.id).where(
                LithoLayerOrm.model_id == geotech_model_id,
                self._anchor_in(restrict_to),
            )
            edge_conditions.append(
                LithoContactCorrelationEdgeOrm.layer_a_id.in_(in_scope_layer_ids)
                | LithoContactCorrelationEdgeOrm.layer_b_id.in_(in_scope_layer_ids)
            )
        await self._session.execute(delete(LithoContactCorrelationEdgeOrm).where(*edge_conditions))

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
        #
        # Which is also exactly why the scoped mode limits this statement: a
        # column outside the scope keeps its rows, so the ties onto it keep
        # their endpoints and are never handed to the cascade at all.
        layer_conditions = [LithoLayerOrm.model_id == geotech_model_id]
        if restrict_to is not None:
            layer_conditions.append(self._anchor_in(restrict_to))
        await self._session.execute(delete(LithoLayerOrm).where(*layer_conditions))

        # 2b. Delete any remaining FormationContact rows for the geotech model.
        # The retired C1 skeleton flow wrote FC rows DIRECTLY (not via the
        # LL→FC trigger), so step 2's trigger-based cleanup does not remove
        # them; projects built before #237.2 may still carry such rows.
        # Without this step a subsequent SAB run fires the LL→FC trigger which
        # tries to INSERT the same FC row again →
        # uq_formation_contact_model_formation_borehole_depth violation.
        fc_conditions = [FormationContactOrm.model_id == geotech_model_id]
        if restrict_to is not None:
            fc_conditions.append(
                FormationContactOrm.cpt_id.in_(restrict_to)
                | FormationContactOrm.borehole_id.in_(restrict_to)
            )
        await self._session.execute(delete(FormationContactOrm).where(*fc_conditions))

        # 3. Delete all BodyOrm rows for the geotech model.  The resolver
        # recreates them; the bodies from the previous run must be cleared so we
        # don't violate (model, formation, ordinal) uniqueness on re-run.
        #
        # A SCOPED run does NOT do this.  Bodies are model-wide by nature — a
        # body spans every column its ties reach — so there is no subset of
        # them belonging to one section, and deleting the lot would strip the
        # names, colours and hand-drawn boundaries off the sections this run
        # never touched.  The resolver runs model-wide immediately afterwards
        # and reconciles them instead: it reuses the rows still wanted, adopts
        # the lineage of the ones it merges, and deletes only the unnamed
        # orphans.  (``litho_layer.body_id`` is ON DELETE SET NULL, so even the
        # wholesale delete never took a layer with it.)
        if restrict_to is None:
            await self._session.execute(delete(BodyOrm).where(BodyOrm.model_id == geotech_model_id))

        await self._session.flush()
        self.debug(
            f"_delete_all_geotech_data: cleared geotech data for model {geotech_model_id} "
            f"(scope={'whole model' if restrict_to is None else f'{len(restrict_to)} column(s)'})"
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
        over their geo-bounded extent with ``nad_class = None``, resolved later
        by ``DivideBoreholes`` from same-soil donors.

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
                sub_intervals, nad_classes = _mm_clamped_intervals(
                    profile.splits, geo_top, geo_base
                )

            if not sub_intervals:
                # Borehole (no qc), or a CPT with no usable segmentation → ONE band
                # spanning the geo-bounded extent, classified later by
                # DivideBoreholes from same-soil donors. ``None`` flags the
                # skeleton path.
                # Same mm grid as the split path, so a skeleton band meets its
                # neighbours exactly; only a sub-millimetre extent keeps the raw
                # pair (rounding would degenerate it into a zero-width row).
                top_r, base_r = round(geo_top, 3), round(geo_base, 3)
                if base_r - top_r > 1e-6:
                    sub_intervals = [(top_r, base_r)]
                else:
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
                    # Exact provenance: the band is minted out of THIS segment's
                    # litho layer, so its parent is the id the pick already holds.
                    litho_layer_id=seg.litho_layer_id,
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
