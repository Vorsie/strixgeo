"""Repository for the geological-model tree (formations, models, contacts).

Owns CRUD + the ``validate_no_gaps`` domain check that the editor calls
on save. One repo class for all three tables because they're tightly
coupled — a contact references both a formation and a model, every
formation/model query is project-scoped, and exposing one class per
table would force the API router to wire three sessions in lockstep.

The class shape mirrors the existing ``ProjectRepository`` /
``BoreholeRepository`` pattern: one ``AsyncSession`` per request, plain
async methods, ``GroundModelLogger`` inheritance for the usual entry /
exit / success-or-warning logging.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from uuid6 import uuid7

from groundmodel.domain.services.geology_validator import (
    ContactDepth,
    GeologyValidator,
)
from groundmodel.domain.value_objects.gap_issue import GapIssue
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import (
    FormationContactOrm,
)
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import (
    GeologicalModelOrm,
)
from groundmodel.infrastructure.db.models.geotechnical_unit_orm import (
    GeotechnicalUnitOrm,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class GeologyRepository(GroundModelLogger):
    """Async CRUD + domain validation for the geological model tree."""

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    # -----------------------------------------------------------------
    # Formations — per-project vocabulary
    # -----------------------------------------------------------------

    async def create_formation(
        self,
        app_project_id: UUID,
        *,
        name: str,
        color: str,
        code: str | None = None,
        display_order: int = 0,
        regional_ref: str | None = None,
        description: str | None = None,
    ) -> GeologicalFormationOrm:
        """Insert a new formation row under the given project."""
        formation = GeologicalFormationOrm(
            id=uuid7(),
            app_project_id=app_project_id,
            name=name,
            code=code,
            color=color,
            display_order=display_order,
            regional_ref=regional_ref,
            description=description,
        )
        self._session.add(formation)
        await self._session.flush()
        self.success(f"Formation created: {formation.id} — {name}")
        return formation

    async def list_formations(self, app_project_id: UUID) -> list[GeologicalFormationOrm]:
        """Return all formations for a project, ordered by ``display_order`` then name."""
        stmt = (
            select(GeologicalFormationOrm)
            .where(GeologicalFormationOrm.app_project_id == app_project_id)
            .order_by(
                GeologicalFormationOrm.display_order,
                GeologicalFormationOrm.name,
            )
        )
        return list((await self._session.execute(stmt)).scalars().all())

    async def get_formation(self, formation_id: UUID) -> GeologicalFormationOrm | None:
        """Look up a formation by id. Returns ``None`` when missing."""
        return await self._session.get(GeologicalFormationOrm, formation_id)

    async def update_formation(
        self, formation_id: UUID, patch: dict[str, Any]
    ) -> GeologicalFormationOrm | None:
        """Apply a partial update. Only keys present in ``patch`` are written."""
        formation = await self.get_formation(formation_id)
        if formation is None:
            return None
        for key, value in patch.items():
            setattr(formation, key, value)
        await self._session.flush()
        self.info(f"Formation updated: {formation_id}")
        return formation

    async def delete_formation(self, formation_id: UUID) -> bool:
        """Delete a formation. Returns ``True`` if a row was removed.

        Cascade drops every ``FormationContact`` that referenced this
        formation. The editor should warn the user before calling.
        """
        formation = await self.get_formation(formation_id)
        if formation is None:
            return False
        await self._session.delete(formation)
        await self._session.flush()
        self.info(f"Formation deleted: {formation_id}")
        return True

    # -----------------------------------------------------------------
    # Geotechnical units — formation subdivision (structure only in v1)
    # -----------------------------------------------------------------

    async def create_unit(
        self,
        *,
        app_project_id: UUID,
        geological_formation_id: UUID,
        name: str,
        color: str,
        code: str | None = None,
        display_order: int = 0,
        description: str | None = None,
    ) -> GeotechnicalUnitOrm:
        """Insert a new geotechnical unit under a formation."""
        unit = GeotechnicalUnitOrm(
            id=uuid7(),
            app_project_id=app_project_id,
            geological_formation_id=geological_formation_id,
            name=name,
            color=color,
            code=code,
            display_order=display_order,
            description=description,
        )
        self._session.add(unit)
        await self._session.flush()
        self.success(f"Geotechnical unit created: {unit.id} — {name}")
        return unit

    async def list_units(
        self,
        *,
        app_project_id: UUID | None = None,
        geological_formation_id: UUID | None = None,
    ) -> list[GeotechnicalUnitOrm]:
        """List units, scoped by project and/or formation.

        At least one filter should be supplied — the router always
        passes ``geological_formation_id`` for the per-formation list.
        Sorted by ``display_order`` then name to match the formation
        list pattern.
        """
        stmt = select(GeotechnicalUnitOrm)
        if app_project_id is not None:
            stmt = stmt.where(GeotechnicalUnitOrm.app_project_id == app_project_id)
        if geological_formation_id is not None:
            stmt = stmt.where(
                GeotechnicalUnitOrm.geological_formation_id == geological_formation_id
            )
        stmt = stmt.order_by(
            GeotechnicalUnitOrm.display_order,
            GeotechnicalUnitOrm.name,
        )
        return list((await self._session.execute(stmt)).scalars().all())

    async def get_unit(self, unit_id: UUID) -> GeotechnicalUnitOrm | None:
        """Look up a unit by id. Returns ``None`` when missing."""
        return await self._session.get(GeotechnicalUnitOrm, unit_id)

    async def update_unit(self, unit_id: UUID, patch: dict[str, Any]) -> GeotechnicalUnitOrm | None:
        """Apply a partial update. Only keys present in ``patch`` are written.

        The router strips ``geological_formation_id`` from the patch
        upstream — re-parenting a unit goes through delete + recreate
        rather than mutate, mirroring the same rule for
        ``FormationContact``'s anchor.
        """
        unit = await self.get_unit(unit_id)
        if unit is None:
            return None
        for key, value in patch.items():
            setattr(unit, key, value)
        await self._session.flush()
        self.info(f"Geotechnical unit updated: {unit_id}")
        return unit

    async def delete_unit(self, unit_id: UUID) -> bool:
        """Delete a unit. No cascading children — units are leaves in v1."""
        unit = await self.get_unit(unit_id)
        if unit is None:
            return False
        await self._session.delete(unit)
        await self._session.flush()
        self.info(f"Geotechnical unit deleted: {unit_id}")
        return True

    # -----------------------------------------------------------------
    # Models — interpretation containers
    # -----------------------------------------------------------------

    async def create_model(
        self,
        app_project_id: UUID,
        *,
        name: str,
        description: str | None = None,
        is_active: bool = False,
        excluded_borehole_ids: list[UUID] | None = None,
    ) -> GeologicalModelOrm:
        """Insert a new geological model under the given project."""
        model = GeologicalModelOrm(
            id=uuid7(),
            app_project_id=app_project_id,
            name=name,
            description=description,
            is_active=is_active,
            excluded_borehole_ids=excluded_borehole_ids or [],
        )
        self._session.add(model)
        await self._session.flush()
        self.success(f"Model created: {model.id} — {name}")
        return model

    async def list_models(self, app_project_id: UUID) -> list[GeologicalModelOrm]:
        """Return all models for a project, active first then by name."""
        stmt = (
            select(GeologicalModelOrm)
            .where(GeologicalModelOrm.app_project_id == app_project_id)
            .order_by(
                # Active first; within each group, sort alphabetically.
                # ``desc()`` on the boolean puts True (== 1) ahead of False.
                GeologicalModelOrm.is_active.desc(),
                GeologicalModelOrm.name,
            )
        )
        return list((await self._session.execute(stmt)).scalars().all())

    async def get_model(self, model_id: UUID) -> GeologicalModelOrm | None:
        """Load a model with its contacts eager-loaded.

        The editor wants the contacts up-front so it can render the
        cross-section without follow-up requests; the cost of always
        loading them here is acceptable while contact counts stay in the
        low hundreds per project.
        """
        stmt = (
            select(GeologicalModelOrm)
            .where(GeologicalModelOrm.id == model_id)
            .options(selectinload(GeologicalModelOrm.contacts))
        )
        return (await self._session.execute(stmt)).scalar_one_or_none()

    async def update_model(
        self, model_id: UUID, patch: dict[str, Any]
    ) -> GeologicalModelOrm | None:
        """Apply a partial update. Only keys present in ``patch`` are written."""
        model = await self._session.get(GeologicalModelOrm, model_id)
        if model is None:
            return None
        for key, value in patch.items():
            setattr(model, key, value)
        await self._session.flush()
        self.info(f"Model updated: {model_id}")
        return model

    async def set_active_model(
        self, app_project_id: UUID, model_id: UUID
    ) -> GeologicalModelOrm | None:
        """Mark one model as active and clear the flag on every sibling.

        The DB doesn't enforce "one active per project" so this is the
        app-level guard. Implemented as a bulk UPDATE on the project's
        models followed by a single-row UPDATE on the target — cheaper
        and atomic-enough for our scale.
        """
        target = await self._session.get(GeologicalModelOrm, model_id)
        if target is None or target.app_project_id != app_project_id:
            return None
        # Clear every sibling first, then set the target. Order matters
        # so the target isn't briefly NOT active inside the same flush.
        await self._session.execute(
            update(GeologicalModelOrm)
            .where(GeologicalModelOrm.app_project_id == app_project_id)
            .where(GeologicalModelOrm.id != model_id)
            .values(is_active=False)
        )
        target.is_active = True
        await self._session.flush()
        self.info(f"Active model set: {model_id}")
        return target

    async def delete_model(self, model_id: UUID) -> bool:
        """Delete a model. Cascade drops every contact under it."""
        model = await self._session.get(GeologicalModelOrm, model_id)
        if model is None:
            return False
        await self._session.delete(model)
        await self._session.flush()
        self.info(f"Model deleted: {model_id}")
        return True

    # -----------------------------------------------------------------
    # Contacts — anchored formation tops
    # -----------------------------------------------------------------

    async def create_contact(
        self,
        *,
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
    ) -> FormationContactOrm:
        """Insert a new formation contact (formation top at an investigation).

        Exactly one of ``borehole_id`` / ``cpt_id`` must be set — the
        DB CHECK constraint enforces it but we raise early here so the
        caller gets a clear ``ValueError`` instead of an opaque SQL
        error at flush time.
        """
        if (borehole_id is None) == (cpt_id is None):
            raise ValueError(
                "Exactly one of borehole_id / cpt_id must be set on a FormationContact"
            )
        contact = FormationContactOrm(
            id=uuid7(),
            model_id=model_id,
            formation_id=formation_id,
            borehole_id=borehole_id,
            cpt_id=cpt_id,
            depth_top_m=depth_top_m,
            source=source,
            confidence=confidence,
            observation_id=observation_id,
            observation_layer_id=observation_layer_id,
            notes=notes,
        )
        self._session.add(contact)
        await self._session.flush()
        self.success(f"Contact created: {contact.id} @ {depth_top_m} m")
        return contact

    async def list_contacts(
        self,
        model_id: UUID,
        *,
        borehole_id: UUID | None = None,
        formation_id: UUID | None = None,
    ) -> list[FormationContactOrm]:
        """List contacts in a model, optionally filtered by borehole / formation.

        Sorted by ``depth_top_m`` (shallowest first) — matches how the
        editor wants to render them top-to-bottom.
        """
        stmt = (
            select(FormationContactOrm)
            .where(FormationContactOrm.model_id == model_id)
            .order_by(FormationContactOrm.depth_top_m)
        )
        if borehole_id is not None:
            stmt = stmt.where(FormationContactOrm.borehole_id == borehole_id)
        if formation_id is not None:
            stmt = stmt.where(FormationContactOrm.formation_id == formation_id)
        return list((await self._session.execute(stmt)).scalars().all())

    async def update_contact(
        self, contact_id: UUID, patch: dict[str, Any]
    ) -> FormationContactOrm | None:
        """Apply a partial update to a contact."""
        contact = await self._session.get(FormationContactOrm, contact_id)
        if contact is None:
            return None
        for key, value in patch.items():
            setattr(contact, key, value)
        await self._session.flush()
        self.info(f"Contact updated: {contact_id}")
        return contact

    async def delete_contact(self, contact_id: UUID) -> bool:
        """Delete a contact. No cascading children — contacts are leaves."""
        contact = await self._session.get(FormationContactOrm, contact_id)
        if contact is None:
            return False
        await self._session.delete(contact)
        await self._session.flush()
        self.info(f"Contact deleted: {contact_id}")
        return True

    # -----------------------------------------------------------------
    # Domain validation — the "no gaps" rule
    # -----------------------------------------------------------------

    async def validate_no_gaps(self, model_id: UUID, borehole_id: UUID) -> list[GapIssue]:
        """Load contacts + borehole depth and delegate to :class:`GeologyValidator`.

        Kept on the repository so the existing single-call surface
        (``GET /...validate``) doesn't fan out into a use case +
        repo dance for what is fundamentally a read-only check.
        The domain logic itself lives in
        :mod:`groundmodel.domain.services.geology_validator`; this
        method is the infrastructure-side loader.
        """
        contacts = await self.list_contacts(model_id, borehole_id=borehole_id)
        borehole = await self._session.get(BoreholeOrm, borehole_id)
        total_depth = borehole.total_depth_m if borehole is not None else None
        # Project ORM rows into the validator's narrow input shape so
        # the domain service has zero infrastructure dependency.
        depths = [ContactDepth(id=c.id, depth_top_m=c.depth_top_m) for c in contacts]
        return GeologyValidator().validate_no_gaps(depths, total_depth)
