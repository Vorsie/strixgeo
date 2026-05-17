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
    LumpingCollision,
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
        manual_map: dict[str, str] | None = None,
    ) -> tuple[list[StratigraphyCandidate], list[LumpingCollision]]:
        """Scan borehole stratigraphy and return unique candidate names.

        Delegates the full scan to ``scan_stratigraphy_candidates`` —
        the shared helper that mirrors ``AutoPopulateContactsFromStratigraphy``
        but without the contact-creation side effects.

        The ``discover≡apply`` invariant: passing the same ``manual_map``
        here and to ``AutoPopulateContactsFromStratigraphy.execute`` produces
        identical effective keys, formation names, and collision warnings.
        The dialog must send the same map it used for the preview when
        confirming the apply, to eliminate any race between preview and write.

        Parameters
        ----------
        project_id : UUID
            Project scope guard — borehole ids outside this project are
            silently filtered.
        borehole_ids : Iterable[UUID]
            The boreholes to scan (typically all boreholes visible in the
            project).
        manual_map : dict[str, str] or None, optional
            Optional ``{ normalize_formation_key(raw) -> target_formation_name }``
            mapping built by the user's lumping dialog.  When provided, raw
            names that appear in the map are merged under the target formation
            in the candidate list.  ``None`` (default) = no lumping.

        Returns
        -------
        tuple[list[StratigraphyCandidate], list[LumpingCollision]]
            Pair of (candidates, collisions).  Candidates are sorted by
            ``borehole_count`` descending then ``name`` ascending.  Collisions
            are empty when no ``manual_map`` is provided or when no two layers
            in any single borehole resolve to the same effective key.
        """
        borehole_id_list = list(borehole_ids)
        self.info(
            f"DiscoverFormationsFromStratigraphy: project={project_id} "
            f"boreholes={len(borehole_id_list)} "
            f"manual_map={len(manual_map) if manual_map else 0}"
        )
        candidates, collisions = await scan_stratigraphy_candidates(
            self._session,
            project_id=project_id,
            borehole_ids=borehole_id_list,
            manual_map=manual_map,
        )
        self.success(
            f"DiscoverFormationsFromStratigraphy done: "
            f"{len(candidates)} candidate(s) from {len(borehole_id_list)} borehole(s), "
            f"{len(collisions)} collision(s)"
        )
        return candidates, collisions
