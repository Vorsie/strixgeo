"""Resolve-litho-instances use case — Phase-2 Slice 3.

Thin orchestration layer: loads model-scoped edges and formations via
``CorrelateLithoUnits.run_resolver``, writes ``instance_ordinal`` back
to non-locked rows, and marks changed surfaces stale.

This use case is MODEL-level only.  It does NOT touch cross-section
rows, seeded_formation_contact_ids, or any section-level state.  The
#57/applyUpdatedSection trap structurally cannot recur here — there is
no section entity in scope.

The "write-back + mark-stale" logic lives entirely in
``CorrelateLithoUnits.run_resolver``; this use case is a thin wrapper
that (a) keeps the API handler clean, (b) owns the commit boundary, and
(c) returns the update list in a typed form for the response schema.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.correlate_litho_units import CorrelateLithoUnits
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


@dataclass
class OrdinalUpdate:
    """One formation whose instance_ordinal changed after resolution.

    Attributes
    ----------
    formation_id : UUID
        Primary key of the geological_formation row.
    old_ordinal : int | None
        The ordinal before the resolver ran.  ALWAYS ``None`` on the
        explicit-resolve path (``ResolveLithoInstances``): ``run_resolver``
        captures the pre-mutation value only for its own debug log and
        does not surface it in its return dict, so this use case cannot
        populate it.  Reserved for future callers that thread the old
        value through explicitly (review SF-2).
    new_ordinal : int
        The ordinal assigned by the resolver.
    """

    formation_id: UUID
    old_ordinal: int | None
    new_ordinal: int


@dataclass
class ResolveResult:
    """Output of ``ResolveLithoInstances.execute``.

    Attributes
    ----------
    updated : list[OrdinalUpdate]
        One entry per formation whose ``instance_ordinal`` changed.
        Empty when the resolver ran but found nothing to change
        (idempotent no-op).
    """

    updated: list[OrdinalUpdate]


class ResolveLithoInstances(GroundModelLogger):
    """Re-run the litho-instance resolver for one model and commit the result.

    Delegates the actual resolution + write-back to the shared
    ``CorrelateLithoUnits.run_resolver`` so there is exactly ONE copy
    of the resolution/write-back/stale-marking logic in the codebase
    (correlate, uncorrelate, and explicit-resolve all route through it).
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    async def execute(
        self,
        *,
        model_id: UUID,
    ) -> ResolveResult:
        """Run the resolver and commit ordinal updates for ``model_id``.

        Parameters
        ----------
        model_id : UUID
            The lithostratigraphic model whose formations are resolved.
            The caller (API handler) must have already verified the model
            belongs to the request's project.

        Returns
        -------
        ResolveResult
            The list of per-formation ordinal changes.  Empty when
            nothing changed (idempotent re-resolve).

        Notes
        -----
        This use case is MODEL-level only.  It never modifies
        ``seeded_formation_contact_ids`` on any cross-section — the #57
        trap structurally cannot recur here.
        """
        self.info(f"ResolveLithoInstances: resolving model {model_id}")

        # Delegate to the shared resolver.  run_resolver loads formations +
        # edges, runs the pure domain service, writes ordinals back to
        # non-locked rows, flushes those changes, and marks changed surfaces
        # stale — all within the current session (no inner commit).
        helper = CorrelateLithoUnits(self._session)
        raw_updates = await helper.run_resolver(model_id)

        # Commit the writes made by run_resolver.
        await self._session.commit()

        # run_resolver returns list[{"formation_id": str, "new_ordinal": int}].
        # The old_ordinal is not tracked at that level (it compares against the
        # ORM value which has already been mutated by the time it appends to
        # updated). We surface old_ordinal=None for the explicit-resolve path —
        # the client only needs formation_id + new_ordinal for the badge cue
        # (old_ordinal is informational).
        updated = [
            OrdinalUpdate(
                formation_id=UUID(item["formation_id"]),
                old_ordinal=None,
                new_ordinal=item["new_ordinal"],
            )
            for item in raw_updates
        ]

        if updated:
            self.success(
                f"ResolveLithoInstances: committed {len(updated)} ordinal "
                f"update(s) for model {model_id}"
            )
        else:
            self.info(
                f"ResolveLithoInstances: no ordinal changes for model {model_id} (idempotent no-op)"
            )

        return ResolveResult(updated=updated)
