"""Check-contact-consistency use case: the always-on pick check of a geological model.

Read-only. Loads the picks the surfaces use, asks the cache per formation and
returns what is ready; changed formations compute in the background.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.contact_consistency_cache import ContactConsistencyCache
from groundmodel.application.formation_consistency_entry import FormationConsistencyEntry
from groundmodel.application.load_formation_picks import load_formation_picks
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.shared.constants.model_kind import NON_STRATIGRAPHIC_KINDS
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class CheckContactConsistency(GroundModelLogger):
    """Run the pick consistency check for one geological model."""

    def __init__(self, session: AsyncSession, cache: ContactConsistencyCache) -> None:
        """Initialise with a session and the process-wide cache.

        Parameters
        ----------
        session : AsyncSession
            Open database session.
        cache : ContactConsistencyCache
            Process-wide result cache.
        """
        super().__init__(__name__)
        self._session = session
        self._cache = cache

    async def execute(self, model_id: UUID) -> list[FormationConsistencyEntry]:
        """Return one entry per formation; ``check is None`` means still computing.

        Parameters
        ----------
        model_id : UUID
            Geological model.

        Returns
        -------
        list[FormationConsistencyEntry]
            Empty for a missing model and for litho and geotech models (not
            checked in this slice: interfingering units are real geology).
        """
        self.info(f"check_contact_consistency: model={model_id}")
        model = await self._session.get(GeologicalModelOrm, model_id)
        if model is None or model.kind in NON_STRATIGRAPHIC_KINDS:
            self.debug(
                f"check_contact_consistency: model={model_id} skipped "
                f"(kind={None if model is None else model.kind})"
            )
            return []
        groups = await load_formation_picks(self._session, model_id, self)
        entries = [
            FormationConsistencyEntry(
                formation_id=g.formation_id,
                formation_name=g.formation_name,
                n_picks=len(g.picks),
                skipped_no_location=g.skipped_no_location,
                check=self._cache.lookup_or_schedule((model_id, g.formation_id), g.picks),
            )
            for g in groups
        ]
        fallbacks = 0
        for e in entries:
            if e.check is None:
                continue
            n_fallback = e.check.refit_fallbacks
            fallbacks += n_fallback
            if n_fallback > 0:
                self.warning(
                    f"check_contact_consistency: model={model_id} formation={e.formation_name} "
                    f"refit_fallbacks={n_fallback} of {e.n_picks} picks judged by the full model"
                )
        computing = sum(1 for e in entries if e.check is None)
        flags = sum(len(e.check.flags) for e in entries if e.check is not None)
        self.success(
            f"check_contact_consistency: model={model_id} formations={len(entries)} "
            f"computing={computing} flags={flags} refit_fallbacks={fallbacks}"
        )
        return entries
