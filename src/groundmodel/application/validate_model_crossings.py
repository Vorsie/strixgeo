"""Validate-model-crossings use case.

Walks every formation surface cached for a geological model and
hands the list to :class:`GeologyValidator.validate_no_crossings`.
Returns the list of ``formation_crossing`` issues — one per pair
of surfaces that violate the stratigraphic-order superposition
rule.

Read-only — never raises, never commits. The frontend surfaces
the list as inline warnings in the InterpretationPane and the
section view.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.domain.services.geology_validator import (
    FormationSurfaceInput,
    GeologyValidator,
)
from groundmodel.domain.services.tin_surface import TinSurface
from groundmodel.domain.value_objects.gap_issue import GapIssue
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.repositories.geology_repository import (
    GeologyRepository,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class ValidateModelCrossings(GroundModelLogger):
    """Run the cross-formation crossing validator for one model."""

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session
        self._repo = GeologyRepository(session)

    async def execute(self, model_id: UUID) -> list[GapIssue]:
        """Return the list of formation_crossing issues for the model.

        Loads the cached TIN surfaces, joins each to its formation's
        display_order + name, then delegates to the pure-domain
        validator. Surfaces with no triangles (1-2 contacts, all
        collinear) are filtered upstream by the validator and
        contribute no pairs.
        """
        self.info(f"validate_model_crossings: model={model_id}")
        surface_rows = await self._repo.list_surfaces(model_id)
        if not surface_rows:
            self.debug(f"validate_model_crossings: model={model_id} has no cached surfaces")
            return []

        # Bulk-load the formations referenced by the surface rows so
        # we can attach display_order + name without one query per
        # surface.
        formation_ids = {s.formation_id for s in surface_rows}
        formations_by_id: dict[UUID, GeologicalFormationOrm] = {
            f.id: f
            for f in (
                await self._session.execute(
                    select(GeologicalFormationOrm).where(
                        GeologicalFormationOrm.id.in_(formation_ids)
                    )
                )
            )
            .scalars()
            .all()
        }

        inputs: list[FormationSurfaceInput] = []
        for s in surface_rows:
            f = formations_by_id.get(s.formation_id)
            if f is None:
                # A surface referencing a deleted formation shouldn't
                # exist (the cascade on formation delete drops contacts
                # which then drops surfaces on next recompute), but
                # defend against it rather than KeyError.
                continue
            # JSONB stores vertices/triangles as lists — re-tuple them
            # for the immutable TinSurface value object.
            vertices = [(float(v[0]), float(v[1]), float(v[2])) for v in s.vertices]
            triangles = [(int(t[0]), int(t[1]), int(t[2])) for t in s.triangles]
            inputs.append(
                FormationSurfaceInput(
                    formation_id=f.id,
                    name=f.name,
                    display_order=f.display_order,
                    surface=TinSurface(vertices=vertices, triangles=triangles),
                )
            )

        issues = GeologyValidator().validate_no_crossings(inputs)
        self.debug(
            f"validate_model_crossings: {len(issues)} crossing(s) across {len(inputs)} surface(s)"
        )
        return issues
