"""Standalone geotech auto-correlate — re-propose packing ties without a rebuild.

Mirrors the litho axis's ``POST .../contact-correlations/auto`` verb: it inserts
UNAPPROVED correlation edges the engineer then reviews and promotes with the
accept verb.

Why it exists
-------------
Geotech auto-edges were derived exactly once, inside ``SubdivideAllBodies``,
whose idempotent reset "deletes ALL geotech data for the WHOLE geotech model".
Regenerating the automatic ties therefore meant running the one verb that also
destroys every correlation the engineer drew by hand — which is what
``ReSubdivideConfirmDialog`` warns about.  This use case gives the automatic
ties their own verb, safe to press at any point in a hand-correlation session.

The invariant
-------------
**It adds; it does not reconcile.**  Every persisted edge of the geotech model
is loaded up front (per section, any source, any approval state) and preloaded
into the derivation's ``seen_layer_pairs``, so a candidate that already exists
is skipped and counted.  Nothing is updated or re-approved.  Endpoints are
canonicalised to ``(min, max)`` on both the read and the write side, so a tie
persisted the other way round is recognised as the same tie.

Two narrow exceptions, both sweeps of MACHINE rows an emit-time guard cannot
reach, and neither able to touch a tie the engineer drew or approved: the
crossing sweep (2026-08-17) and the off-section sweep (2026-08-25).

Section scoping
---------------
A geotech tie is only derivable between two columns the section actually
DRAWS — in its corridor AND between its endpoints, the same rule the section
view, the exports and "Divide boreholes" use.  The derivation reads the parent
model's litho edges by ``section_id`` alone, and that table still carries rows
written before the projection filter gained its endpoint clamp, so membership
is enforced here on the inputs rather than trusted from the litho table (owner
ruling 2026-08-25: *"yeah make it section scoped ofcourse"*).

Two dedup keys, both preloaded from the section's persisted edges and both
required.  The layer PAIR is the conservative one: two bands already joined by a
base↔base bottom-tie suppress the top↔top proposal rather than gaining a second
edge beside it, which is the same key the two build passes dedup on.  The
``(pair, sides)`` ROW IDENTITY is the DB unique constraint itself, and it catches
what the pair key structurally cannot — a restatement and an aligned pair
arriving at ONE packing contact from two different litho ties, which the pair key
never sees because it is blind to the sides.

The rule
--------
Reused verbatim via the shared ``geotech_edge_derivation`` helper the two
build passes also call: a DIRECT litho pair aligns with
``aligned_pairs_with_forced_top`` — the topmost pair restates the litho tie
regardless of class (owner ruling 2026-08-13) and the class-matched LCS
aligns the bands below it; a bridged jump pair keeps the plain class-matched
LCS.  Every non-top↔top litho tie (bottom ties and the mixed onlap
declarations) restates side-preserved onto the bands owning its contact
surfaces.  Bands with no NAD class (skeleton, no qc) never auto-tie.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.geotech_crossing_sweep import sweep_crossing_ties
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
from groundmodel.application.geotech_offsection_sweep import sweep_offsection_pending_ties
from groundmodel.application.geotech_tie_tombstones import build_tombstone_gates
from groundmodel.application.litho_frame_conformance_resolver import band_frame_warning
from groundmodel.application.scope_guard import load_scoped_or_raise
from groundmodel.application.section_membership import (
    load_investigation_labels,
    load_members_by_section,
)
from groundmodel.domain.services.auto_correlate_contact_edges_constants import AUTO_SOURCE
from groundmodel.domain.services.litho_frame_conformance import FRAME_MISMATCH_REVIEW_REASON
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


@dataclass(frozen=True)
class AutoCorrelateGeotechResult:
    """Outcome counts for one run of the geotech auto-correlate verb.

    Attributes
    ----------
    edges_proposed : int
        Net-new UNAPPROVED edges inserted — the packing-density pairs inside
        a body plus every bridged jump pair (owner refinement 2026-08-06).
        These are suggestions; the accept verb promotes them.
    edges_accepted : int
        Net-new edges born ACCEPTED because they RESTATE an approved litho
        tie (top sub-band pair of a direct litho edge) — the litho approval
        already vouches for exactly that connection.
    edges_skipped_existing : int
        Candidates left alone because an edge already covers them on that
        section — whether the engineer drew it by hand, accepted it earlier, or
        a build pass wrote it.  Sums the conservative pair-only suppression and
        the row-identity one (two litho ties naming a single packing contact);
        both mean "nothing added here", which is what the toast reports.
    sections_processed : int
        Sections that carried at least one approved litho edge and were
        therefore examined.
    skipped_no_lcs : int
        Correlated litho units whose two packing stacks share no NAD class, so
        nothing could be tied automatically (the engineer connects those).
    crossing_tie_count : int
        Machine ties deleted for crossing another tie in the same gap — legacy
        rows an emit-time guard cannot reach (owner ruling 2026-08-17).  The
        engineer's own lines are never deleted.
    skipped_empty_stack : int
        Correlated litho units where one column carries no geotech bands at all
        (e.g. a column the build has not subdivided yet).
    investigations_off_section : int
        Distinct columns that appeared as a litho-tie endpoint on a section
        that does not draw them, and were therefore excluded from the
        derivation (owner ruling 2026-08-25).  The log names them.
    offsection_ties_deleted : int
        Mis-scoped machine PROPOSALS removed by the sweep — unapproved
        ``source='auto'`` rows tying a column their section does not draw.
    offsection_ties_retained : int
        Mis-scoped ties left standing because they are ACCEPTED or hand-drawn.
        Each is named at WARNING; taking one back is the engineer's call.
    frame_flagged_count : int
        New machine ties this run stamped with the violet
        ``review_reason='frame_mismatch'`` badge because they exceed the litho
        frame (owner order 2026-08-21) — a restatement two bands can never
        become one mass.  The tie is still written; the badge asks the engineer
        to review it, exactly as the hand path flags the same tie.
    """

    edges_proposed: int
    edges_accepted: int
    edges_skipped_existing: int
    sections_processed: int
    skipped_no_lcs: int = 0
    skipped_empty_stack: int = 0
    crossing_tie_count: int = 0
    investigations_off_section: int = 0
    offsection_ties_deleted: int = 0
    offsection_ties_retained: int = 0
    frame_flagged_count: int = 0


class AutoCorrelateGeotechEdges(GroundModelLogger):
    """Re-derive geotech packing correlations as suggestions, adding only.

    The caller owns the session; this use case commits once at the end.

    Parameters
    ----------
    session : AsyncSession
        An active SQLAlchemy async session.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    async def execute(
        self,
        *,
        project_id: UUID,
        model_id: UUID,
        section_id: UUID | None = None,
    ) -> AutoCorrelateGeotechResult:
        """Propose geotech packing ties for a geotechnical model.

        Parameters
        ----------
        project_id : UUID
            Project scope guard — the model must belong to this project.
        model_id : UUID
            The **geotechnical** model whose packing bands are correlated.  Its
            parent is the lithostratigraphic model whose approved edges drive
            the derivation.
        section_id : UUID | None
            Restrict the run to one section.  ``None`` (the default) runs across
            every section of the project, which is how the engineer regenerates
            the automatic ties for a whole multi-section model in one press.

        Notes
        -----
        Only the columns a section DRAWS take part in its derivation: a litho
        tie with an endpoint outside the section's membership is excluded and
        its column named in the log, and any unapproved machine proposal
        already stored on such a gap is swept.  Accepted and hand-drawn ties
        are never removed by that sweep — they are counted and warned about.

        Returns
        -------
        AutoCorrelateGeotechResult
            Proposed / skipped-existing counts, the two diagnostic skip
            reasons, and the off-section exclusion / sweep counts.

        Raises
        ------
        ValueError
            When the model does not belong to ``project_id``, when it is not of
            kind ``'geotechnical'`` (the rule matches NAD packing classes, which
            only a geotech model carries), or when it has no lithostratigraphic
            parent to read approved correlations from.
        """
        self.info(
            f"AutoCorrelateGeotechEdges.execute: model={model_id} project={project_id} "
            f"section={section_id or 'ALL'}"
        )

        model = await load_scoped_or_raise(
            self._session, GeologicalModelOrm, model_id, project_id, label="Geological model"
        )
        # Kind guard, mirroring AutoCorrelateContactEdges' litho-only guard: the
        # rule aligns NAD packing-class sequences, which exist only on geotech
        # formations, so any other kind would silently derive nothing.
        if model.kind != "geotechnical":
            raise ValueError(
                f"Geotech auto-correlate requires a geotechnical model; "
                f"model {model_id} is of kind '{model.kind}'"
            )
        litho_model_id = model.parent_model_id
        if litho_model_id is None:
            raise ValueError(
                f"Geotech model {model_id} has no lithostratigraphic parent; "
                f"geotech correlations are derived from the parent model's approved "
                f"litho edges"
            )

        geotech_bands = await self._load_geotech_bands(model_id)
        litho_layer_depths = await load_litho_layer_depths(self._session, litho_model_id, None)
        self.debug(
            f"AutoCorrelateGeotechEdges: {sum(len(v) for v in geotech_bands.values())} geotech "
            f"band(s) across {len(geotech_bands)} column(s); "
            f"{len(litho_layer_depths)} litho layer depth entries"
        )

        sections = await load_project_sections(self._session, project_id)
        if section_id is not None:
            sections = [s for s in sections if s.id == section_id]
            if not sections:
                self.warning(
                    f"AutoCorrelateGeotechEdges: section {section_id} not found in project "
                    f"{project_id} — nothing to propose"
                )
                return AutoCorrelateGeotechResult(
                    edges_proposed=0,
                    edges_accepted=0,
                    edges_skipped_existing=0,
                    sections_processed=0,
                )

        # ADD-ONLY: preload the dedup set with EVERY persisted edge of this
        # model, per section — hand-drawn, accepted, and build-derived alike.
        # A candidate that hits this set is skipped and counted, so an existing
        # correlation is never deleted, re-approved, or duplicated. The set is
        # per section because geotech edges are section-scoped: the same band
        # pair may legitimately carry its own edge on two sections.
        seen_pairs_by_section = await load_existing_geotech_edge_pairs_by_section(
            self._session, model_id
        )
        seen_sided_by_section = await load_existing_geotech_sided_edges_by_section(
            self._session, model_id
        )
        # Seeds the crossing guard. This verb is the one the owner pressed when
        # the section answered "1 crossing correlation tie — resolve to restore
        # bands": the tie it crossed was already approved in the model, so the
        # guard has to see the model's approvals, not only this run's.
        accepted_sided_by_section = await load_accepted_geotech_sided_edges_by_section(
            self._session, model_id
        )
        # The engineer's deleted ties, per section — consulted at the emit
        # gate so a deletion stays deleted (owner 2026-08-17). Empty dict in
        # the ordinary never-deleted case.
        tombstone_gates = await build_tombstone_gates(self._session, model_id, project_id)
        # Snapshot every edge id that exists BEFORE the derivation adds any, so
        # the frame-conformance flag below touches only the ties THIS run
        # created — a badge the engineer already cleared on an older tie is
        # never re-applied.
        preexisting_edge_ids = await self._load_edge_ids(model_id)
        self.debug(
            f"AutoCorrelateGeotechEdges: preloaded existing edges on "
            f"{len(seen_pairs_by_section)} section(s) — these are left untouched"
        )

        # Section membership, once per section in scope (owner ruling
        # 2026-08-25: "yeah make it section scoped ofcourse"). It gates the
        # derivation's inputs below AND the sweep at the end, so both halves
        # judge by the same rule the section view draws with.
        members_by_section = await load_members_by_section(
            self._session, project_id=project_id, section_ids=[section.id for section in sections]
        )

        totals = EdgeDerivationCounts()
        sections_processed = 0
        off_section_investigations: set[UUID] = set()
        for index, section in enumerate(sections):
            members = members_by_section.get(section.id, set())
            edge_sets = await load_approved_litho_edge_sets(
                self._session,
                litho_model_id,
                section.id,
                section_member_investigation_ids=members,
                litho_layer_depths=litho_layer_depths,
            )
            off_section = edge_sets.off_section_investigations
            if off_section:
                off_section_investigations |= off_section
                # NAMES, at INFO: the engineer is being told that a correlation
                # he can see in the litho model produced no packing tie here,
                # and the reason is that the column is not on this section.
                self.info(
                    f"[{index + 1}/{len(sections)}] AutoCorrelateGeotechEdges: "
                    f"section={section.id} ({section.name!r}) excluded "
                    f"{len(off_section)} litho-tie endpoint column(s) it does not draw: "
                    f"{await load_investigation_labels(self._session, off_section)}"
                )
            approved = edge_sets.pairs
            if not approved:
                self.debug(
                    f"[{index + 1}/{len(sections)}] AutoCorrelateGeotechEdges: "
                    f"section={section.id} ({section.name!r}) has no approved litho edge — skipped"
                )
                continue
            sections_processed += 1
            # Defence in depth: the edge filter above already removes every tie
            # that could reach an off-section column, but narrowing the band map
            # to the same members makes the column invisible to the derivation
            # by CONSTRUCTION — neither a terminal nor a transit hop for either
            # bridging walk — rather than by an argument a future emit path
            # could invalidate.
            section_bands = {
                inv_id: rows for inv_id, rows in geotech_bands.items() if UUID(inv_id) in members
            }
            self.debug(
                f"[{index + 1}/{len(sections)}] AutoCorrelateGeotechEdges: "
                f"section={section.id} ({section.name!r}) "
                f"{len(approved)} approved litho edge(s)"
            )
            # Jump ties (owner ruling 2026-08-04): this verb runs BEFORE
            # "Divide boreholes", so every borehole column is still empty of
            # packing. Bridge the litho chain across those columns so a section
            # drawn CPT–borehole–CPT proposes the CPT pair rather than nothing.
            bridged = bridge_edges_over_bandless_columns(
                approved, litho_layer_depths, section_bands
            )
            if len(bridged) > len(approved):
                self.debug(
                    f"AutoCorrelateGeotechEdges: section={section.id} "
                    f"{len(bridged) - len(approved)} jump pair(s) bridged across "
                    f"column(s) with no packing bands"
                )
            totals.add(
                await derive_geotech_edges_from_litho(
                    self._session,
                    self,
                    geotech_model_id=model_id,
                    section_id=section.id,
                    litho_approved_edges=bridged,
                    litho_layer_depths=litho_layer_depths,
                    geotech_layer_by_inv_depth=section_bands,
                    seen_layer_pairs=seen_pairs_by_section.setdefault(section.id, set()),
                    # Ruling A as refined 2026-08-06: only the pairs that
                    # RESTATE one of these direct litho ties are born
                    # accepted; interior packing pairs + bridged jump pairs
                    # arrive pending. The derivation decides per pair.
                    direct_litho_pairs=approved,
                    # Owner ruling 2026-08-13 ("start from the exact litho
                    # geometries"): a litho bottom tie restates as a
                    # base↔base edge between the deepest bands.
                    litho_sided_edges=edge_sets.sided_edges,
                    seen_sided_edges=seen_sided_by_section.setdefault(section.id, set()),
                    existing_accepted_sided_edges=accepted_sided_by_section.get(section.id, set()),
                    source=AUTO_SOURCE,
                    tie_tombstoned=tombstone_gates.get(section.id),
                )
            )

        # Legacy crossings, swept on this press too: step 2 is the verb the
        # engineer reaches for when a gap looks wrong, and the sweep is the only
        # thing that can reach a stored crossing (the emit-time guard refuses
        # candidates; the re-anchor carries rows across rebuilds). Owner ruling
        # 2026-08-17 — "ties shouldn't be able to cross"; his own lines stand.
        crossing_dropped = await sweep_crossing_ties(self._session, self, model_id)

        # Legacy mis-scoping, swept the same way and for the same reason: the
        # input gate above stops the derivation MAKING one, but only a sweep
        # can reach a proposal already stored on a gap the section never draws.
        # Scoped to the sections this press examined, so a one-section run never
        # reaches into a section the engineer did not ask about.
        offsection = await sweep_offsection_pending_ties(
            self._session,
            self,
            geotech_model_id=model_id,
            members_by_section=members_by_section,
        )

        # Frame-conformance FLAG (owner order 2026-08-21), on the SURVIVING new
        # ties only — after the sweeps so a swept row is never flagged. The
        # machine restates a direct litho tie onto the packing bands REGARDLESS
        # of class (2026-08-13), so a cross-soil litho surface tie yields a
        # packing tie two bands can never become one mass. It stays written —
        # never refused — but is born with the same violet review badge the
        # hand path stamps, so the engineer reviews it instead of finding an
        # "onlap that should band" on the canvas.
        frame_flagged = await self._flag_frame_mismatched_new_edges(
            geotech_model_id=model_id,
            litho_model_id=litho_model_id,
            preexisting_edge_ids=preexisting_edge_ids,
        )

        await self._session.commit()
        self.success(
            f"AutoCorrelateGeotechEdges: proposed={totals.edges_proposed} "
            f"accepted_restatements={totals.edges_accepted} "
            f"skipped_existing_pair={totals.skipped_existing_pair} "
            f"skipped_duplicate_row={totals.skipped_duplicate_row} "
            f"sections={sections_processed}/{len(sections)} "
            f"skipped_no_lcs={totals.skipped_no_lcs} "
            f"skipped_empty_stack={totals.skipped_empty_stack} "
            f"crossing_ties_deleted={crossing_dropped} "
            f"frame_flagged={frame_flagged}; "
            f"{len(off_section_investigations)} investigation(s) outside section membership "
            f"excluded; {offsection.deleted} mis-scoped pending proposal(s) removed, "
            f"{offsection.retained} accepted/hand-drawn mis-scoped tie(s) kept"
        )
        return AutoCorrelateGeotechResult(
            edges_proposed=totals.edges_proposed,
            edges_accepted=totals.edges_accepted,
            edges_skipped_existing=totals.skipped_existing_pair + totals.skipped_duplicate_row,
            sections_processed=sections_processed,
            skipped_no_lcs=totals.skipped_no_lcs,
            skipped_empty_stack=totals.skipped_empty_stack,
            crossing_tie_count=crossing_dropped,
            investigations_off_section=len(off_section_investigations),
            offsection_ties_deleted=offsection.deleted,
            offsection_ties_retained=offsection.retained,
            frame_flagged_count=frame_flagged,
        )

    async def _load_geotech_bands(
        self, geotech_model_id: UUID
    ) -> dict[str, list[tuple[float, float, UUID, UUID, int | None]]]:
        """Load every geotech packing band of the model, keyed by investigation.

        Both CPT and borehole columns are included: the build materialises CPT
        bands in ``SubdivideAllBodies`` and borehole bands in ``DivideBoreholes``,
        and by the time the engineer presses auto-correlate both are present, so
        a borehole-mediated tie must be proposable too.

        Parameters
        ----------
        geotech_model_id : UUID
            The geotechnical model whose layers are loaded.

        Returns
        -------
        dict[str, list[tuple[float, float, UUID, UUID, int | None]]]
            ``investigation_id_str → [(top_m, base_m, layer_id, formation_id,
            nad_class), ...]`` in the shape the shared derivation expects.
        """
        rows = (
            await self._session.execute(
                select(
                    LithoLayerOrm.cpt_id,
                    LithoLayerOrm.borehole_id,
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
                .where(LithoLayerOrm.model_id == geotech_model_id)
                .order_by(LithoLayerOrm.depth_top_m)
            )
        ).all()
        by_investigation: dict[str, list[tuple[float, float, UUID, UUID, int | None]]] = (
            defaultdict(list)
        )
        for row in rows:
            # Same keying as load_litho_layer_depths — borehole first, then CPT —
            # so the two maps agree on what identifies a column.
            inv_id = str(row.borehole_id if row.borehole_id is not None else row.cpt_id)
            by_investigation[inv_id].append(
                (row.depth_top_m, row.depth_base_m, row.id, row.formation_id, row.nad_class)
            )
        return by_investigation

    async def _load_edge_ids(self, geotech_model_id: UUID) -> set[UUID]:
        """Every geotech edge id of the model, as a set.

        Snapshotted before the derivation runs so the frame-conformance flag can
        tell this run's new ties from the edges that were already there.

        Parameters
        ----------
        geotech_model_id : UUID
            The geotechnical model whose edges are enumerated.

        Returns
        -------
        set[UUID]
            The ids of every persisted geotech correlation edge on the model.
        """
        rows = (
            await self._session.execute(
                select(LithoContactCorrelationEdgeOrm.id).where(
                    LithoContactCorrelationEdgeOrm.model_id == geotech_model_id
                )
            )
        ).all()
        return {row[0] for row in rows}

    async def _flag_frame_mismatched_new_edges(
        self,
        *,
        geotech_model_id: UUID,
        litho_model_id: UUID,
        preexisting_edge_ids: set[UUID],
    ) -> int:
        """Stamp the frame-mismatch review badge on this run's non-conforming ties.

        The machine restates a direct litho tie onto the packing bands REGARDLESS
        of class (owner ruling 2026-08-13), so a cross-soil litho surface tie
        makes it propose a packing tie whose two bands can never become one mass
        — exactly the tie the hand path flags (owner order 2026-08-21, *"flag a
        tie like that when it doesn't conform to the litho model!"*). This runs
        the SAME shared resolver the hand path runs
        (:func:`~groundmodel.application.litho_frame_conformance_resolver.band_frame_warning`)
        and, when it warns, stamps the identical ``review_reason='frame_mismatch'``
        the hand path stamps — the violet review badge and Confirm-tie flow.

        It WARNS, never refuses: a restatement is a legitimate surface statement,
        so the edge stays written and the engineer is asked to review it rather
        than discovering the mismatch on the canvas.

        Scoped to the ties THIS run created (``id`` not in
        ``preexisting_edge_ids``) and left alone if they already carry a review
        reason, so a badge the engineer already cleared on an older tie is never
        re-applied.

        Parameters
        ----------
        geotech_model_id : UUID
            The geotechnical model whose new edges are checked.
        litho_model_id : UUID
            The parent litho model — the frame the resolver reads.
        preexisting_edge_ids : set[UUID]
            Every geotech edge id that existed before this run's derivation.

        Returns
        -------
        int
            How many new machine ties were flagged as ``frame_mismatch``.
        """
        new_edges = [
            edge
            for edge in (
                (
                    await self._session.execute(
                        select(LithoContactCorrelationEdgeOrm).where(
                            LithoContactCorrelationEdgeOrm.model_id == geotech_model_id
                        )
                    )
                )
                .scalars()
                .all()
            )
            if edge.id not in preexisting_edge_ids and edge.review_reason is None
        ]
        flagged: list[tuple[UUID, str]] = []
        for edge in new_edges:
            warning = await band_frame_warning(
                self._session,
                litho_model_id=litho_model_id,
                band_a_id=edge.layer_a_id,
                band_b_id=edge.layer_b_id,
            )
            if warning is None:
                continue
            edge.review_reason = FRAME_MISMATCH_REVIEW_REASON
            flagged.append((edge.id, warning))
        # Per-flagged INFO with the [i/total] prefix: a load-bearing surface
        # (the badge the engineer will act on), so it stays at INFO, not DEBUG.
        for index, (edge_id, warning) in enumerate(flagged, start=1):
            self.info(
                f"[{index}/{len(flagged)}] AutoCorrelateGeotechEdges: machine tie {edge_id} "
                f"flagged frame_mismatch — {warning}"
            )
        return len(flagged)
