"""Use case — attach a name (and optional primary section) to a body.

Position 4 architecture (#101 R3).  A body is identified by its
``(formation_id, body_ordinal)`` pair, computed by the correlation resolver.
This use case creates (or updates) a ``BodyOrm`` metadata row that
attaches a human-readable name to that body.  The row is NOT the body —
it is decoration.

Idempotency: if a metadata row already exists for the
``(model_id, formation_id, body_ordinal)`` triple, its ``name`` and
``primary_section_id`` fields are updated in-place.

Originally named NameLensBody — Slice 2 rename.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.scope_guard import load_scoped_or_raise
from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


@dataclass(frozen=True)
class NameBodyResult:
    """Return value of :meth:`NameBody.execute`.

    Attributes
    ----------
    body_id : UUID
        The ``BodyOrm`` id (new or pre-existing).
        Renamed from ``lens_id`` in Slice 3.3 (2026-06-01).
    was_created : bool
        ``True`` when a new metadata row was inserted; ``False`` when an
        existing row was updated.
    """

    body_id: UUID
    was_created: bool


class NameBody(GroundModelLogger):
    """Attach a name and optional primary section to a body.

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
    ) -> NameBodyResult:
        """Create or update the ``BodyOrm`` metadata row for a body.

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
        NameBodyResult
            The body metadata row id and a creation flag.

        Raises
        ------
        ValueError
            When the project, model, or formation is not found.
        """
        self.info(
            f"NameBody.execute: "
            f"project={project_id} model={model_id} "
            f"formation={formation_id} ordinal={body_ordinal} "
            f"name={name!r}"
        )

        # ------------------------------------------------------------------
        # Scope guards.
        # ------------------------------------------------------------------
        await load_scoped_or_raise(
            self._session, GeologicalModelOrm, model_id, project_id, label="Geological model"
        )
        await load_scoped_or_raise(
            self._session, GeologicalFormationOrm, formation_id, project_id, label="Formation"
        )

        # ------------------------------------------------------------------
        # Check for an existing metadata row for this (model, formation, ordinal).
        # ------------------------------------------------------------------
        existing = (
            await self._session.execute(
                select(BodyOrm).where(
                    BodyOrm.model_id == model_id,
                    BodyOrm.formation_id == formation_id,
                    BodyOrm.body_ordinal == body_ordinal,
                )
            )
        ).scalar_one_or_none()

        if existing is not None:
            # Update the existing row.
            self.debug(f"Updating existing BodyOrm {existing.id} name={existing.name!r} → {name!r}")
            existing.name = name
            if primary_section_id is not None:
                existing.primary_section_id = primary_section_id
            await self._session.flush()
            await self._session.commit()
            self.success(
                f"NameBody updated: body={existing.id} "
                f"formation={formation_id} ordinal={body_ordinal} name={name!r}"
            )
            return NameBodyResult(body_id=existing.id, was_created=False)

        # ------------------------------------------------------------------
        # Insert a new metadata row.
        # ------------------------------------------------------------------
        body = BodyOrm(
            id=uuid7(),
            app_project_id=project_id,
            model_id=model_id,
            formation_id=formation_id,
            body_ordinal=body_ordinal,
            name=name,
            primary_section_id=primary_section_id,
        )
        self._session.add(body)
        await self._session.flush()
        await self._session.commit()

        self.success(
            f"NameBody created: body={body.id} "
            f"formation={formation_id} ordinal={body_ordinal} name={name!r}"
        )
        return NameBodyResult(body_id=body.id, was_created=True)
