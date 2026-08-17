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

from collections.abc import Callable, Sequence
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
from groundmodel.domain.services.geotech_edge_crossing_guard import (
    GapTie,
    crossing_partners,
    gap_key,
)
from groundmodel.domain.services.geotech_jump_tie_supersession import (
    GeotechEdgeForSupersession,
)
from groundmodel.domain.services.geotech_packing_edges import (
    aligned_pairs_with_forced_top,
    aligned_same_class_pairs,
    overlap_gated_interior_pairs,
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
    # Candidates refused because they would CROSS a tie already standing in the
    # same gap (owner §8 Q4: a crossing is a hard conflict — neither side bands
    # and the section warns until it is resolved)). Counted separately from
    # ``skipped_existing_pair`` because it means something quite different: not
    # "already there" but "would have broken the fill on that gap".
    skipped_crossing_tie: int = 0
    # Candidates refused because the engineer DELETED this tie before (owner
    # 2026-08-17: "a tie i delete stays deleted"), matched by place — the
    # bands are rebuilt every subdivide, so ids cannot carry the memory.
    skipped_tombstoned: int = 0

    def add(self, other: EdgeDerivationCounts) -> None:
        """Accumulate another pass's counters into this one."""
        self.edges_emitted += other.edges_emitted
        self.edges_accepted += other.edges_accepted
        self.edges_proposed += other.edges_proposed
        self.skipped_no_litho_depth += other.skipped_no_litho_depth
        self.skipped_no_lcs += other.skipped_no_lcs
        self.skipped_empty_stack += other.skipped_empty_stack
        self.skipped_existing_pair += other.skipped_existing_pair
        self.skipped_crossing_tie += other.skipped_crossing_tie
        self.skipped_tombstoned += other.skipped_tombstoned


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
        sided_edges={(a, b, sa, sb) if a < b else (b, a, sb, sa) for a, b, sa, sb in rows},
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
    return await _sided_edges_by_section(session, geotech_model_id, approved_only=False)


async def load_accepted_geotech_sided_edges_by_section(
    session: AsyncSession, geotech_model_id: UUID
) -> dict[UUID, set[tuple[UUID, UUID, str, str]]]:
    """Load the APPROVED geotech edges with their sides, keyed by section.

    Seeds the derivation's crossing guard.  Approvals only, because a crossing
    is judged against what actually paints: the renderer feeds the fill
    ``user_approved`` edges alone, so a pending proposal beside another pending
    proposal costs nothing until one of them is accepted.

    Parameters
    ----------
    session : AsyncSession
        Active DB session.
    geotech_model_id : UUID
        The geotech model.

    Returns
    -------
    dict[UUID, set[tuple[UUID, UUID, str, str]]]
        ``section_id → {(min_id, max_id, side_of_min, side_of_max), ...}`` for
        the approved edges only.
    """
    return await _sided_edges_by_section(session, geotech_model_id, approved_only=True)


async def _sided_edges_by_section(
    session: AsyncSession, geotech_model_id: UUID, *, approved_only: bool
) -> dict[UUID, set[tuple[UUID, UUID, str, str]]]:
    """Shared body of the two sided-edge loaders — one query, one canonicalisation."""
    stmt = select(
        LithoContactCorrelationEdgeOrm.section_id,
        LithoContactCorrelationEdgeOrm.layer_a_id,
        LithoContactCorrelationEdgeOrm.layer_b_id,
        LithoContactCorrelationEdgeOrm.layer_a_side,
        LithoContactCorrelationEdgeOrm.layer_b_side,
    ).where(LithoContactCorrelationEdgeOrm.model_id == geotech_model_id)
    if approved_only:
        stmt = stmt.where(LithoContactCorrelationEdgeOrm.user_approved.is_(True))
    rows = (await session.execute(stmt)).all()
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


async def load_geotech_edges_for_supersession(
    session: AsyncSession, geotech_model_id: UUID, section_id: UUID
) -> list[GeotechEdgeForSupersession]:
    """Load one section's geotech edges as the jump-tie supersession needs them.

    The supersession judgment (owner ruling 2026-08-14: a CPT↔CPT tie that
    jumps a column is REPLACED by the mediated chain once "Divide boreholes"
    materialises it) needs each edge's endpoint bands AND the investigation
    each band sits on — the investigation is what the section's along-position
    map is keyed by, and the span between the two is what decides whether the
    tie jumps anything at all.

    Parameters
    ----------
    session : AsyncSession
        Active DB session.
    geotech_model_id : UUID
        The geotech model.
    section_id : UUID
        The section whose edges to load — edges are section-scoped, and a
        chain on another section proves nothing about this one's jump tie.

    Returns
    -------
    list[GeotechEdgeForSupersession]
        Every edge on the section, with stringified investigation ids.  An
        edge whose endpoint row has vanished mid-flight is skipped — it cannot
        be judged and the FK cascade is already deleting it.
    """
    edge_rows = (
        await session.execute(
            select(
                LithoContactCorrelationEdgeOrm.id,
                LithoContactCorrelationEdgeOrm.layer_a_id,
                LithoContactCorrelationEdgeOrm.layer_b_id,
                LithoContactCorrelationEdgeOrm.user_approved,
            ).where(
                LithoContactCorrelationEdgeOrm.model_id == geotech_model_id,
                LithoContactCorrelationEdgeOrm.section_id == section_id,
            )
        )
    ).all()
    layer_ids = {r.layer_a_id for r in edge_rows} | {r.layer_b_id for r in edge_rows}
    if not layer_ids:
        return []
    inv_rows = (
        await session.execute(
            select(LithoLayerOrm.id, LithoLayerOrm.cpt_id, LithoLayerOrm.borehole_id).where(
                LithoLayerOrm.id.in_(layer_ids)
            )
        )
    ).all()
    inv_by_layer = {
        r.id: str(r.borehole_id if r.borehole_id is not None else r.cpt_id) for r in inv_rows
    }
    edges: list[GeotechEdgeForSupersession] = []
    for r in edge_rows:
        inv_a = inv_by_layer.get(r.layer_a_id)
        inv_b = inv_by_layer.get(r.layer_b_id)
        if inv_a is None or inv_b is None:
            continue
        edges.append(
            GeotechEdgeForSupersession(
                edge_id=r.id,
                layer_a_id=r.layer_a_id,
                layer_b_id=r.layer_b_id,
                investigation_a=inv_a,
                investigation_b=inv_b,
                user_approved=r.user_approved,
            )
        )
    return edges


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


def band_at_contact(
    stack: Sequence[tuple[Any, ...]], contact_depth_m: float
) -> tuple[UUID, str] | None:
    """Which band owns the contact at a depth, and on which of its surfaces.

    Owner, 2026-08-17: *"of course you make a copy and tie it to the actual depth
    of the contact? ... Can't work in x,y,z space without using x,y,z
    coordinates."*

    A tie names a CONTACT — a surface at a depth on a column.  Storing it as
    (layer, side) is lossy, because the two ends of one litho tie are not
    recorded the same way: one names the layer below the contact (side ``top``),
    the other the layer above it (side ``base``).  Copying that pair by identity
    tied a clay band to a sand band across a contact that is clay-over-sand on
    both columns.

    It also produced every crossing on his model.  All four were machine-made,
    and one CPT contact had been tied to two different borehole depths — two
    lines from one point, which must cross something.

    Parameters
    ----------
    stack : Sequence[tuple[Any, ...]]
        One column's packing bands as ``(top, base, layer_id, ...)``, any order.
    contact_depth_m : float
        The contact's depth on that column.

    Returns
    -------
    tuple[UUID, str] | None
        ``(layer_id, side)`` — the band starting at that depth and ``'top'``, or
        the deepest band and ``'base'`` where nothing starts there.  ``None``
        when the depth is not a contact on this column at all: mid-band is not a
        surface, and inventing one is exactly how this went wrong.
    """
    for row in stack:
        if abs(float(row[0]) - contact_depth_m) <= _DEPTH_TOL_M:
            return (row[2] if isinstance(row[2], UUID) else UUID(str(row[2]))), "top"
    for row in stack:
        if abs(float(row[1]) - contact_depth_m) <= _DEPTH_TOL_M:
            return (row[2] if isinstance(row[2], UUID) else UUID(str(row[2]))), "base"
    return None


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
    existing_accepted_sided_edges: set[tuple[UUID, UUID, str, str]] | None = None,
    source: str = AUTO_SOURCE,
    born_accepted: bool = False,
    tie_tombstoned: Callable[[str, float, str, float], bool] | None = None,
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
    existing_accepted_sided_edges : set[tuple[UUID, UUID, str, str]] | None
        Already-APPROVED geotech edges on this section, ``(min_id, max_id,
        side_of_min, side_of_max)``, used to seed the crossing guard.  The
        owner's banner appeared the instant he pressed step 2, which means the
        tie the new proposal crossed was already in the model — a hand-drawn
        tie, an earlier accept-all, or a Divide-boreholes restatement.  ``None``
        checks only what this pass emits itself.
    source : str
        Provenance token stamped on each emitted edge, one of ``'manual'`` /
        ``'auto'`` (DB CHECK). Defaults to ``AUTO_SOURCE`` — ``'manual'`` is
        what the engineer's own boundary-click gesture writes, and a derived
        tie claiming it is how hand work and machine work became
        indistinguishable in the first place.
    born_accepted : bool
        Emit every edge ``user_approved=True``, restatement or not.  Owner
        ruling 2026-08-15, after dogfeeding the two-press loop: *"subdivision
        hops should be born accepted"*.  Set by "4 · Divide boreholes" ONLY:
        the hops it writes re-express, through the borehole it has just
        divided, correlations the engineer already drew — they are not the
        machine proposing a correlation he has not made, so asking him to
        accept them turns one press into press-accept-press (and a second
        press only manufactures more).  Step 2 (auto-correlate) leaves it
        ``False``: there a proposal genuinely IS a new machine claim and stays
        a ghost for the review flow.

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

    def _stack_with_fractions(
        inv_str: str, lit_top: float, lit_base: float
    ) -> list[tuple[str, int | None, float, float]]:
        """Like ``_stack`` but with each band's fraction extent in the litho
        window (0 = unit top, 1 = unit base) — the interior proposal pass
        gates on fraction overlap."""
        height = lit_base - lit_top
        if height <= _DEPTH_TOL_M:
            return []
        out: list[tuple[str, int | None, float, float]] = []
        for row in sorted_geotech.get(inv_str, []):
            top, base, layer_id, nad = row[0], row[1], row[2], row[4]
            if top >= lit_top - _DEPTH_TOL_M and base <= lit_base + _DEPTH_TOL_M:
                out.append(
                    (
                        str(layer_id),
                        nad,
                        max(0.0, (top - lit_top) / height),
                        min(1.0, (base - lit_top) / height),
                    )
                )
        return out

    # --- crossing guard (owner §8 Q4: a crossing tie is a HARD CONFLICT) -----
    # Every band's home column + its two surfaces, so an (id, side) endpoint
    # resolves to the depth the guard compares. Depth below collar, not
    # elevation: both differences the crossing test takes are WITHIN one column,
    # so the sign flip cancels and the two spaces agree (see the guard module).
    # Every band's packing class, for the skeleton guard on a depth-resolved
    # endpoint (a resolution by depth never carries the class along with it).
    nad_by_band: dict[str, int | None] = {
        str(row[2]): row[4] for intervals in sorted_geotech.values() for row in intervals
    }
    band_home: dict[str, tuple[str, float, float]] = {
        str(row[2]): (inv_str, float(row[0]), float(row[1]))
        for inv_str, intervals in sorted_geotech.items()
        for row in intervals
    }
    # gap (sorted investigation pair) → the ties already standing there, in
    # registration order: persisted approvals first, then this pass's own.
    ties_by_gap: dict[tuple[str, str], list[GapTie]] = {}

    def _as_gap_tie(
        layer_a: str, side_a: str, layer_b: str, side_b: str, accepted: bool
    ) -> tuple[tuple[str, str], GapTie] | None:
        """Reduce an endpoint pair to its gap + the two depths it joins there.

        Returns ``None`` when either band's home column is unknown (a stale or
        foreign endpoint) or when both endpoints sit on the same investigation
        — neither spans a gap, so neither can cross anything.
        """
        home_a = band_home.get(layer_a)
        home_b = band_home.get(layer_b)
        if home_a is None or home_b is None:
            return None
        inv_a, top_a_m, base_a_m = home_a
        inv_b, top_b_m, base_b_m = home_b
        if inv_a == inv_b:
            return None
        depth_a = top_a_m if side_a == "top" else base_a_m
        depth_b = top_b_m if side_b == "top" else base_b_m
        key = gap_key(inv_a, inv_b)
        if key[0] == inv_a:
            return key, GapTie(depth_a, depth_b, accepted, layer_a, layer_b)
        return key, GapTie(depth_b, depth_a, accepted, layer_b, layer_a)

    counts = EdgeDerivationCounts()

    def _may_land(layer_a: str, side_a: str, layer_b: str, side_b: str, accepted: bool) -> bool:
        """Register a candidate tie, or refuse it because it would cross.

        An ACCEPTED candidate is judged only against accepted neighbours: a
        pending proposal may never veto an approval, or the derivation would
        quietly drop a restatement the engineer drew at the litho stage.  A
        PENDING candidate is judged against everything already standing in its
        gap.  A tie whose endpoints do not resolve to two different columns
        spans no gap and cannot cross anything, so it lands unjudged.

        Returns ``True`` when the caller may emit (the tie is now registered)
        and ``False`` when it must skip — already counted and logged here.
        """
        resolved = _as_gap_tie(layer_a, side_a, layer_b, side_b, accepted)
        if resolved is None:
            return True
        key, candidate = resolved
        # The engineer deleted this tie before — it stays deleted (owner
        # 2026-08-17). Judged by PLACE via the caller's closure, because band
        # ids die at every rebuild. Checked at this single gate so every emit
        # path — restatements, aligned pairs, interior proposals — obeys it.
        if tie_tombstoned is not None and tie_tombstoned(
            key[0], candidate.depth_first_m, key[1], candidate.depth_second_m
        ):
            counts.skipped_tombstoned += 1
            log.info(
                f"derive_geotech_edges_from_litho: withheld a tie the engineer "
                f"deleted - {key[0]} at {candidate.depth_first_m:.2f} m to "
                f"{key[1]} at {candidate.depth_second_m:.2f} m"
            )
            return False
        standing = ties_by_gap.setdefault(key, [])
        judged = [t for t in standing if t.accepted] if accepted else standing
        blocking = crossing_partners(judged, candidate)
        if blocking:
            counts.skipped_crossing_tie += 1
            other = blocking[0]
            # INFO, not DEBUG: the machine is declining to emit something the
            # engineer asked for, and the reason is geometric — unreadable from
            # the result alone. Both endpoints of both ties are named, because
            # "1 refused" tells nobody which correlation to look at.
            log.info(
                f"derive_geotech_edges_from_litho: refused a crossing tie in gap "
                f"{key[0]}↔{key[1]} — candidate {layer_a}({side_a}) at "
                f"{candidate.depth_first_m:.3f} m ↔ {layer_b}({side_b}) at "
                f"{candidate.depth_second_m:.3f} m inverts against the standing "
                f"{'accepted' if other.accepted else 'pending'} tie "
                f"{other.layer_first_id} at {other.depth_first_m:.3f} m ↔ "
                f"{other.layer_second_id} at {other.depth_second_m:.3f} m"
            )
            return False
        standing.append(candidate)
        return True

    for a_id, b_id, seed_side_a, seed_side_b in existing_accepted_sided_edges or set():
        seeded = _as_gap_tie(str(a_id), seed_side_a, str(b_id), seed_side_b, True)
        if seeded is not None:
            ties_by_gap.setdefault(seeded[0], []).append(seeded[1])

    direct = direct_litho_pairs if direct_litho_pairs is not None else litho_approved_edges
    sided_seen = seen_sided_edges if seen_sided_edges is not None else set()
    # Sided litho edges grouped by canonical pair, for the per-pair loop.
    sided_by_pair: dict[tuple[UUID, UUID], list[tuple[str, str]]] = {}
    if litho_sided_edges is not None:
        for a, b, sa, sb in litho_sided_edges:
            sided_by_pair.setdefault((a, b), []).append((sa, sb))

    def _emit_sided_restatement(
        inv_a_str: str,
        contact_a_m: float,
        inv_b_str: str,
        contact_b_m: float,
    ) -> None:
        """Restate one sided litho tie onto the bands owning its contacts.

        Owner ruling, 2026-08-17: *"of course you make a copy and tie it to the
        actual depth of the contact? ... Can't work in x,y,z space without using
        x,y,z coordinates."*

        Each end is resolved from its DEPTH — the contact's depth on its own
        column — not from the litho layer's identity and side.  That matters
        because one litho tie records its two ends differently: a mixed
        ``top``/``base`` onlap names the layer BELOW the contact on one column
        and the layer ABOVE it on the other.  Resolving by identity therefore
        tied a clay band to a sand band across a contact that is clay-over-sand
        on both columns — his "weird dense quad".  Resolving by depth returns the
        band starting at the contact on BOTH columns, so the pair is homogeneous
        and the fill draws the region it should.
        """
        resolved_a = band_at_contact(sorted_geotech.get(inv_a_str, []), contact_a_m)
        resolved_b = band_at_contact(sorted_geotech.get(inv_b_str, []), contact_b_m)
        if resolved_a is None or resolved_b is None:
            # The depth is no packing contact on that column — the unit was
            # never subdivided there, or the litho contact falls inside a band.
            # Naming a band anyway is what invented geometry before.
            counts.skipped_empty_stack += 1
            return
        (la_uuid, side_a), (rb_uuid, side_b) = resolved_a, resolved_b
        la_id, rb_id = str(la_uuid), str(rb_uuid)
        la_cls = nad_by_band.get(la_id)
        rb_cls = nad_by_band.get(rb_id)
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
        if not _may_land(str(key[0]), key[2], str(key[1]), key[3], True):
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
        if pair_is_direct and pair_sides:
            for side_a, side_b in pair_sides:
                if (side_a, side_b) != ("top", "top"):
                    _emit_sided_restatement(
                        inv_a_str,
                        top_a if side_a == "top" else base_a,
                        inv_b_str,
                        top_b if side_b == "top" else base_b,
                    )

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

            restates_litho_tie = (
                pair_is_direct
                and has_top_top
                and bool(left_stack)
                and bool(right_stack)
                and la == left_stack[0][0]
                and rb == right_stack[0][0]
            )
            # Whether the row lands approved is a separate question from
            # whether it RESTATES a litho tie: under ``born_accepted`` an
            # interior hop is approved without ever becoming a restatement.
            # The crossing guard is told the approval, because that is what
            # decides whose neighbours may veto it.
            approved = born_accepted or restates_litho_tie
            # A refused candidate is NOT added to ``seen_layer_pairs``: it was
            # never emitted, so a later pass with different neighbours (a
            # re-derive after the engineer resolves the conflict) must be free
            # to reconsider it.
            if not _may_land(str(canonical_a), "top", str(canonical_b), "top", approved):
                continue
            seen_layer_pairs.add((canonical_a, canonical_b))
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
                    user_approved=approved,
                )
            )
            counts.edges_emitted += 1
            if approved:
                counts.edges_accepted += 1
            else:
                counts.edges_proposed += 1

        if pairs_skipped_null:
            log.debug(
                f"derive_geotech_edges_from_litho: {pairs_skipped_null} null-class "
                f"band(s) skipped on litho_edge {litho_a_id}↔{litho_b_id} (spec §8)"
            )

        # Interior body proposals (owner ruling 2026-08-14: "auto correlate is
        # fine, its just a tool to make the users life easier"). The monotone
        # forced-top alignment consumes a unit's top band into the
        # restatement, so a big same-class interior body across the pair could
        # never be proposed and the engineer had to hunt it by hand (CS1
        # gap 3: 287 m² of silt). Propose the overlap-gated pairs the aligned
        # emission did not cover — PENDING, inside this litho window only.
        if pair_is_direct:
            aligned_set = set(aligned)
            interior = overlap_gated_interior_pairs(
                _stack_with_fractions(inv_a_str, top_a, base_a),
                _stack_with_fractions(inv_b_str, top_b, base_b),
            )
            for la, rb in interior:
                if (la, rb) in aligned_set:
                    continue
                geotech_a_id = UUID(la)
                geotech_b_id = UUID(rb)
                if geotech_a_id == geotech_b_id:
                    continue
                canonical_a, canonical_b = (
                    (geotech_a_id, geotech_b_id)
                    if geotech_a_id < geotech_b_id
                    else (geotech_b_id, geotech_a_id)
                )
                if (canonical_a, canonical_b) in seen_layer_pairs:
                    counts.skipped_existing_pair += 1
                    continue
                if not _may_land(str(canonical_a), "top", str(canonical_b), "top", born_accepted):
                    continue
                seen_layer_pairs.add((canonical_a, canonical_b))
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
                        # An interior body pair is a machine claim — pending,
                        # per ruling A. Under ``born_accepted`` (the divide's
                        # own hops) it is instead a re-expression of the
                        # engineer's correlation and lands approved.
                        user_approved=born_accepted,
                    )
                )
                counts.edges_emitted += 1
                if born_accepted:
                    counts.edges_accepted += 1
                else:
                    counts.edges_proposed += 1

    await session.flush()
    return counts
