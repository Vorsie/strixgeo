"""Shared geotech correlation-edge derivation from litho edges.

The geotech partition connects each same-NAD-class packing band across a litho
correlation.  ``SubdivideAllBodies`` (SAB) derives these edges for CPT columns;
``DivideBoreholes`` derives the borehole-involving ones AFTER it materialises
borehole geotech bands (SAB runs Phase 9 before boreholes exist, so any litho
edge with a borehole endpoint finds an empty geotech stack and is skipped — the
bug this module fixes by making the derivation reusable across both passes).

Design
------
The derivation is a pure-ish DB writer: given a litho edge (a correlated
litho-unit pair traced across two tests), it collects the geotech sub-band
stack inside that litho unit on each test, aligns the two stacks (a direct
litho pair via ``aligned_pairs_with_forced_top`` — the topmost pair is forced
regardless of class, owner ruling 2026-08-13; a bridged pair via the plain
class-matched ``aligned_same_class_pairs`` LCS), and emits one geotech edge
per aligned pair, plus side-preserved restatements of every non-top↔top
litho tie (bottom ties and mixed onlap declarations alike).  The
caller controls the dedup scope by passing a ``seen_layer_pairs``
set — and that set MUST be per-section, because geotech edges are
section-scoped (the same layer pair can legitimately exist on two sections).
SAB uses a fresh set per section (CPT↔CPT edges); DivideBoreholes preloads each
section's set with that section's existing geotech edges (via
``load_existing_geotech_edge_pairs_by_section``) so it only ADDS the
borehole-involving pairs SAB missed, without suppressing a legitimate same-pair
edge on another section.

Extracting this here (rather than copying SAB's method) keeps the LCS-match +
containment + canonical-ordering logic single-source, per the project's
"extract on the second copy" rule.

A third caller, ``AutoCorrelateGeotechEdges``, re-runs the same derivation on
demand without touching any existing geotech data, preloading
``seen_layer_pairs`` from every persisted edge so the pass only ever ADDS.

Approval on emitted edges follows the owner's 2026-08-06 refinement of ruling
A: an edge that RESTATES a litho tie (its litho pair is a direct approved
litho edge — not a bridged jump pair — and its endpoints are the topmost
sub-band of each stack, so it joins the same contact surfaces the engineer
tied) is born ``user_approved=True``; every OTHER pair — the packing-density
boundaries the machine invented inside the body, and every bridged jump pair
— is a pending proposal the engineer accepts or rejects, and the divide gate
counts.  ``source='auto'`` on all of them: hand and machine work stay
distinguishable regardless of approval (the 2026-08-01 provenance rule — a
derived tie claiming ``'manual'`` is how they became indistinguishable once,
and a rebuild destroyed both).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.domain.services.auto_correlate_contact_edges_constants import AUTO_SOURCE
from groundmodel.domain.services.geotech_edge_bridging import (
    bridge_litho_edges_over_bandless_columns,
)
from groundmodel.domain.services.geotech_packing_edges import (
    aligned_pairs_with_forced_top,
    aligned_same_class_pairs,
)
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# 1 mm tolerance for geo-band divide floating-point noise (the litho unit and
# its geotech sub-bands are stored independently; a sub-band snapped to the
# unit's edge can round a hair past it).
_DEPTH_TOL_M = 0.001


@dataclass
class EdgeDerivationCounts:
    """Per-derivation-pass counters, for phase-summary logging."""

    edges_emitted: int = 0
    # The owner's 2026-08-06 refinement of ruling A splits emissions: a pair
    # that RESTATES a litho tie is born accepted, every other pair is a
    # proposal. ``edges_emitted`` stays the total (= accepted + proposed).
    edges_accepted: int = 0
    edges_proposed: int = 0
    skipped_no_litho_depth: int = 0
    skipped_no_lcs: int = 0
    skipped_empty_stack: int = 0
    # Candidate pairs suppressed by ``seen_layer_pairs`` — either already
    # persisted (the caller preloaded them) or already emitted earlier in this
    # same pass. The standalone auto-correlate verb toasts this so the engineer
    # can tell "nothing new to propose" from "nothing matched".
    skipped_existing_pair: int = 0

    def add(self, other: EdgeDerivationCounts) -> None:
        """Accumulate another pass's counters into this one."""
        self.edges_emitted += other.edges_emitted
        self.edges_accepted += other.edges_accepted
        self.edges_proposed += other.edges_proposed
        self.skipped_no_litho_depth += other.skipped_no_litho_depth
        self.skipped_no_lcs += other.skipped_no_lcs
        self.skipped_empty_stack += other.skipped_empty_stack
        self.skipped_existing_pair += other.skipped_existing_pair


