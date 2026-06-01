"""Create-formation-contact use case.

Wraps the repository insert with the project-standard use-case
shape: owns its session commit, logs at the application boundary,
and is the hook future editor-side orchestration (e.g. "run the
no-gaps validator after every save and return the issues alongside
the inserted row") will extend without churning callers.

The XOR check on the anchor (borehole_id / cpt_id) lives at three
boundaries by design:

1. Pydantic ``FormationContactCreateRequest`` rejects bad bodies
   at the HTTP boundary with a clean 422.
2. The repository raises ``ValueError`` as a defence-in-depth for
   any non-API caller (bundle restore, future CLI tools, tests).
3. A DB ``CheckConstraint`` is the final safety net.

The use case does NOT re-check — it trusts the layer above and
passes the call through.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.scope_guard import load_scoped_or_raise
from groundmodel.domain.value_objects.formation_contact_result import (
    FormationContactResult,
)
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import (
    FormationContactOrm,
)
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.repositories.geology_repository import (
    GeologyRepository,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class DuplicateContactError(Exception):
    """A contact for the same (model, anchor, formation) already exists.

    Geological semantics: each formation has exactly ONE top per
    investigation. Two contacts for "Boom Klei" on borehole-X are
    geologically meaningless — there's a single top of Boom Klei.
    Carries the existing contact's id so the caller (router) can
    surface it in the 409 response, letting the frontend offer
    "move the existing one to here" instead of an opaque error.
    """

    def __init__(self, existing_contact_id: UUID) -> None:
        super().__init__(
            f"A contact for this (model, anchor, formation) already exists: {existing_contact_id}"
        )
        self.existing_contact_id = existing_contact_id


class CreateFormationContact(GroundModelLogger):
    """Insert one formation contact and commit the transaction."""

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session
        self._repo = GeologyRepository(session)

    async def execute(
        self,
        *,
        project_id: UUID,
        model_id: UUID,
        formation_id: UUID,
        depth_top_m: float,
        borehole_id: UUID | None = None,
        cpt_id: UUID | None = None,
        source: str = "manual_pick",
        confidence: str = "medium",
        observation_id: UUID | None = None,
        observation_layer_id: UUID | None = None,
        notes: str | None = None,
    ) -> FormationContactResult:
        """Insert a contact under ``model_id`` and commit.

        Parameters
        ----------
        project_id : UUID
            Owning project — the formation, borehole/CPT anchor, and model
            must all belong to this project (VULN-9 defence-in-depth).
        model_id : UUID
            Model the contact belongs to.
        formation_id : UUID
            Formation whose top this pick marks.
        depth_top_m : float
            Depth (m) of the formation top at the anchor column.
        borehole_id, cpt_id : UUID | None
            Anchor investigation. Exactly one must be set — the
            repository raises ``ValueError`` otherwise.
        source, confidence : str
            Provenance + engineer-certainty tags.
        observation_id, observation_layer_id : UUID | None
            Optional backlinks when the pick was derived from a
            DOV observation row.
        notes : str | None
            Free-text engineer note specific to this pick.

        Returns
        -------
        FormationContactResult
            Immutable snapshot of the freshly-inserted row with all DB
            defaults populated.  The ORM row is refreshed before the
            snapshot is taken so all server-side defaults (``created_at``,
            ``updated_at``, etc.) are present.

        Raises
        ------
        ValueError
            When the anchor XOR rule is violated, or when the formation
            or anchor investigation do not belong to ``project_id``.
        DuplicateContactError
            When a contact for the same (model, anchor, formation)
            triple already exists. The router maps this to a 409 +
            the existing id, letting the frontend offer a "move
            existing" path instead of a duplicate insert.
        """
        self.info(f"Creating formation contact: model={model_id}, formation={formation_id}")

        # Defence-in-depth: verify the formation and each supplied anchor
        # belong to project_id.  The model scope is already checked by the
        # router's get_in_project_or_404 guard; these checks prevent a
        # crafted request from embedding a foreign-project formation_id or
        # anchor id in the body (VULN-9).
        await load_scoped_or_raise(
            self._session, GeologicalFormationOrm, formation_id, project_id, label="Formation"
        )
        if borehole_id is not None:
            await load_scoped_or_raise(
                self._session, BoreholeOrm, borehole_id, project_id, label="Borehole"
            )
        if cpt_id is not None:
            await load_scoped_or_raise(self._session, CptOrm, cpt_id, project_id, label="CPT")
        # Per-(model, anchor, formation) uniqueness check. Geological
        # semantic: a formation has exactly one top per investigation.
        # Two-layer enforcement: this best-effort SELECT keeps the
        # happy path fast (a 409 short-circuits the INSERT entirely),
        # while the partial unique indexes on ``formation_contact``
        # (migration c9f4e72a3811 — one per anchor flavour to handle
        # the XOR pair) close the race for parallel transactions
        # that both pass this check before either commits.
        anchor_filter = (
            FormationContactOrm.borehole_id == borehole_id
            if borehole_id is not None
            else FormationContactOrm.cpt_id == cpt_id
        )
        existing_id_stmt = select(FormationContactOrm.id).where(
            FormationContactOrm.model_id == model_id,
            FormationContactOrm.formation_id == formation_id,
            anchor_filter,
        )
        existing_id = (await self._session.execute(existing_id_stmt)).scalar_one_or_none()
        if existing_id is not None:
            self.warning(
                f"Duplicate contact rejected: model={model_id} "
                f"formation={formation_id} anchor="
                f"{borehole_id or cpt_id} → existing id={existing_id}"
            )
            raise DuplicateContactError(existing_id)
        # Race-safety net: the application-layer check above is best-
        # effort. Two parallel transactions can both pass it before
        # either commits. The partial unique indexes on
        # ``formation_contact`` (migration c9f4e72a3811) reject the
        # second insert with an IntegrityError; catch that and
        # convert to the same DuplicateContactError shape so the
        # API contract (409 + existing id) is preserved no matter
        # which check trips first.
        try:
            contact = await self._repo.create_contact(
                model_id=model_id,
                formation_id=formation_id,
                depth_top_m=depth_top_m,
                borehole_id=borehole_id,
                cpt_id=cpt_id,
                source=source,
                confidence=confidence,
                observation_id=observation_id,
                observation_layer_id=observation_layer_id,
                notes=notes,
            )
        except IntegrityError as err:
            await self._session.rollback()
            # Re-query for the row that won the race. If the failure
            # was the (model, formation, anchor) unique index, the
            # winner is now visible to us. If it was a different
            # constraint (CHECK, FK, ...), the re-query finds
            # nothing and we re-raise the original error.
            winner_id = (await self._session.execute(existing_id_stmt)).scalar_one_or_none()
            if winner_id is None:
                raise
            self.warning(
                f"Duplicate contact race lost: model={model_id} "
                f"formation={formation_id} anchor="
                f"{borehole_id or cpt_id} → winner id={winner_id}"
            )
            raise DuplicateContactError(winner_id) from err
        # On-click build pivot: per-contact mutations no longer trigger
        # Delaunay. Flag the surface stale so the section view renders
        # it dashed + faded; user clicks Build to materialise. Cheap
        # one-row UPDATE (no-op when no surface row exists yet).
        await self._repo.mark_surfaces_stale([(model_id, formation_id)])
        await self._session.commit()
        await self._session.refresh(contact)
        self.success(f"Formation contact created: {contact.id}")
        return FormationContactResult.from_orm(contact)
