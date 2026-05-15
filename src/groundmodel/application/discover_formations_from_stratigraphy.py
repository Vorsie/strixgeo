"""Discover candidate formation names from borehole stratigraphy — read-only.

This use case backs the ``POST .../contacts/discover-from-stratigraphy``
endpoint.  It scans the same FORMAL_STRATIGRAPHY-preferred /
INFORMAL_STRATIGRAPHY-fallback / surface-layers-skipped logic as
``AutoPopulateContactsFromStratigraphy`` but writes nothing to the database.
The result feeds the ``FormationSelectionDialog`` so the user can curate
which formations to keep before any mutation fires.
"""

from __future__ import annotations

from collections.abc import Iterable
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
    StratigraphyCandidate,
    scan_stratigraphy_candidates,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class DiscoverFormationsFromStratigraphy(GroundModelLogger):
    """Read-only use case: scan boreholes and return candidate formation names.

    No transaction, no flush, no commit — purely a read path. Callers do not
    need to commit a session after calling ``execute``.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``.

        Parameters
        ----------
        session : AsyncSession
            Live session; used only for SELECT queries.
        """
        super().__init__(__name__)
        self._session = session

    async def execute(
        self,
        *,
        project_id: UUID,
        borehole_ids: Iterable[UUID],
    ) -> list[StratigraphyCandidate]:
        """Scan borehole stratigraphy and return unique candidate names.

        Delegates the full scan to ``scan_stratigraphy_candidates`` —
        the shared helper that mirrors ``AutoPopulateContactsFromStratigraphy``
        but without the contact-creation side effects.

        Parameters
        ----------
        project_id : UUID
            Project scope guard — borehole ids outside this project are
            silently filtered.
        borehole_ids : Iterable[UUID]
            The boreholes to scan (typically all boreholes visible in the
            project).

        Returns
        -------
        list[StratigraphyCandidate]
            Unique candidates sorted by ``borehole_count`` descending then
            ``name`` ascending.  Empty list when no borehole carries
            stratigraphy data.
        """
        borehole_id_list = list(borehole_ids)
        self.info(
            f"DiscoverFormationsFromStratigraphy: project={project_id} "
            f"boreholes={len(borehole_id_list)}"
        )
        candidates = await scan_stratigraphy_candidates(
            self._session,
            project_id=project_id,
            borehole_ids=borehole_id_list,
        )
        self.success(
            f"DiscoverFormationsFromStratigraphy done: "
            f"{len(candidates)} candidate(s) from {len(borehole_id_list)} borehole(s)"
        )
        return candidates
