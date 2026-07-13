"""Use case — derive each body's majority geological-formation label.

A2: the geological name on a body is DERIVED, not stored — the
geological formation owning the majority of the body's member-layer
thickness, recomputed fresh on every read so it stays correct as bodies
merge/split or the geological surfaces are edited.

Extracted from the bodies router (prior-audit ARCH-05 / BE-API-18): the
3-query join (litho members, geo contacts, formation names) plus the
``majority_geo_formation`` aggregation is application logic, not HTTP
plumbing, and needed to be unit-testable with a mocked session.
"""

from __future__ import annotations

from collections import defaultdict
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.domain.services.body_geo_label import majority_geo_formation
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class GetBodyGeoLabels(GroundModelLogger):
    """Resolve the derived geological label for a set of bodies.

    Parameters
    ----------
    session : AsyncSession
        Active database session.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    async def execute(
        self,
        *,
        litho_model_id: UUID,
        body_ids: list[UUID],
    ) -> dict[UUID, tuple[UUID | None, str | None]]:
        """Return each body's derived majority geological-formation label.

        Parameters
        ----------
        litho_model_id : UUID
            The lithostratigraphic model the bodies belong to; its
            parent geological model supplies the chrono contacts.
        body_ids : list[UUID]
            The bodies to label.

        Returns
        -------
        dict[UUID, tuple[UUID | None, str | None]]
            ``body_id -> (geo_formation_id, geo_formation_name)``. A
            body absent from the map (or mapped to ``(None, None)``)
            has no resolvable geological label — e.g. no geological
            model is defined at its investigations.
        """
        if not body_ids:
            self.debug(f"geo labels: model={litho_model_id} no bodies — empty map")
            return {}

        litho_model = await self._session.get(GeologicalModelOrm, litho_model_id)
        geo_model_id = litho_model.parent_geological_model_id if litho_model else None
        if geo_model_id is None:
            self.debug(
                f"geo labels: model={litho_model_id} has no parent geological model — empty map"
            )
            return {}

        # Members per body: (investigation_id, depth_top_m, depth_base_m).
        member_rows = (
            await self._session.execute(
                select(
                    LithoLayerOrm.body_id,
                    func.coalesce(LithoLayerOrm.borehole_id, LithoLayerOrm.cpt_id),
                    LithoLayerOrm.depth_top_m,
                    LithoLayerOrm.depth_base_m,
                ).where(
                    LithoLayerOrm.body_id.in_(body_ids),
                    LithoLayerOrm.status == "accepted",
                )
            )
        ).all()
        members_by_body: dict[UUID, list[tuple[UUID, float, float]]] = defaultdict(list)
        for body_id, inv_id, top, base in member_rows:
            if body_id is not None and inv_id is not None:
                members_by_body[body_id].append((inv_id, top, base))

        # Geological contacts grouped per investigation, ascending by depth.
        contact_rows = (
            await self._session.execute(
                select(
                    func.coalesce(FormationContactOrm.borehole_id, FormationContactOrm.cpt_id),
                    FormationContactOrm.depth_top_m,
                    FormationContactOrm.formation_id,
                ).where(FormationContactOrm.model_id == geo_model_id)
            )
        ).all()
        geo_contacts_by_inv: dict[UUID, list[tuple[float, UUID]]] = defaultdict(list)
        for inv_id, depth, fid in contact_rows:
            if inv_id is not None:
                geo_contacts_by_inv[inv_id].append((depth, fid))
        for entries in geo_contacts_by_inv.values():
            entries.sort(key=lambda t: t[0])

        # Names for whichever geological formations the majority can resolve to.
        geo_fids = {fid for entries in geo_contacts_by_inv.values() for _, fid in entries}
        names: dict[UUID, str] = {}
        if geo_fids:
            name_rows = (
                await self._session.execute(
                    select(GeologicalFormationOrm.id, GeologicalFormationOrm.name).where(
                        GeologicalFormationOrm.id.in_(geo_fids)
                    )
                )
            ).all()
            names = {fid: name for fid, name in name_rows}

        labels: dict[UUID, tuple[UUID | None, str | None]] = {}
        for body_id in body_ids:
            geo_fid = majority_geo_formation(members_by_body.get(body_id, []), geo_contacts_by_inv)
            labels[body_id] = (geo_fid, names.get(geo_fid) if geo_fid is not None else None)
        self.debug(
            f"geo labels: model={litho_model_id} labelled {len(labels)} body/bodies "
            f"({sum(1 for v in labels.values() if v[0] is not None)} resolved)"
        )
        return labels
