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
stack inside that litho unit on each test, aligns the two NAD-class sequences
with ``aligned_same_class_pairs`` (LCS), and emits one geotech edge per aligned
pair.  The caller controls the dedup scope by passing a ``seen_layer_pairs``
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

Every edge this module writes, whichever caller asked for it, is a SUGGESTION:
unapproved, ``source='auto'``.  The clean/dirty rule (owner, 2026-08-01) draws
the line at acceptance, not at intent — a tie the program worked out is dirty
even when the engineer asked for the build that produced it, because he has not
yet looked at this particular tie.  The engineer promotes it with the accept
verb, mirroring the litho axis.  Until 2026-08-01 the defaults said the
opposite (``user_approved=True, source='manual'``) and the two build callers
took them bare, so 217 derived ties on the real model were stamped as though an
engineer had drawn each one by hand — hand and machine work were
indistinguishable, and a rebuild destroyed both.
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
from groundmodel.domain.services.geotech_packing_edges import aligned_same_class_pairs
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


async def load_approved_litho_edges(
    session: AsyncSession, litho_model_id: UUID, section_id: UUID
) -> set[tuple[UUID, UUID]]:
    """Load a section's approved litho edges as canonical ``(min, max)`` pairs.

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
    set[tuple[UUID, UUID]]
        Canonical layer-id pairs of approved litho edges on the section.
    """
    rows = (
        await session.execute(
            select(
                LithoContactCorrelationEdgeOrm.layer_a_id,
                LithoContactCorrelationEdgeOrm.layer_b_id,
            ).where(
                LithoContactCorrelationEdgeOrm.model_id == litho_model_id,
                LithoContactCorrelationEdgeOrm.section_id == section_id,
                LithoContactCorrelationEdgeOrm.user_approved.is_(True),
            )
        )
    ).all()
    return {(min(a, b), max(a, b)) for a, b in rows}


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
    user_approved: bool = True,
    source: str = AUTO_SOURCE,
) -> EdgeDerivationCounts:
    """Emit geotech edges by LCS packing match within each correlated litho unit.

    For each approved litho edge, this resolves the litho unit's depth extent on
    each test, collects the geotech sub-band stack (``layer_id, nad_class``,
    top→base) that falls WITHIN that unit, aligns the two NAD-class sequences via
    ``aligned_same_class_pairs`` (LCS; ``None`` classes never match — skeleton
    bands stay unconnected), and emits one geotech edge per aligned pair.

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
    user_approved : bool
        Approval flag stamped on each emitted edge. Defaults to ``True``
        (owner ruling A, 2026-08-05): every edge this function emits sits
        INSIDE a litho correlation the engineer already approved — directly,
        or via a bridged chain of approved litho edges — and the same-class
        packing pairing within an approved litho band is a mechanical
        refinement of that approval, not a new geological claim. Approval at
        the litho level therefore carries down. The proposal flow (pending +
        accept verbs + the divide gate) remains live for any edge that is NOT
        litho-backed — pass ``False`` for those, stating the reason at the
        call site.
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

        aligned = aligned_same_class_pairs(left_stack, right_stack)

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
            # Defensive null-skip (aligned_same_class_pairs already excludes
            # None, but guard so a future helper change can't emit a skeleton
            # auto-edge).
            if nad_by_layer.get(la) is None:
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
                    user_approved=user_approved,
                )
            )
            counts.edges_emitted += 1

        if pairs_skipped_null:
            log.debug(
                f"derive_geotech_edges_from_litho: {pairs_skipped_null} null-class "
                f"band(s) skipped on litho_edge {litho_a_id}↔{litho_b_id} (spec §8)"
            )

    await session.flush()
    return counts
