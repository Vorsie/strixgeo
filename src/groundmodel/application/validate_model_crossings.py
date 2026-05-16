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
        display_order + name, builds a per-formation
        ``(x, y) → contact_id`` lookup from the live contact rows so
        the validator can name the offending picks, then delegates to
        the pure-domain validator. Surfaces with no triangles (1-2
        contacts, all collinear) are filtered upstream by the
        validator and contribute no pairs.
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

        # Build per-formation (x, y) → contact_id lookup. This is what
        # lets the banner name the offending picks: a crossing detected
        # at vertex (vx, vy) of formation F maps back to the contact
        # whose anchor sits at (vx, vy) for F.
        #
        # Contacts are fetched ONE QUERY PER FORMATION (the loop below),
        # then a single IN-query each for borehole + cpt anchors. The
        # per-formation fan-out is debt #49 — a single
        # `list_contacts(model_id)` + Python grouping would collapse it
        # to one round-trip; fine at v1 cardinality. The ORM doesn't
        # carry a `borehole`/`cpt` relationship on
        # FormationContactOrm (debt #9 review: nullable XOR makes the
        # relationship pair awkward; explicit IN-queries stay clear).
        contact_rows: list[FormationContactOrm] = []
        for fid in formation_ids:
            contact_rows.extend(await self._repo.list_contacts(model_id, formation_id=fid))
        borehole_ids = {c.borehole_id for c in contact_rows if c.borehole_id is not None}
        cpt_ids = {c.cpt_id for c in contact_rows if c.cpt_id is not None}
        boreholes_by_id: dict[UUID, BoreholeOrm] = (
            {
                b.id: b
                for b in (
                    await self._session.execute(
                        select(BoreholeOrm).where(BoreholeOrm.id.in_(borehole_ids))
                    )
                )
                .scalars()
                .all()
            }
            if borehole_ids
            else {}
        )
        cpts_by_id: dict[UUID, CptOrm] = (
            {
                c.id: c
                for c in (await self._session.execute(select(CptOrm).where(CptOrm.id.in_(cpt_ids))))
                .scalars()
                .all()
            }
            if cpt_ids
            else {}
        )
        # Mirror the same (x, y) rounding the validator uses to key
        # the lookup — cm precision (2 decimals) is enough to
        # disambiguate any realistic survey grid without false
        # collisions on noise.
        lookup_by_formation: dict[UUID, dict[tuple[float, float], UUID]] = {}
        for c in contact_rows:
            anchor: BoreholeOrm | CptOrm | None = None
            if c.borehole_id is not None:
                anchor = boreholes_by_id.get(c.borehole_id)
            elif c.cpt_id is not None:
                anchor = cpts_by_id.get(c.cpt_id)
            if anchor is None or anchor.location_x is None or anchor.location_y is None:
                continue
            key = (round(anchor.location_x, 2), round(anchor.location_y, 2))
            lookup_by_formation.setdefault(c.formation_id, {})[key] = c.id

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
                    contact_lookup=lookup_by_formation.get(f.id, {}),
                )
            )

        issues = GeologyValidator().validate_no_crossings(inputs)
        self.debug(
            f"validate_model_crossings: {len(issues)} crossing(s) across {len(inputs)} surface(s)"
        )
        return issues
