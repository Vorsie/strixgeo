"""Materialise-body-companions use case — #133 Phase 2+3.

For each ``BodyOrm`` row that lacks a companion section, evaluates
the strict gate (every contact on the primary section has at least one
``user_approved=True`` outbound edge).  Qualifying bodies get a
companion section via ``CreatePerpendicularCompanion``.  Per-body
errors are caught and counted; the loop continues.

Gate behaviour
--------------
* ``primary_section_id is None`` → ``skipped_no_primary``.
* Primary section deleted since body creation → ``skipped_no_primary``.
* Primary section has zero seeded contacts → gate passes vacuously
  (vacuous truth: no contact can violate the constraint if there are none).
* At least one seeded contact lacks an approved edge → ``skipped_unfinished_section``.
* All seeded contacts covered → companion creation attempted.

Approved-edge set is loaded once (model-scoped) before the body loop,
not per body — the set does not change during the pass.

Per-body ``Exception`` is caught and counted as ``errored``; the loop
continues so partial progress is retained (each body commits independently
via ``CreatePerpendicularCompanion``'s internal commit).

Originally named MaterialiseLensCompanions — Slice 2 rename.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.create_perpendicular_companion import (
    CreatePerpendicularCompanion,
)
from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


@dataclass
class MaterialiseBodyCompanionsResult:
    """Outcome counts for the materialise pass.

    Attributes
    ----------
    companion_sections_created : int
        Number of companion sections successfully created.
    skipped_no_primary : int
        Bodies skipped because ``primary_section_id`` is null or the
        primary section no longer exists.
    skipped_unfinished_section : int
        Bodies skipped because at least one seeded contact on the primary
        section has no approved outbound edge (gate failed).
    errored : int
        Bodies that raised an unexpected exception during companion
        creation (e.g. geometry edge-case in the perpendicular algorithm).
    """

    companion_sections_created: int
    skipped_no_primary: int
    skipped_unfinished_section: int
    errored: int


class MaterialiseBodyCompanions(GroundModelLogger):
    """Create perpendicular companion sections for qualifying bodies.

    Idempotent: bodies that already have companions are skipped silently
    by ``CreatePerpendicularCompanion``'s existence guard.

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
        project_id: UUID,
        model_id: UUID,
    ) -> MaterialiseBodyCompanionsResult:
        """Run the materialisation pass for all companion-less bodies in the model.

        Parameters
        ----------
        project_id : UUID
            Project scope guard — passed through to
            ``CreatePerpendicularCompanion``.
        model_id : UUID
            The lithostratigraphic model whose bodies are processed.

        Returns
        -------
        MaterialiseBodyCompanionsResult
            Counts of companions created, skipped, and errored.
        """
        self.info(f"MaterialiseBodyCompanions: model={model_id}")

        # 1. Load bodies for the model that lack a companion section.
        #    NOT EXISTS subquery against cross_section.companion_lens_id.
        no_companion = ~exists(
            select(CrossSectionOrm.id).where(CrossSectionOrm.companion_lens_id == BodyOrm.id)
        )
        bodies_stmt = select(BodyOrm).where(
            BodyOrm.model_id == model_id,
            no_companion,
        )
        bodies = (await self._session.execute(bodies_stmt)).scalars().all()
        self.debug(f"MaterialiseBodyCompanions: {len(bodies)} body(ies) without companion")

        # 2. Load all approved edges for the model once — used in the gate below.
        #    Loading outside the per-body loop: the set is model-scoped and
        #    does not change during this pass (each companion commit only
        #    writes cross_section rows, not edge rows).
        approved_stmt = select(
            LithoContactCorrelationEdgeOrm.contact_a_id,
            LithoContactCorrelationEdgeOrm.contact_b_id,
        ).where(
            LithoContactCorrelationEdgeOrm.model_id == model_id,
            LithoContactCorrelationEdgeOrm.user_approved.is_(True),
        )
        approved_rows = (await self._session.execute(approved_stmt)).all()
        approved_contact_ids: set[UUID] = set()
        for r in approved_rows:
            approved_contact_ids.add(r.contact_a_id)
            approved_contact_ids.add(r.contact_b_id)
        self.debug(
            f"MaterialiseBodyCompanions: {len(approved_contact_ids)} "
            "contact(s) covered by approved edges"
        )

        created = 0
        skipped_no_primary = 0
        skipped_unfinished = 0
        errored = 0

        for i, body in enumerate(bodies, start=1):
            prefix = f"  [{i}/{len(bodies)}] body {body.id}"

            # 3. Primary-section guard.
            if body.primary_section_id is None:
                skipped_no_primary += 1
                self.debug(f"{prefix} skipped — no primary_section_id")
                continue

            sec = await self._session.get(CrossSectionOrm, body.primary_section_id)
            if sec is None:
                # Section was deleted between BodyOrm creation and now.
                skipped_no_primary += 1
                self.debug(
                    f"{prefix} skipped — primary section {body.primary_section_id} no longer exists"
                )
                continue

            # 4. Gate: every seeded contact must have at least one approved edge.
            contact_ids: list[UUID] = sec.seeded_formation_contact_ids or []
            if contact_ids:
                unfinished = [cid for cid in contact_ids if cid not in approved_contact_ids]
                if unfinished:
                    skipped_unfinished += 1
                    self.debug(
                        f"{prefix} skipped — section {sec.id} has "
                        f"{len(unfinished)} uncorrelated contact(s)"
                    )
                    continue
            # If contact_ids is empty the gate passes vacuously: there are no
            # contacts to violate the constraint.

            # 5. Create the companion section.
            try:
                await CreatePerpendicularCompanion(self._session).execute(
                    project_id=project_id,
                    model_id=model_id,
                    lens_id=body.id,
                )
                created += 1
                self.debug(f"{prefix} companion created")
            except Exception as exc:
                self.warning(f"{prefix} errored: {exc}")
                errored += 1

        self.success(
            f"MaterialiseBodyCompanions: created={created} "
            f"skipped_no_primary={skipped_no_primary} "
            f"skipped_unfinished_section={skipped_unfinished} "
            f"errored={errored}"
        )
        return MaterialiseBodyCompanionsResult(
            companion_sections_created=created,
            skipped_no_primary=skipped_no_primary,
            skipped_unfinished_section=skipped_unfinished,
            errored=errored,
        )
