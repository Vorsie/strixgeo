"""Batch-update use case for formation contacts.

The section editor's multi-drag flow can move N contacts at once.
Doing that as N independent ``PATCH`` calls is racy (partial
failure mid-batch leaves the model in an inconsistent state) and
slow (N HTTP round trips). This use case takes a single list of
patches, validates every target's scope first, then applies them
in one transaction.

All-or-nothing semantics:

* Every entry's contact MUST already exist AND belong to the
  caller-supplied ``model_id``. Any miss aborts before mutation.
* The session's auto-rollback on exception covers schema failures
  mid-loop. A successful return means every row reached the DB.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.domain.value_objects.formation_contact_result import (
    FormationContactResult,
)
from groundmodel.infrastructure.db.repositories.geology_repository import (
    GeologyRepository,
)
from groundmodel.infrastructure.db.repositories.litho_layer_repository import (
    LithoLayerRepository,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class UpdateFormationContactsBatch(GroundModelLogger):
    """Apply N partial updates to formation contacts and commit once."""

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session
        self._repo = GeologyRepository(session)

    async def execute(
        self,
        model_id: UUID,
        entries: list[tuple[UUID, dict[str, Any]]],
    ) -> list[FormationContactResult] | None:
        """Apply every ``(contact_id, patch)`` tuple under one transaction.

        Parameters
        ----------
        model_id : UUID
            Every contact in ``entries`` must already belong to this
            model. Any mismatch returns ``None`` (the router maps that
            to a 404) before any mutation runs.
        entries : list[tuple[UUID, dict[str, Any]]]
            ``(contact_id, exclude_unset patch dict)`` pairs. The patch
            dicts come straight from the Pydantic request entries minus
            the ``contact_id`` field.

        Returns
        -------
        list[FormationContactResult] | None
            Immutable snapshots of the updated rows in the SAME order as
            ``entries`` so the client can patch its local state by index.
            ``None`` when any entry's contact is missing or out of scope
            — no rows mutated in that case.
        """
        if not entries:
            self.warning("Batch update called with empty entries — no-op")
            return []

        contact_ids = [cid for cid, _ in entries]
        self.info(f"Batch contact update entry: model={model_id} count={len(entries)}")

        # Single IN-query loads every target. Map by id for the scope
        # check + the post-update return-in-order step.
        loaded = await self._repo.list_contacts_by_ids(contact_ids)
        by_id = {c.id: c for c in loaded}

        for cid in contact_ids:
            contact = by_id.get(cid)
            if contact is None:
                self.warning(f"Batch scope check failed — contact {cid} not found")
                return None
            if contact.model_id != model_id:
                self.warning(
                    f"Batch scope check failed — contact {cid} belongs to "
                    f"model {contact.model_id}, not {model_id}"
                )
                return None

        # Capture pre-update (formation_id) per contact so the
        # post-batch recompute can target the OLD formation when the
        # batch flipped formation_id on a row (rare today; the
        # frontend's batch path doesn't change formation, but
        # defensive against future callers).
        affected: set[tuple[UUID, UUID]] = set()  # (model_id, formation_id) tuples
        for cid in contact_ids:
            contact = by_id[cid]
            affected.add((contact.model_id, contact.formation_id))

        # Scope clean — apply every patch via setattr. The session
        # carries the loaded rows already so no per-entry round trip.
        for cid, patch in entries:
            contact = by_id[cid]
            for key, value in patch.items():
                setattr(contact, key, value)

        await self._session.flush()

        # Add the post-update (model, formation) pairs to the
        # affected set so a formation_id flip recomputes BOTH old +
        # new surfaces.
        for contact in by_id.values():
            affected.add((contact.model_id, contact.formation_id))

        # On-click build pivot: mark each affected (model, formation)
        # surface stale rather than recompute. Single bulk UPDATE
        # regardless of N contacts touched — cheap.
        await self._repo.mark_surfaces_stale(affected)
        # Mirror to the 3D solid cache — geological model ids never match
        # litho_body_solid.model_id rows, so this is a safe unconditional call.
        await LithoLayerRepository(self._session).mark_litho_solids_stale(model_id)

        await self._session.commit()
        for contact in by_id.values():
            await self._session.refresh(contact)

        self.success(
            f"Batch contact update committed: model={model_id} "
            f"count={len(entries)} surfaces_marked_stale={len(affected)}"
        )
        return [FormationContactResult.from_orm(by_id[cid]) for cid in contact_ids]
