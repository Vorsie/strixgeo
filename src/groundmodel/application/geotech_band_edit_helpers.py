"""Shared loading + edge bookkeeping for hand split/merge of packing bands.

The preview and both commit use cases read the SAME column state and apply the
SAME edge rule, so that state and that rule live here once rather than three
times.

Column scoping is the owner's ruling 4 ("recalculation is local") expressed in
code: :func:`load_geotech_column_context` filters every query by the edited
band's own anchor, so no other column can be read — and therefore none can be
re-derived — by a hand edit.

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

from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.geotech_borehole_materialiser import GeotechBoreholeMaterialiser
from groundmodel.application.view_state_helpers import (
    load_project_view_state,
    read_view_state_float,
)
from groundmodel.domain.services.geotech_band_reclassification import (
    BandEditPlan,
    GeotechBand,
    GeotechBandEditError,
)
from groundmodel.domain.value_objects.admixture import Admixture
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
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
        Correlation edges dropped because the re-derived class no longer matches
        their partner.
    """

    geotech_model_id: UUID
    investigation_id: UUID
    plan: BandEditPlan
    layer_ids: tuple[UUID, ...]
    created_layer_ids: tuple[UUID, ...]
    deleted_layer_ids: tuple[UUID, ...]
    deleted_edge_ids: tuple[UUID, ...]


@dataclass(frozen=True)
class EdgeRef:
    """A correlation edge reduced to what the class-match rule needs.

    Attributes
    ----------
    edge_id : UUID
        The ``litho_contact_correlation_edge`` row.
    layer_a_id, layer_b_id : UUID
        Its two endpoints (canonically ordered in the DB).
    """

    edge_id: UUID
    layer_a_id: UUID
    layer_b_id: UUID

    def partner_of(self, layer_id: UUID) -> UUID:
        """The endpoint that is not ``layer_id``."""
        return self.layer_b_id if self.layer_a_id == layer_id else self.layer_a_id


def invalidated_edge_ids(
    *,
    edges: Sequence[EdgeRef],
    edited_layer_id: UUID,
    new_nad_class: int | None,
    class_by_layer_id: dict[UUID, int | None],
) -> list[UUID]:
    """Which of ``edited_layer_id``'s correlations the re-derivation invalidates.

    Owner ruling 4: "a connection breaks if the new class no longer matches" —
    and, read the other way, a connection that STILL matches survives. A band
    with no class never matches, which is the rule already in force for skeleton
    bands ("null-class bands never match", ``subdivide_all_bodies`` §8).

    Pure — no session — so the rule is testable on its own.

    Parameters
    ----------
    edges : Sequence[EdgeRef]
        Every edge with an endpoint on the edited layer.
    edited_layer_id : UUID
        The layer whose class was just re-derived.
    new_nad_class : int | None
        Its new class, or ``None`` when the qc could not answer.
    class_by_layer_id : dict[UUID, int | None]
        Current NAD class of each partner layer.

    Returns
    -------
    list[UUID]
        Edge ids that no longer connect same-class bands, in input order.
    """
    dropped: list[UUID] = []
    for edge in edges:
        partner_class = class_by_layer_id.get(edge.partner_of(edited_layer_id))
        if new_nad_class is None or partner_class is None or partner_class != new_nad_class:
            dropped.append(edge.edge_id)
    return dropped


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

    logger.debug(
        f"load_geotech_column_context: band={band_id} "
        f"investigation={investigation_id} bands={len(bands)} "
        f"qc_samples={len(depth_m)} soil={soil!r} min_thickness_m={min_thickness_m}"
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
    return [EdgeRef(edge_id=r.id, layer_a_id=r.layer_a_id, layer_b_id=r.layer_b_id) for r in rows]


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
