"""Use case — attach a name (and optional primary section) to a lens body.

Position 4 architecture (#101 R3).  A lens body is identified by its
``(formation_id, body_ordinal)`` pair, computed by the correlation resolver.
This use case creates (or updates) a ``LithoLensOrm`` metadata row that
attaches a human-readable name to that body.  The row is NOT the body —
it is decoration.

Idempotency: if a metadata row already exists for the
``(model_id, formation_id, body_ordinal)`` triple, its ``name`` and
``primary_section_id`` fields are updated in-place.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_lens_orm import LithoLensOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


@dataclass(frozen=True)
class NameLensBodyResult:
    """Return value of :meth:`NameLensBody.execute`.

    Attributes
    ----------
    lens_id : UUID
        The ``LithoLensOrm`` id (new or pre-existing).
    was_created : bool
        ``True`` when a new metadata row was inserted; ``False`` when an
        existing row was updated.
    """

    lens_id: UUID
    was_created: bool


class NameLensBody(GroundModelLogger):
    """Attach a name and optional primary section to a lens body.

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
        formation_id: UUID,
        body_ordinal: int,
        name: str,
        primary_section_id: UUID | None = None,
    ) -> NameLensBodyResult:
        """Create or update the ``LithoLensOrm`` metadata row for a body.

        Parameters
        ----------
        project_id : UUID
            Project scope guard.
        model_id : UUID
            The lithostratigraphic model that owns this body.
        formation_id : UUID
            The geological formation this body belongs to.
        body_ordinal : int
            Zero-based ordinal identifying this body within the formation's
            group (assigned by the correlation resolver).
        name : str
            Human-readable label for the body (e.g. ``"Upper clay drape"``).
        primary_section_id : UUID | None
            The cross-section from which the user invoked the naming gesture.
            Stored so ``CreatePerpendicularCompanion`` can locate the primary
            section when computing the companion bearing.  Optional — may be
            None when the gesture is invoked from a non-section context.

        Returns
        -------
        NameLensBodyResult
            The lens metadata row id and a creation flag.

        Raises
        ------
        ValueError
            When the project, model, or formation is not found.
        """
        self.info(
            f"NameLensBody.execute: "
            f"project={project_id} model={model_id} "
            f"formation={formation_id} ordinal={body_ordinal} "
            f"name={name!r}"
        )

        # ------------------------------------------------------------------
        # Scope guards.
        # ------------------------------------------------------------------
        model = await self._session.get(GeologicalModelOrm, model_id)
        if model is None or model.app_project_id != project_id:
            raise ValueError(f"Geological model {model_id} not found in project {project_id}")

        formation = await self._session.get(GeologicalFormationOrm, formation_id)
        if formation is None or formation.app_project_id != project_id:
            raise ValueError(f"Formation {formation_id} not found in project {project_id}")

        # ------------------------------------------------------------------
        # Check for an existing metadata row for this (model, formation, ordinal).
        # ------------------------------------------------------------------
        existing = (
            await self._session.execute(
                select(LithoLensOrm).where(
                    LithoLensOrm.model_id == model_id,
                    LithoLensOrm.formation_id == formation_id,
                    LithoLensOrm.body_ordinal == body_ordinal,
                )
            )
        ).scalar_one_or_none()

        if existing is not None:
            # Update the existing row.
            self.debug(
                f"Updating existing LithoLensOrm {existing.id} name={existing.name!r} → {name!r}"
            )
            existing.name = name
            if primary_section_id is not None:
                existing.primary_section_id = primary_section_id
            await self._session.flush()
            await self._session.commit()
            self.success(
                f"NameLensBody updated: lens={existing.id} "
                f"formation={formation_id} ordinal={body_ordinal} name={name!r}"
            )
            return NameLensBodyResult(lens_id=existing.id, was_created=False)

        # ------------------------------------------------------------------
        # Insert a new metadata row.
        # ------------------------------------------------------------------
        lens = LithoLensOrm(
            id=uuid7(),
            app_project_id=project_id,
            model_id=model_id,
            formation_id=formation_id,
            body_ordinal=body_ordinal,
            name=name,
            primary_section_id=primary_section_id,
        )
        self._session.add(lens)
        await self._session.flush()
        await self._session.commit()

        self.success(
            f"NameLensBody created: lens={lens.id} "
            f"formation={formation_id} ordinal={body_ordinal} name={name!r}"
        )
        return NameLensBodyResult(lens_id=lens.id, was_created=True)
