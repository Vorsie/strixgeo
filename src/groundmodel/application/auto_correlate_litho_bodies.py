"""Auto-correlate litho bodies use case — #127.

Loads all formation contacts + investigation locations for a
lithostratigraphic model, runs the pure domain algorithm
``auto_correlate_litho_bodies``, persists the net-new edges in one
batch, re-runs the ordinal resolver once, and triggers the inference
engine for each uniquely-touched formation.

The entire mutation (edges + resolver ordinals + absence deltas + wedge
tips) is committed in one transaction so the DB remains consistent even
if the caller process dies mid-flight.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.correlate_litho_units import CorrelateLithoUnits
from groundmodel.application.materialize_wedge_tips_for_formation import (
    MaterializeWedgeTipsForFormation,
)
from groundmodel.application.recompute_formation_absences_for_formation import (
    RecomputeFormationAbsencesForFormation,
)
from groundmodel.domain.services.auto_correlate import (
    AutoCorrelateParams,
    FormationContactRecord,
    InvestigationLocation,
    auto_correlate_litho_bodies,
)
from groundmodel.domain.services.auto_correlate_constants import AUTO_SOURCE
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_correlation_edge_orm import (
    LithoCorrelationEdgeOrm,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


@dataclass
class AutoCorrelateResult:
    """Output of :meth:`AutoCorrelateLithoBodies.execute`.

    Attributes
    ----------
    edges_created : int
        Number of net-new ``litho_correlation_edge`` rows inserted with
        ``source='auto'``.
    edges_skipped_existing : int
        Candidates already present as edges (any source) — not re-inserted.
    formations_recomputed : int
        Unique formation ids for which absence inference was triggered.
    wedge_tips_materialised : int
        Unique formation ids for which wedge-tip materialisation was triggered.
    """

    edges_created: int
    edges_skipped_existing: int
    formations_recomputed: int
    wedge_tips_materialised: int


class AutoCorrelateLithoBodies(GroundModelLogger):
    """Orchestrate the auto-correlate domain algorithm and persist results.

    Intended as a one-shot bulk operation triggered by the "Auto-correlate"
    toolbar button or the on-accept hook.  It is safe to call multiple times:
    existing edges are skipped, and re-running the resolver/inference is
    idempotent.
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
        params: AutoCorrelateParams | None = None,
    ) -> AutoCorrelateResult:
        """Run auto-correlate for a lithostratigraphic model.

        Parameters
        ----------
        project_id : UUID
            Owning project — used for scope-guarding and inference calls.
        model_id : UUID
            The lithostratigraphic model to process.
        params : AutoCorrelateParams | None
            Algorithm tuning parameters.  ``None`` uses the owner-locked
            defaults from ``auto_correlate_constants.py``.

        Returns
        -------
        AutoCorrelateResult
            Counts of edges created, skipped, and formations recomputed.

        Raises
        ------
        ValueError
            When the model does not exist or does not belong to
            ``project_id``, or when the model is not of kind
            ``'lithostratigraphic'``.
        """
        self.info(f"AutoCorrelateLithoBodies: start project={project_id} model={model_id}")

        # ------------------------------------------------------------------ #
        # 1. Validate model ownership and kind.                                #
        # ------------------------------------------------------------------ #
        model = await self._session.get(GeologicalModelOrm, model_id)
        if model is None or model.app_project_id != project_id:
            raise ValueError(f"Model {model_id} not found in project {project_id}")
        if model.kind != "lithostratigraphic":
            raise ValueError(
                f"Auto-correlate requires a lithostratigraphic model; "
                f"model {model_id} is '{model.kind}'"
            )

        # ------------------------------------------------------------------ #
        # 2. Load all contacts for this model with their parent formation      #
        #    metadata (parent_formation_id + litho_main_soil_code).            #
        # ------------------------------------------------------------------ #
        # Join formation to get the group-key columns — two columns only.
        contacts_stmt = (
            select(
                FormationContactOrm.id,
                FormationContactOrm.formation_id,
                FormationContactOrm.depth_top_m,
                FormationContactOrm.borehole_id,
                FormationContactOrm.cpt_id,
                GeologicalFormationOrm.parent_formation_id,
                GeologicalFormationOrm.litho_main_soil_code,
            )
            .join(
                GeologicalFormationOrm,
                FormationContactOrm.formation_id == GeologicalFormationOrm.id,
            )
            .where(
                FormationContactOrm.model_id == model_id,
                # Synthetic contacts have no physical investigation anchor;
                # they cannot supply an InvestigationLocation and are
                # excluded from auto-correlation.
                FormationContactOrm.borehole_id.is_not(None)
                | FormationContactOrm.cpt_id.is_not(None),
                # Only litho child formations participate (parent is not None).
                GeologicalFormationOrm.parent_formation_id.is_not(None),
                # Skip contacts whose formation has no litho code — orphans
                # from a partially-committed accept or a manual geological unit.
                GeologicalFormationOrm.litho_main_soil_code.is_not(None),
            )
        )
        contact_rows = list((await self._session.execute(contacts_stmt)).all())
        self.info(
            f"AutoCorrelateLithoBodies: loaded {len(contact_rows)} contact(s) for model {model_id}"
        )

        if not contact_rows:
            self.info("AutoCorrelateLithoBodies: no contacts — nothing to correlate")
            return AutoCorrelateResult(
                edges_created=0,
                edges_skipped_existing=0,
                formations_recomputed=0,
                wedge_tips_materialised=0,
            )

        # ------------------------------------------------------------------ #
        # 3. Collect unique investigation ids, split by type.                  #
        # ------------------------------------------------------------------ #
        borehole_ids: set[UUID] = set()
        cpt_ids: set[UUID] = set()
        for row in contact_rows:
            if row.borehole_id is not None:
                borehole_ids.add(row.borehole_id)
            elif row.cpt_id is not None:
                cpt_ids.add(row.cpt_id)

        self.debug(
            f"AutoCorrelateLithoBodies: {len(borehole_ids)} borehole(s), "
            f"{len(cpt_ids)} CPT(s) with contacts in model"
        )

        # ------------------------------------------------------------------ #
        # 4. Load investigation locations.                                     #
        # location_x / location_y are in the native source CRS — the domain   #
        # algorithm only needs relative distances, not absolute coordinates,   #
        # so the CRS mismatch is tolerable as long as all investigations in a  #
        # project share the same CRS (true for all DOV imports; mixed-CRS     #
        # projects are flagged as out of scope for v1.0).                      #
        # ------------------------------------------------------------------ #
        inv_locations: dict[UUID, InvestigationLocation] = {}

        if borehole_ids:
            bh_rows = list(
                (
                    await self._session.execute(
                        select(
                            BoreholeOrm.id, BoreholeOrm.location_x, BoreholeOrm.location_y
                        ).where(BoreholeOrm.id.in_(borehole_ids))
                    )
                ).all()
            )
            for r in bh_rows:
                inv_locations[r.id] = InvestigationLocation(
                    investigation_id=r.id,
                    x=r.location_x,
                    y=r.location_y,
                )

        if cpt_ids:
            cpt_rows = list(
                (
                    await self._session.execute(
                        select(CptOrm.id, CptOrm.location_x, CptOrm.location_y).where(
                            CptOrm.id.in_(cpt_ids)
                        )
                    )
                ).all()
            )
            for r in cpt_rows:
                inv_locations[r.id] = InvestigationLocation(
                    investigation_id=r.id,
                    x=r.location_x,
                    y=r.location_y,
                )

        self.debug(
            f"AutoCorrelateLithoBodies: {len(inv_locations)} investigation location(s) resolved"
        )

        # ------------------------------------------------------------------ #
        # 5. Build FormationContactRecord list for the domain algorithm.       #
        # ------------------------------------------------------------------ #
        # Derive the investigation_id for each contact from its anchor type.
        domain_contacts: list[FormationContactRecord] = []
        skipped_no_location = 0
        for row in contact_rows:
            inv_id = row.borehole_id if row.borehole_id is not None else row.cpt_id
            if inv_id not in inv_locations:
                # Investigation missing from location table — silently skip.
                skipped_no_location += 1
                continue
            domain_contacts.append(
                FormationContactRecord(
                    contact_id=row.id,
                    formation_id=row.formation_id,
                    investigation_id=inv_id,
                    depth_top_m=row.depth_top_m,
                    parent_formation_id=row.parent_formation_id,
                    litho_main_soil_code=row.litho_main_soil_code,
                )
            )

        if skipped_no_location > 0:
            self.warning(
                f"AutoCorrelateLithoBodies: skipped {skipped_no_location} contact(s) "
                f"whose investigation id was not resolved to a location"
            )

        # ------------------------------------------------------------------ #
        # 6. Load existing edges for deduplication.                            #
        # ------------------------------------------------------------------ #
        existing_stmt = select(
            LithoCorrelationEdgeOrm.formation_a_id,
            LithoCorrelationEdgeOrm.formation_b_id,
        ).where(LithoCorrelationEdgeOrm.model_id == model_id)
        existing_rows = list((await self._session.execute(existing_stmt)).all())
        existing_edges: set[tuple[UUID, UUID]] = {
            (r.formation_a_id, r.formation_b_id) for r in existing_rows
        }
        self.debug(
            f"AutoCorrelateLithoBodies: {len(existing_edges)} existing edge(s) "
            f"(any source) loaded for dedup"
        )

        # ------------------------------------------------------------------ #
        # 7. Run the pure domain algorithm.                                    #
        # ------------------------------------------------------------------ #
        candidates = auto_correlate_litho_bodies(
            contacts=domain_contacts,
            investigations=list(inv_locations.values()),
            existing_edges=existing_edges,
            params=params,
        )
        self.info(
            f"AutoCorrelateLithoBodies: domain algorithm produced "
            f"{len(candidates)} candidate(s) "
            f"(skipped {len(existing_edges)} existing)"
        )

        if not candidates:
            return AutoCorrelateResult(
                edges_created=0,
                edges_skipped_existing=len(existing_edges),
                formations_recomputed=0,
                wedge_tips_materialised=0,
            )

        # ------------------------------------------------------------------ #
        # 8. Insert new edges in batch.                                        #
        # ------------------------------------------------------------------ #
        touched_formation_ids: set[UUID] = set()
        for i, cand in enumerate(candidates, 1):
            self.debug(
                f"[{i}/{len(candidates)}] AutoCorrelateLithoBodies: "
                f"inserting edge {cand.formation_a_id} ↔ {cand.formation_b_id}"
            )
            edge = LithoCorrelationEdgeOrm(
                id=uuid7(),
                model_id=model_id,
                formation_a_id=cand.formation_a_id,
                formation_b_id=cand.formation_b_id,
                source=AUTO_SOURCE,
            )
            self._session.add(edge)
            touched_formation_ids.add(cand.formation_a_id)
            touched_formation_ids.add(cand.formation_b_id)

        await self._session.flush()
        self.info(
            f"AutoCorrelateLithoBodies: flushed {len(candidates)} edge(s); "
            f"{len(touched_formation_ids)} unique formation(s) touched"
        )

        # ------------------------------------------------------------------ #
        # 9. Re-run the ordinal resolver once (not per-edge).                  #
        # ------------------------------------------------------------------ #
        correlate_uc = CorrelateLithoUnits(self._session)
        await correlate_uc.run_resolver(model_id)

        # ------------------------------------------------------------------ #
        # 10. Trigger inference + wedge-tip materialisation per formation.      #
        # ------------------------------------------------------------------ #
        inference_uc = RecomputeFormationAbsencesForFormation(self._session)
        materialize_uc = MaterializeWedgeTipsForFormation(self._session)
        for i, fid in enumerate(touched_formation_ids, 1):
            self.debug(
                f"[{i}/{len(touched_formation_ids)}] AutoCorrelateLithoBodies: "
                f"absence inference for formation {fid}"
            )
            await inference_uc.execute(
                project_id=project_id,
                model_id=model_id,
                formation_id=fid,
                commit=False,
            )
            await materialize_uc.execute(
                project_id=project_id,
                model_id=model_id,
                formation_id=fid,
                commit=False,
            )

        # ------------------------------------------------------------------ #
        # 11. Single commit — edges + resolver ordinals + inference deltas.    #
        # ------------------------------------------------------------------ #
        await self._session.commit()
        self.success(
            f"AutoCorrelateLithoBodies: committed {len(candidates)} edge(s); "
            f"{len(touched_formation_ids)} formation(s) recomputed"
        )

        return AutoCorrelateResult(
            edges_created=len(candidates),
            edges_skipped_existing=len(existing_edges),
            formations_recomputed=len(touched_formation_ids),
            wedge_tips_materialised=len(touched_formation_ids),
        )
