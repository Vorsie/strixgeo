"""Shared loading + edge bookkeeping for hand split/merge of packing bands.

The preview and both commit use cases read the SAME column state and apply the
SAME edge rule, so that state and that rule live here once rather than three
times.

Column scoping is the owner's ruling 4 ("recalculation is local") expressed in
code: :func:`load_geotech_column_context` filters every query by the edited
band's own anchor, so no other column can be read — and therefore none can be
re-derived — by a hand edit.

That same anchor decides whether the gesture applies at all
(:func:`require_cpt_anchor`, owner ruling A 2026-08-01): a band hanging off a
borehole has no cone resistance behind it, so both gestures are refused there
rather than committed into a class-less skeleton.

Geotech bands are ``litho_layer`` rows in the geotechnical model whose
``geological_formation`` carries ``nad_class`` plus the two parent ids
(``source_litho_formation_id`` / ``source_geo_formation_id``) that form the hard
walls a packing boundary clamps at.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import cast
from uuid import UUID

from sqlalchemy import delete, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.geotech_borehole_materialiser import GeotechBoreholeMaterialiser
from groundmodel.application.geotech_tie_reanchor import (
    REVIEW_AMBIGUOUS_BAND,
    REVIEW_CLASS_CHANGED,
)
from groundmodel.application.view_state_helpers import (
    load_project_view_state,
    read_view_state_float,
)
from groundmodel.domain.services.geotech_band_reclassification import (
    BandEditPlan,
    GeotechBand,
    GeotechBandEditError,
)
from groundmodel.domain.services.representative_statistic import DEFAULT_STATISTIC
from groundmodel.domain.value_objects.admixture import Admixture
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.repositories.litho_layer_repository import LithoLayerRepository
from groundmodel.shared.constants.litho_constants import BASE_LITHOLOGIES, BaseLithology
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# The minimum packing-band thickness knob. Imported from the build rather than
# re-declared so the preview warns against the SAME number the build enforces —
# a second copy would drift the moment one of them is tuned.
from groundmodel.application.subdivide_all_bodies import (  # isort: skip
    _DEFAULT_MIN_THICKNESS_M,
)


@dataclass(frozen=True)
class GeotechColumnContext:
    """Everything a hand edit needs about ONE investigation column.

    Attributes
    ----------
    project_id : UUID
        Owning project.
    geotech_model_id : UUID
        The geotechnical model the bands belong to.
    investigation_id : UUID
        The CPT or borehole the bands sit on — the only column this edit may
        touch.
    anchor_is_cpt : bool
        ``True`` for a CPT anchor, ``False`` for a borehole.
    bands : tuple[GeotechBand, ...]
        Every accepted packing band on the column, ordered top to bottom.
    band_rows : dict[str, LithoLayerOrm]
        ``band_id -> ORM row`` for the same bands, so a commit can mutate them.
    soil : BaseLithology | None
        Main soil type of the edited band's parent litho unit; ``None`` when the
        unit carries no usable soil code (the build's skeleton path).
    admixtures : tuple[Admixture, ...]
        The parent unit's admixtures (clean vs secondary NAD variant).
    depth_m : list[float]
        The column's CPT depth series (empty for a borehole).
    qc_mpa : list[float | None]
        Cone resistance per depth (empty for a borehole).
    min_thickness_m : float
        Configured minimum packing-band thickness — advisory for a hand edit.
    statistic : str
        The model's representative-qc statistic (ruling 7) — read from
        ``geological_model.representative_statistic`` so a hand edit and its
        preview can NEVER disagree with the build (ruling 6). A hand edit under
        a stale model (choice changed, bands not yet re-subdivided) re-derives
        with the CURRENT choice — the model is already flagged stale, which is
        the honest state.
    source_litho_formation_id : UUID
        The edited band's litho parent (a hard wall).
    source_geo_formation_id : UUID | None
        The edited band's geological parent (a hard wall); ``None`` for the open
        shallow band.
    """

    project_id: UUID
    geotech_model_id: UUID
    investigation_id: UUID
    anchor_is_cpt: bool
    bands: tuple[GeotechBand, ...]
    band_rows: dict[str, LithoLayerOrm]
    soil: BaseLithology | None
    admixtures: tuple[Admixture, ...]
    depth_m: list[float]
    qc_mpa: list[float | None]
    min_thickness_m: float
    statistic: str
    source_litho_formation_id: UUID
    source_geo_formation_id: UUID | None


@dataclass(frozen=True)
class GeotechBandEditResult:
    """Outcome of a committed hand split or merge.

    Attributes
    ----------
    geotech_model_id : UUID
        The geotechnical model that was written.
    investigation_id : UUID
        The single column that changed.
    plan : BandEditPlan
        What was committed — the same plan shape the preview returns, so the UI
        can show the realised consequence without a second round-trip.
    layer_ids : tuple[UUID, ...]
        The resulting band rows, top to bottom.
    created_layer_ids : tuple[UUID, ...]
        Rows inserted by this edit.
    deleted_layer_ids : tuple[UUID, ...]
        Rows removed by this edit.
    deleted_edge_ids : tuple[UUID, ...]
        Correlation edges REMOVED — since 2026-08-07 this is narrower than it
        was: pending mismatches withdrawn, plus transfer drops (self-loops /
        duplicates) on an absorb. Accepted mismatches are no longer here —
        they land in ``flagged_edge_ids`` instead (flag-not-drop).
    flagged_edge_ids : tuple[UUID, ...]
        ACCEPTED ties flagged for review (``class_changed`` on a mismatch, or
        ``ambiguous_band`` on a transferred anchor) — surviving rows the
        engineer confirms or deletes via the existing verbs.
    cleared_edge_ids : tuple[UUID, ...]
        Ties whose restored class match self-healed a ``class_changed`` flag.
    """

    geotech_model_id: UUID
    investigation_id: UUID
    plan: BandEditPlan
    layer_ids: tuple[UUID, ...]
    created_layer_ids: tuple[UUID, ...]
    deleted_layer_ids: tuple[UUID, ...]
    deleted_edge_ids: tuple[UUID, ...]
    flagged_edge_ids: tuple[UUID, ...] = ()
    cleared_edge_ids: tuple[UUID, ...] = ()


@dataclass(frozen=True)
class EdgeRef:
    """A correlation edge reduced to what the review rules need.

    Attributes
    ----------
    edge_id : UUID
        The ``litho_contact_correlation_edge`` row.
    layer_a_id, layer_b_id : UUID
        Its two endpoints (canonically ordered in the DB).
    layer_a_side, layer_b_side : str
        Which SURFACE of each endpoint the tie joins (``top`` / ``base``).
        Part of the tie's identity, not decoration: the uniqueness triple is
        ``(model, section, layer_a_id, layer_b_id, layer_a_side,
        layer_b_side)``, so the same two bands legitimately carry a top-to-top
        tie AND a base-to-base tie. Deliberately NOT defaulted for the same
        reason ``user_approved`` is not.
    user_approved : bool
        Whether the engineer accepted this tie. Deliberately NOT defaulted:
        the flag-not-drop rule (owner 2026-08-07) branches on it, and a loader
        that forgot to select it must fail loudly rather than silently treat
        accepted work as droppable machine claims.
    review_reason : str | None
        The persisted review flag (``class_changed`` / ``ambiguous_band``), or
        ``None`` when the tie carries no flag.
    """

    edge_id: UUID
    layer_a_id: UUID
    layer_b_id: UUID
    layer_a_side: str
    layer_b_side: str
    user_approved: bool
    review_reason: str | None

    def side_of(self, layer_id: UUID) -> str:
        """Which surface of ``layer_id`` this tie joins."""
        return self.layer_a_side if self.layer_a_id == layer_id else self.layer_b_side

    def partner_side(self, layer_id: UUID) -> str:
        """Which surface of the OTHER endpoint this tie joins."""
        return self.layer_b_side if self.layer_a_id == layer_id else self.layer_a_side

    def partner_of(self, layer_id: UUID) -> UUID:
        """The endpoint that is not ``layer_id``."""
        return self.layer_b_id if self.layer_a_id == layer_id else self.layer_a_id


def require_cpt_anchor(context: GeotechColumnContext, *, gesture: str) -> None:
    """Refuse a hand edit whose band hangs off a borehole (owner ruling A).

    A borehole records no cone resistance, and every rule below this one assumes
    there is qc to re-derive a class from. Letting the gesture through would take
    the class ``DivideBoreholes`` extrapolated onto the column from the
    surrounding CPTs and replace it with a ``nad_class=None`` skeleton — the
    edit would destroy information rather than change it. So the answer is no,
    and it is no here rather than only in the UI, so the API cannot be driven
    around the gesture surface.

    The test is the BAND's own anchor, not the column's neighbourhood: the
    ``litho_layer`` anchor is a database-enforced XOR (``litho_layer_anchor_xor``
    — a row hangs off a CPT or off a borehole, never both), so a borehole that
    happens to stand a few metres from a CPT is still a borehole here.

    Called by the preview and by both commits — a preview that said yes to an
    edit the commit refuses would be worse than either refusal on its own.

    Parameters
    ----------
    context : GeotechColumnContext
        The loaded column, carrying the edited band's anchor.
    gesture : str
        ``"Split"`` or ``"Merge"`` — opens the message the same way the
        hierarchy refusals in ``geotech_band_reclassification`` open theirs.

    Raises
    ------
    GeotechBandEditError
        When the band is anchored on a borehole. The message names the cause
        (no cone resistance) and the way round it, because the engineer has just
        seen the same gesture work one column along.
    """
    if context.anchor_is_cpt:
        return
    raise GeotechBandEditError(
        f"{gesture} rejected: this packing band sits on a borehole, and a borehole "
        "records no cone resistance. A hand-edited band's NAD packing class is "
        "re-derived from the qc over its new extent, so there is nothing here to "
        "re-derive it from. The class on this column was extrapolated from the "
        "surrounding CPTs by 'Divide boreholes' — edit the packing bands on a CPT "
        "column instead, then re-run 'Divide boreholes' to carry the change across."
    )


@dataclass(frozen=True)
class EdgeActions:
    """What a class re-derivation does to each affected correlation edge.

    Attributes
    ----------
    to_delete : tuple[UUID, ...]
        PENDING edges whose endpoints no longer share a class — a machine
        proposal the machine may withdraw (regenerating it is the build's job).
    to_flag : tuple[UUID, ...]
        ACCEPTED edges whose endpoints no longer share a class — flagged
        ``class_changed`` for the engineer to confirm or delete (owner ruling
        2026-08-07: accepted work never disappears from a machine decision).
        Edges already carrying ``class_changed`` are not re-listed
        (idempotent).
    to_clear : tuple[UUID, ...]
        Edges whose match is RESTORED and whose flag is ``class_changed`` —
        the self-heal: drag-away-then-drag-back is a true no-op. Only this
        token clears; ``ambiguous_band`` names an anchor-identity doubt a
        class match does not resolve.
    """

    to_delete: tuple[UUID, ...]
    to_flag: tuple[UUID, ...]
    to_clear: tuple[UUID, ...]


def edge_review_actions(
    *,
    edges: Sequence[EdgeRef],
    new_class_by_layer_id: dict[UUID, int | None],
    class_by_layer_id: dict[UUID, int | None],
) -> EdgeActions:
    """Judge each edge against the re-derived classes — flag-not-drop.

    Ruling 4 said "a connection breaks if the new class no longer matches";
    the owner's 2026-08-07 refinement says HOW it breaks depends on who made
    it: a pending machine claim is withdrawn, an ACCEPTED tie is flagged for
    the engineer's own judgement. A band with no class never matches (the
    skeleton rule). An endpoint's effective class is its NEW class when it
    was just edited (a move edits two rows at once), else its current one.

    Pure — no session — so the rule is testable on its own.

    Parameters
    ----------
    edges : Sequence[EdgeRef]
        Every edge with an endpoint on an edited layer.
    new_class_by_layer_id : dict[UUID, int | None]
        The re-derived class of each edited layer.
    class_by_layer_id : dict[UUID, int | None]
        Current NAD class of the (unedited) partner layers.

    Returns
    -------
    EdgeActions
        Deletions (pending), flags (accepted mismatches), clears (self-heal),
        each in input order.
    """
    to_delete: list[UUID] = []
    to_flag: list[UUID] = []
    to_clear: list[UUID] = []

    def effective(layer_id: UUID) -> int | None:
        if layer_id in new_class_by_layer_id:
            return new_class_by_layer_id[layer_id]
        return class_by_layer_id.get(layer_id)

    for edge in edges:
        class_a = effective(edge.layer_a_id)
        class_b = effective(edge.layer_b_id)
        matched = class_a is not None and class_b is not None and class_a == class_b
        if not matched:
            if not edge.user_approved:
                to_delete.append(edge.edge_id)
            elif edge.review_reason is None:
                to_flag.append(edge.edge_id)
            # Already flagged: leave the existing token alone. Re-stamping an
            # ``ambiguous_band`` tie as ``class_changed`` would hand it to the
            # self-heal below, and the next restored match would clear a review
            # the engineer never gave — the badge must survive until they act.
        elif edge.review_reason == REVIEW_CLASS_CHANGED:
            to_clear.append(edge.edge_id)
    return EdgeActions(tuple(to_delete), tuple(to_flag), tuple(to_clear))


def tie_key(
    layer_a_id: UUID, layer_a_side: str, layer_b_id: UUID, layer_b_side: str
) -> tuple[UUID, str, UUID, str]:
    """Canonical identity of a tie: BOTH endpoints and BOTH surfaces.

    Mirrors the database uniqueness triple. Keying on ids alone would read a
    base-to-base tie as a duplicate of a top-to-top tie between the same two
    bands — two different claims about two different surfaces.

    Parameters
    ----------
    layer_a_id, layer_b_id : UUID
        The endpoints, in any order.
    layer_a_side, layer_b_side : str
        Each endpoint's surface (``top`` / ``base``), paired with its own id.

    Returns
    -------
    tuple[UUID, str, UUID, str]
        The pair ordered by id, each side travelling with its own endpoint.
    """
    if layer_a_id < layer_b_id:
        return (layer_a_id, layer_a_side, layer_b_id, layer_b_side)
    return (layer_b_id, layer_b_side, layer_a_id, layer_a_side)


@dataclass(frozen=True)
class ExistingTie:
    """A tie the survivor already carries, for the duplicate test.

    Attributes
    ----------
    edge_id : UUID
        The existing row.
    user_approved : bool
        Whether it is the engineer's tie or a machine proposal — decides who
        wins the slot when a transfer lands on it.
    """

    edge_id: UUID
    user_approved: bool


@dataclass(frozen=True)
class TransferMove:
    """One accepted tie re-anchored from an absorbed band to its survivor.

    Attributes
    ----------
    edge_id : UUID
        The edge row to re-point.
    new_layer_a_id, new_layer_b_id : UUID
        The endpoints after the re-point, in canonical ``a < b`` order.
    swap_sides : bool
        Whether the two side columns must swap along with the ids to keep
        each side paired with its own endpoint (the canonical-order rule of
        ``canonical_contact_order``).
    review_reason : str
        ``class_changed`` when the survivor's class mismatches the partner's,
        else ``ambiguous_band`` (class-consistent, but the anchor band changed
        identity) — cleared by the existing Confirm-tie verbs.
    """

    edge_id: UUID
    new_layer_a_id: UUID
    new_layer_b_id: UUID
    swap_sides: bool
    review_reason: str


@dataclass(frozen=True)
class EdgeTransferPlan:
    """What happens to the absorbed band's edges (pure decision).

    Attributes
    ----------
    moves : tuple[TransferMove, ...]
        Accepted ties re-anchored onto the survivor.
    drops : tuple[UUID, ...]
        Accepted ties that CANNOT transfer — a self-loop (partner IS the
        survivor) or a duplicate of a tie the survivor already carries. A
        duplicate is the same tie, not lost work; both are deleted and
        counted. Pending edges appear in neither list — the row delete's FK
        cascade takes them, which is correct for machine claims.
    displaced_edge_ids : tuple[UUID, ...]
        PENDING ties ON THE SURVIVOR whose slot an accepted transfer takes.
        Flag-not-drop applied to the collision itself: when the two claims to
        one slot are the engineer's and the machine's, the engineer's wins and
        the proposal is withdrawn. Deleted BEFORE the moves are written, so the
        re-point never races the uniqueness constraint.
    """

    moves: tuple[TransferMove, ...]
    drops: tuple[UUID, ...]
    displaced_edge_ids: tuple[UUID, ...] = ()


def plan_edge_transfer(
    *,
    edges: Sequence[EdgeRef],
    from_layer_id: UUID,
    to_layer_id: UUID,
    survivor_class: int | None,
    class_by_partner: dict[UUID, int | None],
    existing_ties: dict[tuple[UUID, str, UUID, str], ExistingTie],
) -> EdgeTransferPlan:
    """Decide the fate of every edge on a band about to be absorbed.

    Before 2026-08-07 the absorbed row's FK cascade silently deleted its
    accepted ties (the open question documented in ``merge_geotech_bands``).
    The owner's ruling closes it: accepted work is re-anchored onto the
    survivor and flagged for review, never silently destroyed.

    Pure — no session — the I/O wrapper applies the plan.

    Parameters
    ----------
    edges : Sequence[EdgeRef]
        Every edge with an endpoint on ``from_layer_id``.
    from_layer_id : UUID
        The band being absorbed.
    to_layer_id : UUID
        The surviving band.
    survivor_class : int | None
        The survivor's re-derived class (decides which flag a move carries).
    class_by_partner : dict[UUID, int | None]
        Current class of each partner layer.
    existing_ties : dict[tuple[UUID, str, UUID, str], ExistingTie]
        Ties the survivor already carries, keyed by :func:`tie_key` — a
        transfer landing on one collides. An ACCEPTED occupant makes the
        incoming tie a true duplicate (dropped); a PENDING occupant is
        displaced instead, because accepted work outranks a proposal.

    Returns
    -------
    EdgeTransferPlan
        The moves, the drops, and the displaced pending occupants; the
        absorbed row's own pending edges are in none of them.
    """
    moves: list[TransferMove] = []
    drops: list[UUID] = []
    displaced: list[UUID] = []
    claimed: dict[tuple[UUID, str, UUID, str], ExistingTie] = dict(existing_ties)
    for edge in edges:
        if not edge.user_approved:
            continue  # the cascade's to take — a machine claim
        partner = edge.partner_of(from_layer_id)
        if partner == to_layer_id:
            drops.append(edge.edge_id)  # would become a self-loop
            continue
        # The tie keeps the surfaces it joined: the absorbed band's own side
        # travels onto the survivor, the partner's side never moves.
        moved_side = edge.side_of(from_layer_id)
        partner_side = edge.partner_side(from_layer_id)
        key = tie_key(to_layer_id, moved_side, partner, partner_side)
        occupant = claimed.get(key)
        if occupant is not None:
            if occupant.user_approved:
                drops.append(edge.edge_id)  # the survivor already carries this tie
                continue
            # A pending proposal holds the slot: withdraw it, the accepted tie
            # takes the place (flag-not-drop, applied to the collision itself).
            displaced.append(occupant.edge_id)
        new_a, new_b = (to_layer_id, partner) if to_layer_id < partner else (partner, to_layer_id)
        claimed[key] = ExistingTie(edge.edge_id, True)
        partner_class = class_by_partner.get(partner)
        mismatched = (
            survivor_class is None or partner_class is None or survivor_class != partner_class
        )
        # The re-point changes which physical id sits in layer_a_id; the side
        # columns must travel with their ids exactly as canonical_contact_order
        # does. Sides swap when the absorbed endpoint's slot changes ends.
        was_a = edge.layer_a_id == from_layer_id
        now_a = new_a == to_layer_id
        moves.append(
            TransferMove(
                edge_id=edge.edge_id,
                new_layer_a_id=new_a,
                new_layer_b_id=new_b,
                swap_sides=was_a != now_a,
                review_reason=REVIEW_CLASS_CHANGED if mismatched else REVIEW_AMBIGUOUS_BAND,
            )
        )
    return EdgeTransferPlan(tuple(moves), tuple(drops), tuple(displaced))


async def load_geotech_column_context(
    session: AsyncSession,
    logger: GroundModelLogger,
    *,
    project_id: UUID,
    geotech_model_id: UUID,
    band_id: UUID,
) -> GeotechColumnContext:
    """Load the edited band's whole column — and nothing beyond it.

    Parameters
    ----------
    session : AsyncSession
        Active session.
    logger : GroundModelLogger
        The caller's logger, so the load is attributed to the use case.
    project_id : UUID
        Owning project (scope guard for the view-state read).
    geotech_model_id : UUID
        The geotechnical model that must own the band.
    band_id : UUID
        The band being edited.

    Returns
    -------
    GeotechColumnContext
        The column's bands + the qc series + the parent walls.

    Raises
    ------
    GeotechBandEditError
        When the band does not exist, belongs to another model, or has no
        anchor.
    """
    target = await session.get(LithoLayerOrm, band_id)
    if target is None or target.model_id != geotech_model_id:
        raise GeotechBandEditError(
            f"Packing band {band_id} was not found in geotech model {geotech_model_id}."
        )
    anchor_is_cpt = target.cpt_id is not None
    investigation_id = target.cpt_id if anchor_is_cpt else target.borehole_id
    if investigation_id is None:
        raise GeotechBandEditError(f"Packing band {band_id} has no investigation anchor.")

    # ONLY this anchor's rows — ruling 4 ("recalculation is local") enforced at
    # the query, not by convention downstream.
    repo = LithoLayerRepository(session)
    rows = await repo.list_layers(
        geotech_model_id,
        borehole_id=None if anchor_is_cpt else investigation_id,
        cpt_id=investigation_id if anchor_is_cpt else None,
        status="accepted",
    )

    formation_by_id: dict[UUID, GeologicalFormationOrm | None] = {}
    for row in rows:
        if row.formation_id not in formation_by_id:
            formation_by_id[row.formation_id] = await session.get(
                GeologicalFormationOrm, row.formation_id
            )

    bands: list[GeotechBand] = []
    band_rows: dict[str, LithoLayerOrm] = {}
    for row in rows:
        formation = formation_by_id.get(row.formation_id)
        if formation is None:
            # A band whose formation vanished cannot be parented, so it cannot
            # act as a wall either; skipping it is safer than guessing a parent.
            logger.warning(f"Packing band {row.id} has no formation row — skipped")
            continue
        bands.append(
            GeotechBand(
                band_id=str(row.id),
                depth_top_m=row.depth_top_m,
                depth_base_m=row.depth_base_m,
                nad_class=formation.nad_class,
                source_litho_formation_id=str(formation.source_litho_formation_id),
                source_geo_formation_id=(
                    None
                    if formation.source_geo_formation_id is None
                    else str(formation.source_geo_formation_id)
                ),
            )
        )
        band_rows[str(row.id)] = row

    target_formation = formation_by_id.get(target.formation_id)
    if target_formation is None or target_formation.source_litho_formation_id is None:
        raise GeotechBandEditError(
            f"Packing band {band_id} has no lithostratigraphic parent, so its hard "
            "bounds cannot be established."
        )
    # The geotech formation already carries the soil code + admixtures copied
    # from its litho source at materialisation time, so the parent litho row does
    # not need a second round-trip here.
    soil_code = target_formation.litho_main_soil_code
    # ``litho_main_soil_code`` is a free-form column; narrow it to the closed
    # BaseLithology set here so an unrecognised token becomes "cannot answer"
    # downstream rather than reaching ``classify_nad`` and raising.
    soil: BaseLithology | None = (
        cast(BaseLithology, soil_code) if soil_code in BASE_LITHOLOGIES else None
    )
    admixtures = _parse_admixtures(target_formation)

    depth_m: list[float] = []
    qc_mpa: list[float | None] = []
    if anchor_is_cpt:
        from groundmodel.infrastructure.db.models.cpt_series_orm import CptSeriesOrm

        series = await session.get(CptSeriesOrm, investigation_id)
        if series is not None:
            depth_m = list(series.depths_m)
            qc_mpa = list(series.qc_mpa)

    view_state = await load_project_view_state(session, project_id)
    min_thickness_m = read_view_state_float(
        view_state,
        "geotech_subdivision",
        "minimum_layer_thickness_m",
        _DEFAULT_MIN_THICKNESS_M,
    )

    # The model's representative-qc statistic (ruling 7). Identity-map hit in
    # the common case — the router just loaded the model for its kind guard.
    model = await session.get(GeologicalModelOrm, geotech_model_id)
    statistic = model.representative_statistic if model is not None else DEFAULT_STATISTIC

    logger.debug(
        f"load_geotech_column_context: band={band_id} "
        f"investigation={investigation_id} bands={len(bands)} "
        f"qc_samples={len(depth_m)} soil={soil!r} min_thickness_m={min_thickness_m} "
        f"statistic={statistic}"
    )
    return GeotechColumnContext(
        project_id=project_id,
        geotech_model_id=geotech_model_id,
        investigation_id=investigation_id,
        anchor_is_cpt=anchor_is_cpt,
        bands=tuple(bands),
        band_rows=band_rows,
        soil=soil,
        admixtures=admixtures,
        depth_m=depth_m,
        qc_mpa=qc_mpa,
        min_thickness_m=min_thickness_m,
        statistic=statistic,
        source_litho_formation_id=target_formation.source_litho_formation_id,
        source_geo_formation_id=target_formation.source_geo_formation_id,
    )


def _parse_admixtures(formation: GeologicalFormationOrm) -> tuple[Admixture, ...]:
    """Parse a formation's stored admixture JSON into domain value objects.

    Parameters
    ----------
    formation : GeologicalFormationOrm
        The geotech formation (it carries the admixtures copied from its litho
        source).

    Returns
    -------
    tuple[Admixture, ...]
        Domain admixtures; empty when none are stored.
    """
    if not formation.litho_admixtures:
        return ()
    return tuple(
        Admixture(
            soil_code=entry.get("soil_code", ""),
            amount=entry.get("amount", ""),
            locally=bool(entry.get("locally", False)),
        )
        for entry in formation.litho_admixtures
        if isinstance(entry, dict)
    )


async def load_edges_for_layers(
    session: AsyncSession,
    *,
    model_id: UUID,
    layer_ids: Sequence[UUID],
) -> list[EdgeRef]:
    """Load every correlation edge with an endpoint on one of ``layer_ids``.

    Parameters
    ----------
    session : AsyncSession
        Active session.
    model_id : UUID
        The geotechnical model to scope to.
    layer_ids : Sequence[UUID]
        Layers whose edges are wanted.

    Returns
    -------
    list[EdgeRef]
        The matching edges, reduced to id + endpoints.
    """
    if not layer_ids:
        return []
    ids = list(layer_ids)
    rows = (
        (
            await session.execute(
                select(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.model_id == model_id,
                    or_(
                        LithoContactCorrelationEdgeOrm.layer_a_id.in_(ids),
                        LithoContactCorrelationEdgeOrm.layer_b_id.in_(ids),
                    ),
                )
            )
        )
        .scalars()
        .all()
    )
    return [
        EdgeRef(
            edge_id=r.id,
            layer_a_id=r.layer_a_id,
            layer_b_id=r.layer_b_id,
            layer_a_side=r.layer_a_side,
            layer_b_side=r.layer_b_side,
            user_approved=r.user_approved,
            review_reason=r.review_reason,
        )
        for r in rows
    ]


async def load_nad_class_by_layer(
    session: AsyncSession,
    layer_ids: Sequence[UUID],
) -> dict[UUID, int | None]:
    """Current NAD class of each given layer, via its formation.

    Parameters
    ----------
    session : AsyncSession
        Active session.
    layer_ids : Sequence[UUID]
        Layers to look up.

    Returns
    -------
    dict[UUID, int | None]
        ``layer_id -> nad_class``; absent for ids that no longer exist.
    """
    if not layer_ids:
        return {}
    rows = (
        await session.execute(
            select(LithoLayerOrm.id, GeologicalFormationOrm.nad_class)
            .join(GeologicalFormationOrm, LithoLayerOrm.formation_id == GeologicalFormationOrm.id)
            .where(LithoLayerOrm.id.in_(list(layer_ids)))
        )
    ).all()
    return {row[0]: row[1] for row in rows}


async def flag_edges(session: AsyncSession, edge_ids: Sequence[UUID], reason: str) -> int:
    """Stamp ``review_reason`` on the given edges (empty-safe).

    Parameters
    ----------
    session : AsyncSession
        Active session (the caller commits).
    edge_ids : Sequence[UUID]
        Edges to flag.
    reason : str
        The review token to persist (``class_changed`` / ``ambiguous_band``).

    Returns
    -------
    int
        How many ids were requested (the caller logs it).
    """
    if not edge_ids:
        return 0
    await session.execute(
        update(LithoContactCorrelationEdgeOrm)
        .where(LithoContactCorrelationEdgeOrm.id.in_(list(edge_ids)))
        .values(review_reason=reason)
    )
    return len(edge_ids)


async def clear_edge_flags(session: AsyncSession, edge_ids: Sequence[UUID], reason: str) -> int:
    """NULL ``review_reason`` where it currently equals ``reason`` (empty-safe).

    The reason filter keeps the clear precise: a concurrent flag of a
    DIFFERENT kind (e.g. ``ambiguous_band``) is never wiped by a class-match
    self-heal.

    Parameters
    ----------
    session : AsyncSession
        Active session (the caller commits).
    edge_ids : Sequence[UUID]
        Edges whose flag should clear.
    reason : str
        The one token this clear is allowed to remove.

    Returns
    -------
    int
        How many ids were requested (the caller logs it).
    """
    if not edge_ids:
        return 0
    await session.execute(
        update(LithoContactCorrelationEdgeOrm)
        .where(
            LithoContactCorrelationEdgeOrm.id.in_(list(edge_ids)),
            LithoContactCorrelationEdgeOrm.review_reason == reason,
        )
        .values(review_reason=None)
    )
    return len(edge_ids)


@dataclass(frozen=True)
class EdgeRevalidation:
    """What one commit's edge revalidation actually did.

    Attributes
    ----------
    deleted_edge_ids : tuple[UUID, ...]
        Pending mismatches withdrawn.
    flagged_edge_ids : tuple[UUID, ...]
        Accepted mismatches flagged ``class_changed``.
    cleared_edge_ids : tuple[UUID, ...]
        Restored matches whose ``class_changed`` flag self-healed.
    """

    deleted_edge_ids: tuple[UUID, ...]
    flagged_edge_ids: tuple[UUID, ...]
    cleared_edge_ids: tuple[UUID, ...]


async def revalidate_layer_edges(
    session: AsyncSession,
    logger: GroundModelLogger,
    *,
    model_id: UUID,
    new_class_by_layer_id: dict[UUID, int | None],
) -> EdgeRevalidation:
    """The one revalidation driver every band-edit commit calls.

    Hoisted from the byte-identical ``_revalidate_edges`` copies that lived in
    the split and merge use cases (extract-on-second-copy — the move and the
    N-run merge are callers three and four), and switched from
    drop-on-mismatch to flag-not-drop (owner ruling 2026-08-07) on the way.

    Parameters
    ----------
    session : AsyncSession
        Active session (the caller commits).
    logger : GroundModelLogger
        The calling use case's logger.
    model_id : UUID
        The geotechnical model to scope the edge query to.
    new_class_by_layer_id : dict[UUID, int | None]
        The re-derived class of every row this commit wrote (a move writes
        two).

    Returns
    -------
    EdgeRevalidation
        What was deleted, flagged and cleared.
    """
    edited_ids = list(new_class_by_layer_id)
    edges = await load_edges_for_layers(session, model_id=model_id, layer_ids=edited_ids)
    if not edges:
        return EdgeRevalidation((), (), ())
    partner_ids = {
        endpoint
        for e in edges
        for endpoint in (e.layer_a_id, e.layer_b_id)
        if endpoint not in new_class_by_layer_id
    }
    class_by_layer = await load_nad_class_by_layer(session, list(partner_ids))
    actions = edge_review_actions(
        edges=edges,
        new_class_by_layer_id=new_class_by_layer_id,
        class_by_layer_id=class_by_layer,
    )
    await delete_edges(session, actions.to_delete)
    await flag_edges(session, actions.to_flag, REVIEW_CLASS_CHANGED)
    await clear_edge_flags(session, actions.to_clear, REVIEW_CLASS_CHANGED)
    logger.debug(
        f"revalidate_layer_edges: layers={len(edited_ids)} edges={len(edges)} "
        f"deleted={len(actions.to_delete)} flagged={len(actions.to_flag)} "
        f"cleared={len(actions.to_clear)}"
    )
    return EdgeRevalidation(actions.to_delete, actions.to_flag, actions.to_clear)


async def transfer_accepted_edges(
    session: AsyncSession,
    logger: GroundModelLogger,
    *,
    model_id: UUID,
    from_layer_id: UUID,
    to_layer_id: UUID,
    survivor_class: int | None,
) -> EdgeTransferPlan:
    """Re-anchor the absorbed band's ACCEPTED ties onto the survivor row.

    Runs BEFORE the absorbed row is deleted — the FK cascade would otherwise
    silently destroy accepted work, which is exactly what the owner's
    2026-08-07 ruling forbids. Pending edges are deliberately left for the
    cascade (a machine claim the machine may withdraw).

    Parameters
    ----------
    session : AsyncSession
        Active session (the caller commits).
    logger : GroundModelLogger
        The calling use case's logger.
    model_id : UUID
        The geotechnical model.
    from_layer_id : UUID
        The band about to be absorbed.
    to_layer_id : UUID
        The surviving band.
    survivor_class : int | None
        The survivor's re-derived class (decides which review flag a
        transferred tie carries).

    Returns
    -------
    EdgeTransferPlan
        The applied plan — ``moves`` were re-pointed + flagged, ``drops``
        were deleted (self-loops / duplicates, counted as removals).
    """
    rows = (
        (
            await session.execute(
                select(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.model_id == model_id,
                    or_(
                        LithoContactCorrelationEdgeOrm.layer_a_id == from_layer_id,
                        LithoContactCorrelationEdgeOrm.layer_b_id == from_layer_id,
                    ),
                )
            )
        )
        .scalars()
        .all()
    )
    if not rows:
        return EdgeTransferPlan((), ())
    edges = [
        EdgeRef(
            edge_id=r.id,
            layer_a_id=r.layer_a_id,
            layer_b_id=r.layer_b_id,
            layer_a_side=r.layer_a_side,
            layer_b_side=r.layer_b_side,
            user_approved=r.user_approved,
            review_reason=r.review_reason,
        )
        for r in rows
    ]
    partner_ids = [e.partner_of(from_layer_id) for e in edges if e.user_approved]
    class_by_partner = await load_nad_class_by_layer(session, partner_ids)
    # The survivor's existing pairs, PER SECTION: the uniqueness triple is
    # section-scoped, so the duplicate test must be too. Conservative shortcut:
    # treat any same-pair edge on the model as a duplicate — the transfer's
    # source and target rows live on the same column, and the same pair on
    # another section carries the same engineering meaning (a duplicate is the
    # same tie, not lost work).
    survivor_rows = (
        (
            await session.execute(
                select(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.model_id == model_id,
                    or_(
                        LithoContactCorrelationEdgeOrm.layer_a_id == to_layer_id,
                        LithoContactCorrelationEdgeOrm.layer_b_id == to_layer_id,
                    ),
                )
            )
        )
        .scalars()
        .all()
    )
    existing_ties = {
        tie_key(r.layer_a_id, r.layer_a_side, r.layer_b_id, r.layer_b_side): ExistingTie(
            r.id, r.user_approved
        )
        for r in survivor_rows
    }
    plan = plan_edge_transfer(
        edges=edges,
        from_layer_id=from_layer_id,
        to_layer_id=to_layer_id,
        survivor_class=survivor_class,
        class_by_partner=class_by_partner,
        existing_ties=existing_ties,
    )
    # Withdraw the displaced proposals FIRST: the re-points below take exactly
    # the slots those rows occupy, and flushing with both present would hit the
    # uniqueness constraint.
    if plan.displaced_edge_ids:
        await delete_edges(session, plan.displaced_edge_ids)
        await session.flush()
    row_by_id = {r.id: r for r in rows}
    for move in plan.moves:
        row = row_by_id[move.edge_id]
        if move.swap_sides:
            row.layer_a_side, row.layer_b_side = row.layer_b_side, row.layer_a_side
        row.layer_a_id = move.new_layer_a_id
        row.layer_b_id = move.new_layer_b_id
        row.review_reason = move.review_reason
    await delete_edges(session, plan.drops)
    await session.flush()
    logger.debug(
        f"transfer_accepted_edges: from={from_layer_id} to={to_layer_id} "
        f"moved={len(plan.moves)} dropped={len(plan.drops)} "
        f"displaced_pending={len(plan.displaced_edge_ids)}"
    )
    return plan


async def delete_edges(session: AsyncSession, edge_ids: Sequence[UUID]) -> int:
    """Delete correlation edges by id.

    Parameters
    ----------
    session : AsyncSession
        Active session (the caller commits).
    edge_ids : Sequence[UUID]
        Edges to drop.

    Returns
    -------
    int
        How many ids were requested (the caller logs it).
    """
    if not edge_ids:
        return 0
    await session.execute(
        delete(LithoContactCorrelationEdgeOrm).where(
            LithoContactCorrelationEdgeOrm.id.in_(list(edge_ids))
        )
    )
    return len(edge_ids)


async def formation_for_class(
    materialiser: GeotechBoreholeMaterialiser,
    *,
    project_id: UUID,
    nad_class: int | None,
    source_litho_formation_id: UUID,
    source_geo_formation_id: UUID | None,
) -> GeologicalFormationOrm:
    """Find-or-create the geotech formation that carries ``nad_class``.

    Reuses the build's find-or-create so a hand edit lands on the SAME formation
    row the build would have produced for that class + parentage — no parallel
    vocabulary of hand-made formations.

    Parameters
    ----------
    materialiser : GeotechBoreholeMaterialiser
        The calling use case (it owns the session + the find-or-create helpers).
    project_id : UUID
        Owning project.
    nad_class : int | None
        The re-derived class, or ``None`` for a "needs review" band.
    source_litho_formation_id : UUID
        Litho parent of the band.
    source_geo_formation_id : UUID | None
        Geological parent of the band.

    Returns
    -------
    GeologicalFormationOrm
        The found-or-created formation row.
    """
    return await materialiser._find_or_create_formation(
        project_id=project_id,
        classified_by_key={},
        skeleton_by_key={},
        created_formation_ids=[],
        nad_class=nad_class,
        source_litho_formation_id=source_litho_formation_id,
        source_geo_formation_id=source_geo_formation_id,
    )
