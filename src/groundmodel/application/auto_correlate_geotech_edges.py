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
is skipped and counted.  Nothing is deleted, updated, or re-approved — the use
case issues SELECTs and INSERTs only.  Endpoints are canonicalised to
``(min, max)`` on both the read and the write side, so a tie persisted the other
way round is recognised as the same tie.

The dedup key is the layer PAIR, not the ``(pair, sides)`` triple the DB unique
constraint uses.  Two bands already joined by a base↔base bottom-tie therefore
suppress the top↔top proposal rather than gaining a second edge beside it — the
conservative direction, and the same key the two build passes already dedup on.

The rule
--------
Unchanged and reused verbatim: for each approved litho edge, the geotech
sub-band stacks inside that litho unit on both columns are aligned by the
longest common subsequence of their NAD packing classes
(``groundmodel.domain.services.geotech_packing_edges.aligned_same_class_pairs``),
via the shared ``geotech_edge_derivation`` helper that the two build passes
already call.  Bands with no NAD class (skeleton, no qc) never auto-tie.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.geotech_edge_derivation import (
    EdgeDerivationCounts,
    derive_geotech_edges_from_litho,
    load_approved_litho_edges,
    load_existing_geotech_edge_pairs_by_section,
    load_litho_layer_depths,
    load_project_sections,
)
from groundmodel.application.scope_guard import load_scoped_or_raise
from groundmodel.domain.services.auto_correlate_contact_edges_constants import AUTO_SOURCE
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


@dataclass(frozen=True)
class AutoCorrelateGeotechResult:
    """Outcome counts for one run of the geotech auto-correlate verb.

    Attributes
    ----------
    edges_proposed : int
        Net-new UNAPPROVED edges inserted.  These are suggestions; the accept
        verb promotes them.
    edges_skipped_existing : int
        Candidate pairs left alone because an edge already joined those two
        bands on that section — whether the engineer drew it by hand, accepted
        it earlier, or a build pass wrote it.
    sections_processed : int
        Sections that carried at least one approved litho edge and were
        therefore examined.
    skipped_no_lcs : int
        Correlated litho units whose two packing stacks share no NAD class, so
        nothing could be tied automatically (the engineer connects those).
    skipped_empty_stack : int
        Correlated litho units where one column carries no geotech bands at all
        (e.g. a column the build has not subdivided yet).
    """

    edges_proposed: int
    edges_skipped_existing: int
    sections_processed: int
    skipped_no_lcs: int = 0
    skipped_empty_stack: int = 0


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

        Returns
        -------
        AutoCorrelateGeotechResult
            Proposed / skipped-existing counts plus the two diagnostic skip
            reasons.

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
                    edges_proposed=0, edges_skipped_existing=0, sections_processed=0
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
        self.debug(
            f"AutoCorrelateGeotechEdges: preloaded existing edges on "
            f"{len(seen_pairs_by_section)} section(s) — these are left untouched"
        )

        totals = EdgeDerivationCounts()
        sections_processed = 0
        for index, section in enumerate(sections):
            approved = await load_approved_litho_edges(self._session, litho_model_id, section.id)
            if not approved:
                self.debug(
                    f"[{index + 1}/{len(sections)}] AutoCorrelateGeotechEdges: "
                    f"section={section.id} ({section.name!r}) has no approved litho edge — skipped"
                )
                continue
            sections_processed += 1
            self.debug(
                f"[{index + 1}/{len(sections)}] AutoCorrelateGeotechEdges: "
                f"section={section.id} ({section.name!r}) "
                f"{len(approved)} approved litho edge(s)"
            )
            totals.add(
                await derive_geotech_edges_from_litho(
                    self._session,
                    self,
                    geotech_model_id=model_id,
                    section_id=section.id,
                    litho_approved_edges=approved,
                    litho_layer_depths=litho_layer_depths,
                    geotech_layer_by_inv_depth=geotech_bands,
                    seen_layer_pairs=seen_pairs_by_section.setdefault(section.id, set()),
                    # Suggestions, not commitments — the accept verb promotes them.
                    user_approved=False,
                    source=AUTO_SOURCE,
                )
            )

        await self._session.commit()
        self.success(
            f"AutoCorrelateGeotechEdges: proposed={totals.edges_emitted} "
            f"skipped_existing={totals.skipped_existing_pair} "
            f"sections={sections_processed}/{len(sections)} "
            f"skipped_no_lcs={totals.skipped_no_lcs} "
            f"skipped_empty_stack={totals.skipped_empty_stack}"
        )
        return AutoCorrelateGeotechResult(
            edges_proposed=totals.edges_emitted,
            edges_skipped_existing=totals.skipped_existing_pair,
            sections_processed=sections_processed,
            skipped_no_lcs=totals.skipped_no_lcs,
            skipped_empty_stack=totals.skipped_empty_stack,
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
