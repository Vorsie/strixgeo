"""One-shot cleanup for legacy duplicate formation contacts.

The per-(model, anchor, formation) uniqueness rule landed AFTER
some auto-populate runs had already created duplicates in the
DB (multiple "Boom Klei at depth 0" rows on the same borehole).
This use case walks every group with N>1 contacts, keeps the
single highest-priority survivor, and deletes the rest.

Survivor selection rule (priority order):

1. Manual picks (``source != 'borehole_observation'``) win — the
   engineer's deliberate edit beats any auto-derived row.
2. Then prefer rows with an ``observation_layer_id`` set — these
   carry clear provenance back to a DOV layer, so re-running
   auto-populate stays idempotent.
3. Then prefer the most recent ``created_at`` — likely what the
   user has been working with most recently.

The use case is idempotent — running it on a clean model is a
no-op (no groups have N>1).
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.recompute_formation_surface import (
    RecomputeFormationSurface,
)
from groundmodel.infrastructure.db.models.formation_contact_orm import (
    FormationContactOrm,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


@dataclass(frozen=True)
class DedupeOutcome:
    """Summary of one dedupe pass."""

    inspected_groups: int
    duplicates_removed: int
    removed_contact_ids: list[UUID]


class DeduplicateFormationContacts(GroundModelLogger):
    """Drop duplicate (model, anchor, formation) contacts."""

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    async def execute(self, model_id: UUID) -> DedupeOutcome:
        """Walk the model's contacts and prune duplicates.

        Parameters
        ----------
        model_id : UUID
            Model whose contacts to dedupe.

        Returns
        -------
        DedupeOutcome
            Inspected group count + removed-contact count + the ids
            of every removed row (so the API response can let the
            frontend toast the number meaningfully and a future
            undo command could re-create them).
        """
        self.info(f"Dedupe entry: model={model_id}")
        rows = list(
            (
                await self._session.execute(
                    select(FormationContactOrm).where(FormationContactOrm.model_id == model_id)
                )
            )
            .scalars()
            .all()
        )
        # Group by (anchor, formation) — anchor is borehole_id OR
        # cpt_id (XOR enforced at the DB layer). Use the populated
        # one as the group key.
        groups: dict[tuple[UUID, UUID], list[FormationContactOrm]] = defaultdict(list)
        for c in rows:
            anchor = c.borehole_id if c.borehole_id is not None else c.cpt_id
            if anchor is None:
                # Defensive — DB CHECK constraint should make this
                # unreachable, but if it ever does happen, skip.
                continue
            groups[(anchor, c.formation_id)].append(c)

        removed_ids: list[UUID] = []
        # (model_id, formation_id) pairs that lost ≥1 contact in this
        # dedupe pass — their TIN cache needs a refresh post-commit
        # so the section view's slice query lands on current geometry.
        touched_pairs: set[tuple[UUID, UUID]] = set()
        for key, members in groups.items():
            if len(members) <= 1:
                continue
            # Sort by survivor priority — first item wins, the rest
            # get dropped.
            members.sort(key=_survivor_priority)
            survivor = members[0]
            losers = members[1:]
            self.debug(f"Group {key}: kept {survivor.id}, dropping {[str(c.id) for c in losers]}")
            for loser in losers:
                removed_ids.append(loser.id)
            touched_pairs.add((model_id, key[1]))

        if removed_ids:
            await self._session.execute(
                delete(FormationContactOrm).where(FormationContactOrm.id.in_(removed_ids))
            )
            await self._session.flush()
            await RecomputeFormationSurface(self._session).execute_many(touched_pairs)
            await self._session.commit()
        else:
            # Nothing to do — no commit needed (no mutations).
            self.debug("Dedupe: no duplicates found")

        outcome = DedupeOutcome(
            inspected_groups=len(groups),
            duplicates_removed=len(removed_ids),
            removed_contact_ids=removed_ids,
        )
        self.success(
            f"Dedupe done: model={model_id} "
            f"inspected={outcome.inspected_groups} "
            f"removed={outcome.duplicates_removed}"
        )
        return outcome


def _survivor_priority(c: FormationContactOrm) -> tuple[int, int, float]:
    """Sort key for picking the survivor in a duplicate group.

    Returns a tuple where LOWER values win (asc sort, first item
    survives). Three layers:

    1. ``source`` rank: manual_pick > interpolated > borehole_observation.
       Manual edits beat any auto-derived row.
    2. ``has_observation_layer_id``: rows with provenance beat
       rows without (helps idempotency on re-running auto-populate).
    3. Negative ``created_at`` as a unix timestamp — most recent wins
       inside a tied priority group.
    """
    source_rank = {
        "manual_pick": 0,
        "interpolated": 1,
        "borehole_observation": 2,
    }.get(c.source, 99)
    has_obs = 0 if c.observation_layer_id is not None else 1
    # Negative timestamp so most-recent sorts first.
    created_neg = -c.created_at.timestamp() if c.created_at is not None else 0.0
    return (source_rank, has_obs, created_neg)