async def load_project_sections(session: AsyncSession, project_id: UUID) -> list[CrossSectionOrm]:
    """Load all cross-sections for a project, ordered by display_order then name.

    Parameters
    ----------
    session : AsyncSession
        Active DB session.
    project_id : UUID
        Owning project.

    Returns
    -------
    list[CrossSectionOrm]
        All project sections in stable display order.
    """
    rows = (
        (
            await session.execute(
                select(CrossSectionOrm)
                .where(CrossSectionOrm.app_project_id == project_id)
                .order_by(CrossSectionOrm.display_order, CrossSectionOrm.name)
            )
        )
        .scalars()
        .all()
    )
    return list(rows)


async def load_litho_layer_depths(
    session: AsyncSession,
    litho_model_id: UUID,
    investigation_ids: set[UUID] | None = None,
) -> dict[UUID, tuple[str, float, float]]:
    """Load ``litho_layer_id → (investigation_id_str, top_m, base_m)``.

    Parameters
    ----------
    session : AsyncSession
        Active DB session.
    litho_model_id : UUID
        The litho model to query.
    investigation_ids : set[UUID] | None
        Restrict to these investigations, or ``None`` for the whole model.

    Returns
    -------
    dict[UUID, tuple[str, float, float]]
        Depth extent of every accepted litho layer, keyed by layer id.
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
    rows = (await session.execute(stmt)).all()
    result: dict[UUID, tuple[str, float, float]] = {}
    for r in rows:
        inv_id = str(r.borehole_id if r.borehole_id is not None else r.cpt_id)
        result[r.id] = (inv_id, r.depth_top_m, r.depth_base_m)
    return result


@dataclass(frozen=True)
class ApprovedLithoEdgeSets:
    """A section's approved litho edges, pairs plus their sided identities.

    Attributes
    ----------
    pairs : set[tuple[UUID, UUID]]
        Canonical ``(min, max)`` layer pairs of EVERY approved litho edge on
        the section, any sides — the alignment driver.
    sided_edges : set[tuple[UUID, UUID, str, str]]
        Every approved litho edge as ``(min_id, max_id, side_of_min,
        side_of_max)`` — the full tie vocabulary: top↔top band ties,
        base↔base bottom ties AND the mixed top↔base onlap declarations.
        Each restates onto the geotech bands owning the same contact
        surfaces, sides preserved (owner ruling 2026-08-14: "litho
        consistency should be 100%" — the side-blind loader silently
        restated a mixed tie as top↔top, an approval the engineer never
        gave).
    """

    pairs: set[tuple[UUID, UUID]]
    sided_edges: set[tuple[UUID, UUID, str, str]]


async def load_approved_litho_edge_sets(
    session: AsyncSession, litho_model_id: UUID, section_id: UUID
) -> ApprovedLithoEdgeSets:
    """Load a section's approved litho edges WITH their bottom-tie subset.

    The retired pair-only loader discarded the sides, which made a litho
    bottom tie indistinguishable from a top tie — the derivation then
    restated every litho tie as ``top/top`` only.

    Parameters
    ----------
    session : AsyncSession
        Active DB session.
    litho_model_id : UUID
        The litho model.
    section_id : UUID
        The section (edges are section-scoped).

    Returns
    -------
    ApprovedLithoEdgeSets
        All approved pairs plus the base↔base subset.
    """
    rows = (
        await session.execute(
            select(
                LithoContactCorrelationEdgeOrm.layer_a_id,
                LithoContactCorrelationEdgeOrm.layer_b_id,
                LithoContactCorrelationEdgeOrm.layer_a_side,
                LithoContactCorrelationEdgeOrm.layer_b_side,
            ).where(
                LithoContactCorrelationEdgeOrm.model_id == litho_model_id,
                LithoContactCorrelationEdgeOrm.section_id == section_id,
                LithoContactCorrelationEdgeOrm.user_approved.is_(True),
            )
        )
    ).all()
    return ApprovedLithoEdgeSets(
        pairs={(min(a, b), max(a, b)) for a, b, _sa, _sb in rows},
        sided_edges={
            (a, b, sa, sb) if a < b else (b, a, sb, sa) for a, b, sa, sb in rows
        },
    )


async def load_existing_geotech_sided_edges_by_section(
    session: AsyncSession, geotech_model_id: UUID
) -> dict[UUID, set[tuple[UUID, UUID, str, str]]]:
    """Load persisted geotech edges WITH their sides, keyed by section.

    Sided restatements dedup on the ``(pair, sides)`` identity rather than the
    pair-only ``seen_layer_pairs`` (whose pair key deliberately lets an
    existing tie suppress a top↔top PROPOSAL): a single-band litho unit must
    be able to carry its top, base AND mixed restatements on the same layer
    pair — the DB unique constraint includes the sides, so the rows are all
    legal.

    Parameters
    ----------
    session : AsyncSession
        Active DB session.
    geotech_model_id : UUID
        The geotech model.

    Returns
    -------
    dict[UUID, set[tuple[UUID, UUID, str, str]]]
        ``section_id → {(min_id, max_id, side_of_min, side_of_max), ...}``.
    """
    rows = (
        await session.execute(
            select(
                LithoContactCorrelationEdgeOrm.section_id,
                LithoContactCorrelationEdgeOrm.layer_a_id,
                LithoContactCorrelationEdgeOrm.layer_b_id,
                LithoContactCorrelationEdgeOrm.layer_a_side,
                LithoContactCorrelationEdgeOrm.layer_b_side,
            ).where(LithoContactCorrelationEdgeOrm.model_id == geotech_model_id)
        )
    ).all()
    by_section: dict[UUID, set[tuple[UUID, UUID, str, str]]] = {}
    for section_id, a, b, sa, sb in rows:
        key = (a, b, sa, sb) if a < b else (b, a, sb, sa)
        by_section.setdefault(section_id, set()).add(key)
    return by_section


async def load_existing_geotech_edge_pairs_by_section(
    session: AsyncSession, geotech_model_id: UUID
) -> dict[UUID, set[tuple[UUID, UUID]]]:
    """Load already-persisted geotech edge layer-pairs, keyed by section.

    Geotech edges are section-scoped (``LithoContactCorrelationEdgeOrm`` has a
    per-section uniqueness on the layer pair), so dedup must be section-scoped
    too: the SAME layer pair ``(A, B)`` may legitimately exist as one edge on
    section 1 and a distinct edge on section 2.  A model-global dedup set would
    let an ``(A, B)`` edge emitted on section 1 silently suppress the
    legitimate ``(A, B)`` edge on section 2 → a missing band render there.

    Parameters
    ----------
    session : AsyncSession
        Active DB session.
    geotech_model_id : UUID
        The geotech model.

    Returns
    -------
    dict[UUID, set[tuple[UUID, UUID]]]
        ``section_id → {canonical (min, max) geotech-layer pair, ...}`` for
        every existing edge — used to preload a derivation's per-section
        ``seen_layer_pairs`` so a second pass never duplicates an edge the first
        pass already emitted ON THE SAME SECTION.
    """
    rows = (
        await session.execute(
            select(
                LithoContactCorrelationEdgeOrm.section_id,
                LithoContactCorrelationEdgeOrm.layer_a_id,
                LithoContactCorrelationEdgeOrm.layer_b_id,
            ).where(LithoContactCorrelationEdgeOrm.model_id == geotech_model_id)
        )
    ).all()
    by_section: dict[UUID, set[tuple[UUID, UUID]]] = {}
    for section_id, a, b in rows:
        by_section.setdefault(section_id, set()).add((min(a, b), max(a, b)))
    return by_section


def bridge_edges_over_bandless_columns(
    litho_approved_edges: set[tuple[UUID, UUID]],
    litho_layer_depths: dict[UUID, tuple[str, float, float]],
    geotech_layer_by_inv_depth: dict[str, list[tuple[Any, ...]]],
) -> set[tuple[UUID, UUID]]:
    """Add CPT↔CPT litho pairs that skip columns carrying no packing bands.

    Thin adapter over
    :func:`~groundmodel.domain.services.geotech_edge_bridging.bridge_litho_edges_over_bandless_columns`
    — it turns the two index shapes this module already builds into the pure
    rule's inputs.  Applied by every derivation caller, so a section drawn
    CPT–borehole–CPT proposes the CPT pair the borehole sat between instead of
    proposing nothing (owner ruling 2026-08-04).

    Parameters
    ----------
    litho_approved_edges : set[tuple[UUID, UUID]]
        The section's approved litho correlations, canonical ``(min, max)``.
    litho_layer_depths : dict[UUID, tuple[str, float, float]]
        ``litho_layer_id → (investigation_id_str, top_m, base_m)``.
    geotech_layer_by_inv_depth : dict[str, list[tuple[Any, ...]]]
        Per-investigation geotech band index; a column with a non-empty entry
        here is one the derivation can align, so the bridge does not walk
        through it.

    Returns
    -------
    set[tuple[UUID, UUID]]
        A superset of ``litho_approved_edges``: nothing the engineer approved is
        ever dropped.
    """

    def _window_has_bands(inv_id: str, lit_top: float, lit_base: float) -> bool:
        """Mirror ``_stack``'s in-window filter — same tolerance, same test."""
        return any(
            row[0] >= lit_top - _DEPTH_TOL_M and row[1] <= lit_base + _DEPTH_TOL_M
            for row in geotech_layer_by_inv_depth.get(inv_id, [])
        )

    return bridge_litho_edges_over_bandless_columns(
        litho_edges=litho_approved_edges,
        layer_investigation={layer_id: entry[0] for layer_id, entry in litho_layer_depths.items()},
        layers_with_bands={
            layer_id
            for layer_id, (inv_id, lit_top, lit_base) in litho_layer_depths.items()
            if _window_has_bands(inv_id, lit_top, lit_base)
        },
    )


async def derive_geotech_edges_from_litho(
    session: AsyncSession,
    log: GroundModelLogger,
    *,
    geotech_model_id: UUID,
    section_id: UUID,
    litho_approved_edges: set[tuple[UUID, UUID]],
    litho_layer_depths: dict[UUID, tuple[str, float, float]],
    geotech_layer_by_inv_depth: dict[str, list[tuple[Any, ...]]],
    seen_layer_pairs: set[tuple[UUID, UUID]],
    direct_litho_pairs: set[tuple[UUID, UUID]] | None = None,
    litho_sided_edges: set[tuple[UUID, UUID, str, str]] | None = None,
    seen_sided_edges: set[tuple[UUID, UUID, str, str]] | None = None,
    source: str = AUTO_SOURCE,
) -> EdgeDerivationCounts:
    """Emit geotech edges by packing alignment within each correlated litho unit.

    For each approved litho edge, this resolves the litho unit's depth extent on
    each test, collects the geotech sub-band stack (``layer_id, nad_class``,
    top→base) that falls WITHIN that unit, aligns the two stacks, and emits one
    geotech edge per aligned pair.  A DIRECT litho pair aligns via
    ``aligned_pairs_with_forced_top`` — the topmost pair is forced REGARDLESS
    of class (owner ruling 2026-08-13, "start from the exact litho geometries":
    the tops own the very contact surfaces the litho tie joins, so the
    restatement must exist even when the classes differ) and the class-matched
    LCS aligns only the bands below it; a bridged jump pair keeps the plain
    class-matched LCS (``None`` classes never match — skeleton bands stay
    unconnected).  A direct pair that also carries a litho BOTTOM tie
    additionally restates it as a base↔base edge between the two deepest
    bands.

    The ``geotech_layer_by_inv_depth`` map must already contain the sub-bands for
    BOTH endpoints' investigations — the caller is responsible for populating it
    (CPT bands during materialisation, borehole bands after DivideBoreholes fill).
    An endpoint with no bands is counted in ``skipped_empty_stack`` and left for
    a later pass or manual connection.

    Parameters
    ----------
    session : AsyncSession
        Active DB session; edges are ``add``-ed and flushed here.
    log : GroundModelLogger
        Caller's logger (phase-summary INFO + per-edge DEBUG).
    geotech_model_id : UUID
        Model id stamped on each emitted edge.
    section_id : UUID
        Section id stamped on each emitted edge.
    litho_approved_edges : set[tuple[UUID, UUID]]
        Canonical litho-layer pairs (one per correlated litho-unit pair).
    litho_layer_depths : dict[UUID, tuple[str, float, float]]
        ``litho_layer_id → (investigation_id_str, top_m, base_m)``.
    geotech_layer_by_inv_depth : dict[str, list[tuple[float, float, UUID, UUID, int | None]]]
        ``investigation_id_str → [(top_m, base_m, layer_id, formation_id, nad_class, ...)]``.
        Only the first five elements are read; trailing elements (DivideBoreholes
        appends a sixth ``body_id``) are ignored.
    seen_layer_pairs : set[tuple[UUID, UUID]]
        Dedup set, MUTATED in place. Preload with existing edges to add only new
        pairs; pass a fresh set for an independent pass.
    direct_litho_pairs : set[tuple[UUID, UUID]] | None
        The canonical litho-layer pairs that are GENUINE approved litho ties
        (the pre-bridge set) — bridged jump pairs must not be in it. Decides
        each emitted edge's approval per the owner's 2026-08-06 refinement of
        ruling A ("all ties are born unaccepted except those that are already
        ties in the litho model"): an edge is born ACCEPTED only when it
        RESTATES a litho tie — its litho pair is direct AND its endpoints are
        the TOP sub-band of each stack, i.e. the tie connects the same contact
        surfaces the engineer tied at the litho level. Every other pair — the
        packing-density boundaries the machine invented inside the body, and
        every bridged jump pair — is a NEW claim and arrives as a pending
        proposal for the accept/reject flow (and the divide gate) to judge.
        ``None`` means every pair in ``litho_approved_edges`` is direct.
    litho_sided_edges : set[tuple[UUID, UUID, str, str]] | None
        Every DIRECT litho edge as ``(min_id, max_id, side_of_min,
        side_of_max)`` (see :func:`load_approved_litho_edge_sets`).  Each
        non-top↔top edge restates side-preserved onto the bands owning the
        same contact surfaces: a base side maps to the unit's DEEPEST band,
        a top side to its TOPMOST — so bottom ties reach the sub-TD
        substrate and the mixed onlap declarations carry down instead of
        being silently rewritten as top↔top (owner ruling 2026-08-14,
        "litho consistency should be 100%").  It also gates the forced
        topmost alignment: a pair with NO top↔top litho tie gets the plain
        LCS, because nothing licenses a forced top pair there.  ``None``
        keeps the 2026-08-13 behaviour (every direct pair treated as
        top↔top-tied; no sided restatements) for legacy callers.
    seen_sided_edges : set[tuple[UUID, UUID, str, str]] | None
        Dedup set for sided restatements, MUTATED in place — separate from
        ``seen_layer_pairs`` on purpose: the pair-only key deliberately lets
        an existing tie suppress a top↔top PROPOSAL, but a single-band unit
        must be able to carry its top, base and mixed restatements on one
        layer pair.  ``None`` starts an empty per-call set.
    source : str
        Provenance token stamped on each emitted edge, one of ``'manual'`` /
        ``'auto'`` (DB CHECK). Defaults to ``AUTO_SOURCE`` — ``'manual'`` is
        what the engineer's own boundary-click gesture writes, and a derived
        tie claiming it is how hand work and machine work became
        indistinguishable in the first place.

    Returns
    -------
    EdgeDerivationCounts
        Emitted + per-reason skip counts for this section.
    """
    sorted_geotech: dict[str, list[tuple[float, float, UUID, UUID, int | None]]] = {
        inv_id: sorted(intervals, key=lambda t: t[0])
        for inv_id, intervals in geotech_layer_by_inv_depth.items()
    }

    def _stack(inv_str: str, lit_top: float, lit_base: float) -> list[tuple[str, int | None]]:
        """Geotech sub-band stack (layer_id, nad_class) within a litho unit, top→base.

        Tolerates trailing tuple elements past the first five: SAB passes
        ``(top, base, layer_id, formation_id, nad_class)`` while DivideBoreholes
        passes a sixth ``body_id`` — both flow through ``*_rest`` unchanged.
        """
        out: list[tuple[str, int | None]] = []
        for row in sorted_geotech.get(inv_str, []):
            # (top, base, layer_id, formation_id, nad_class, [body_id, ...]).
            top, base, layer_id, nad = row[0], row[1], row[2], row[4]
            if top >= lit_top - _DEPTH_TOL_M and base <= lit_base + _DEPTH_TOL_M:
                out.append((str(layer_id), nad))
        return out

    counts = EdgeDerivationCounts()
    direct = direct_litho_pairs if direct_litho_pairs is not None else litho_approved_edges
    sided_seen = seen_sided_edges if seen_sided_edges is not None else set()
    # Sided litho edges grouped by canonical pair, for the per-pair loop.
    sided_by_pair: dict[tuple[UUID, UUID], list[tuple[str, str]]] = {}
    if litho_sided_edges is not None:
        for a, b, sa, sb in litho_sided_edges:
            sided_by_pair.setdefault((a, b), []).append((sa, sb))

    def _emit_sided_restatement(
        left_stack: list[tuple[str, int | None]],
        right_stack: list[tuple[str, int | None]],
        side_a: str,
        side_b: str,
    ) -> None:
        """Restate one sided litho tie onto the bands owning its contacts.

        A ``top`` side maps to the unit's TOPMOST band, a ``base`` side to
        its DEEPEST — the band that owns the very contact surface the litho
        tie joins. Sides travel with their endpoints through
        canonicalisation.
        """
        la_id, la_cls = left_stack[0] if side_a == "top" else left_stack[-1]
        rb_id, rb_cls = right_stack[0] if side_b == "top" else right_stack[-1]
        if la_cls is None or rb_cls is None:
            # Skeleton bands never auto-tie (spec §8) — a sided restatement
            # is blocked exactly like the topmost one.
            return
        band_a, band_b = UUID(la_id), UUID(rb_id)
        if band_a == band_b:
            return  # intra-investigation edge — forbidden
        key = (
            (band_a, band_b, side_a, side_b)
            if band_a < band_b
            else (band_b, band_a, side_b, side_a)
        )
        if key in sided_seen:
            counts.skipped_existing_pair += 1
            return
        sided_seen.add(key)
        session.add(
            LithoContactCorrelationEdgeOrm(
                id=uuid7(),
                model_id=geotech_model_id,
                section_id=section_id,
                layer_a_id=key[0],
                layer_b_id=key[1],
                layer_a_side=key[2],
                layer_b_side=key[3],
                source=source,
                # A sided restatement carries the litho approval down exactly
                # like the topmost one — the engineer tied these very contact
                # surfaces at the litho level.
                user_approved=True,
            )
        )
        counts.edges_emitted += 1
        counts.edges_accepted += 1

    for litho_a_id, litho_b_id in litho_approved_edges:
        entry_a = litho_layer_depths.get(litho_a_id)
        entry_b = litho_layer_depths.get(litho_b_id)
        if entry_a is None or entry_b is None:
            counts.skipped_no_litho_depth += 1
            continue

        inv_a_str, top_a, base_a = entry_a
        inv_b_str, top_b, base_b = entry_b

        left_stack = _stack(inv_a_str, top_a, base_a)
        right_stack = _stack(inv_b_str, top_b, base_b)

        # The restating pair joins the very contact surfaces the litho tie
        # joins, so it is only computable when the pair is a direct litho tie
        # — and for a direct tie WITH a top↔top litho edge the topmost pair
        # is FORCED regardless of class (owner ruling 2026-08-13). A pair
        # whose only litho tie is mixed or base↔base gets the plain LCS
        # (nothing licenses a forced top pair), and a bridged jump pair was
        # inferred, not drawn, so nothing licenses a cross-class connection
        # there either.
        pair_is_direct = (litho_a_id, litho_b_id) in direct
        pair_sides = sided_by_pair.get((litho_a_id, litho_b_id))
        has_top_top = ("top", "top") in pair_sides if pair_sides is not None else True
        aligned = (
            aligned_pairs_with_forced_top(left_stack, right_stack)
            if pair_is_direct and has_top_top
            else aligned_same_class_pairs(left_stack, right_stack)
        )

        # Side-aware restatements (owner ruling 2026-08-14): every non-top↔top
        # direct litho tie — bottom ties AND the mixed onlap declarations —
        # restates onto the bands owning its contact surfaces, sides kept.
        if pair_is_direct and pair_sides and left_stack and right_stack:
            for side_a, side_b in pair_sides:
                if (side_a, side_b) != ("top", "top"):
                    _emit_sided_restatement(left_stack, right_stack, side_a, side_b)

        left_classes = [c for _, c in left_stack]
        right_classes = [c for _, c in right_stack]
        if aligned:
            log.debug(
                f"derive_geotech_edges_from_litho: litho_edge "
                f"{litho_a_id}↔{litho_b_id} "
                f"left_classes={left_classes} right_classes={right_classes} "
                f"→ {len(aligned)} LCS pair(s)"
            )
        else:
            if left_stack and right_stack:
                counts.skipped_no_lcs += 1
                log.debug(
                    f"derive_geotech_edges_from_litho: litho_edge "
                    f"{litho_a_id}↔{litho_b_id} "
                    f"inv_a={inv_a_str} inv_b={inv_b_str} "
                    f"left_classes={left_classes} right_classes={right_classes} "
                    f"→ no LCS (disjoint classes — engineer connects manually)"
                )
            else:
                counts.skipped_empty_stack += 1
                log.debug(
                    f"derive_geotech_edges_from_litho: litho_edge "
                    f"{litho_a_id}↔{litho_b_id} "
                    f"inv_a={inv_a_str} inv_b={inv_b_str} "
                    f"left_bands={len(left_stack)} right_bands={len(right_stack)} "
                    f"→ skipped (empty geotech stack for one endpoint)"
                )
            continue

        nad_by_layer = dict(left_stack) | dict(right_stack)
        pairs_skipped_null = 0

        for la, rb in aligned:
            # Defensive null-skip (both aligners already exclude None, but
            # guard BOTH sides so a future helper change can't emit a
            # skeleton auto-edge).
            if nad_by_layer.get(la) is None or nad_by_layer.get(rb) is None:
                pairs_skipped_null += 1
                continue

            geotech_a_id = UUID(la)
            geotech_b_id = UUID(rb)
            if geotech_a_id == geotech_b_id:
                continue  # intra-investigation edge — forbidden

            canonical_a, canonical_b = (
                (geotech_a_id, geotech_b_id)
                if geotech_a_id < geotech_b_id
                else (geotech_b_id, geotech_a_id)
            )
            if (canonical_a, canonical_b) in seen_layer_pairs:
                counts.skipped_existing_pair += 1
                continue
            seen_layer_pairs.add((canonical_a, canonical_b))

            restates_litho_tie = (
                pair_is_direct
                and has_top_top
                and bool(left_stack)
                and bool(right_stack)
                and la == left_stack[0][0]
                and rb == right_stack[0][0]
            )
            session.add(
                LithoContactCorrelationEdgeOrm(
                    id=uuid7(),
                    model_id=geotech_model_id,
                    section_id=section_id,
                    layer_a_id=canonical_a,
                    layer_b_id=canonical_b,
                    layer_a_side="top",
                    layer_b_side="top",
                    source=source,
                    user_approved=restates_litho_tie,
                )
            )
            counts.edges_emitted += 1
            if restates_litho_tie:
                counts.edges_accepted += 1
            else:
                counts.edges_proposed += 1

        if pairs_skipped_null:
            log.debug(
                f"derive_geotech_edges_from_litho: {pairs_skipped_null} null-class "
                f"band(s) skipped on litho_edge {litho_a_id}↔{litho_b_id} (spec §8)"
            )

    await session.flush()
    return counts
