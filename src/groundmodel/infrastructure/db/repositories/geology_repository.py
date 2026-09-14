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

from collections.abc import Iterable
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
from groundmodel.infrastructure.db.models.formation_surface_orm import (
    FormationSurfaceOrm,
)
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import (
    GeologicalModelOrm,
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
        lithology: str | None = None,
        nad_class: int | None = None,
        parent_formation_id: UUID | None = None,
        litho_main_soil_code: str | None = None,
        litho_admixtures: list[dict] | None = None,
    ) -> GeologicalFormationOrm:
        """Insert a new formation row under the given project.

        Parameters
        ----------
        app_project_id : UUID
            Project scope — the formation is owned by this project.
        name : str
            Human-readable formation name (required, non-empty).
        color : str
            Hex colour for the formation band.
        code : str | None
            Optional short code (e.g. "Bk" for Boom Klei).
        display_order : int
            Stratigraphic sort key (0 = oldest).
        regional_ref : str | None
            Optional reference to a regional catalogue entry.
        description : str | None
            Free-text description.
        lithology : str | None
            Main soil code when this is a lithostratigraphic unit.
        nad_class : int | None
            Belgian NAD packing class (1–31) for geotechnical units.
        parent_formation_id : UUID | None
            Links a lithostratigraphic child unit to its parent
            geological formation.  Absent for geological formations.
        litho_main_soil_code : str | None
            Robertson-SBT primary soil code (e.g. "ZAND", "KLEI").
            Set when creating a litho unit without a contact — the
            find-or-create key in AcceptLithoSuggestions also uses this
            field. Absent for geological formations.
        litho_admixtures : list[dict] | None
            JSONB-serialised admixture list from AdmixtureItem.  Each
            entry is ``{"soil_code": str, "amount": str, "locally": bool}``.
            Absent for geological formations.

        Returns
        -------
        GeologicalFormationOrm
            The newly inserted and flushed formation row.
        """
        formation = GeologicalFormationOrm(
            id=uuid7(),
            app_project_id=app_project_id,
            name=name,
            code=code,
            color=color,
            display_order=display_order,
            regional_ref=regional_ref,
            description=description,
            lithology=lithology,
            nad_class=nad_class,
            parent_formation_id=parent_formation_id,
            litho_main_soil_code=litho_main_soil_code,
            litho_admixtures=litho_admixtures,
        )
        self._session.add(formation)
        await self._session.flush()
        # Id at SUCCESS, name at DEBUG: a formation/unit name can echo a site
        # ("Kaai 42 fill"), so it must not sit on an always-on line in the
        # unredacted ``backend.log``.
        self.success(f"Formation created: {formation.id}")
        self.debug(f"Formation created: {formation.id} — name {name!r}")
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
        kind: str = "geological",
        parent_model_id: UUID | None = None,
    ) -> GeologicalModelOrm:
        """Insert a new geological model under the given project.

        The caller (creation endpoint) is responsible for enforcing the
        ``REQUIRED_PARENT_KIND`` invariant before calling this — the
        repository persists what it is given.

        When ``is_active=True`` the same-kind same-project siblings are
        cleared first so the "one active per kind" invariant
        (``set_active_model`` enforces this on the activate path) also
        holds on the create path.  Without this two models could end up
        both flagged active, and the desktop client's
        ``find(m => m.is_active && m.kind === ...)`` picks the
        alphabetically-first one — silently hiding the freshly-created
        one from the dropdown (owner dogfeed 2026-05-27 #147 follow-up:
        "i can only have one active litho model? making new
        overwrites?").
        """
        if is_active:
            await self._session.execute(
                update(GeologicalModelOrm)
                .where(GeologicalModelOrm.app_project_id == app_project_id)
                .where(GeologicalModelOrm.kind == kind)
                .values(is_active=False)
            )
        model = GeologicalModelOrm(
            id=uuid7(),
            app_project_id=app_project_id,
            name=name,
            description=description,
            is_active=is_active,
            excluded_borehole_ids=excluded_borehole_ids or [],
            kind=kind,
            parent_model_id=parent_model_id,
        )
        self._session.add(model)
        await self._session.flush()
        # Id at SUCCESS, name at DEBUG: a model name can echo a site, so it
        # must not sit on an always-on line in the unredacted ``backend.log``.
        self.success(f"Model created: {model.id}")
        self.debug(f"Model created: {model.id} — name {name!r}")
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
        """Mark one model active and clear the flag on every SAME-KIND sibling.

        "One active per project" became "one active **per kind**" with
        the three-level hierarchy: activating a lithostratigraphic
        model must NOT deactivate the geological model the section
        editor references (each kind has its own active pointer). The
        sibling clear is therefore scoped to ``target.kind`` — this is
        a deliberate behaviour change to a pre-existing operation.

        Implemented as a bulk UPDATE on the project's same-kind models
        followed by a single-row UPDATE on the target — atomic-enough
        for our scale.
        """
        target = await self._session.get(GeologicalModelOrm, model_id)
        if target is None or target.app_project_id != app_project_id:
            return None
        # Clear every SAME-KIND sibling first, then set the target.
        # Order matters so the target isn't briefly NOT active inside
        # the same flush. Cross-kind models are untouched.
        await self._session.execute(
            update(GeologicalModelOrm)
            .where(GeologicalModelOrm.app_project_id == app_project_id)
            .where(GeologicalModelOrm.kind == target.kind)
            .where(GeologicalModelOrm.id != model_id)
            .values(is_active=False)
        )
        target.is_active = True
        await self._session.flush()
        self.info(f"Active model set: {model_id}")
        return target

    async def has_child_models(self, model_id: UUID) -> bool:
        """True if any model declares ``model_id`` as its parent.

        Used by the delete endpoint to surface a 409 BEFORE attempting
        the delete (deterministic, clear message) rather than letting
        the ``ON DELETE RESTRICT`` FK raise a raw IntegrityError on
        commit. A lithostratigraphic model pins its geological parent;
        a geotechnical model pins its lithostratigraphic parent.
        """
        stmt = select(GeologicalModelOrm.id).where(GeologicalModelOrm.parent_model_id == model_id)
        return (await self._session.execute(stmt)).first() is not None

    async def delete_model(self, model_id: UUID) -> bool:
        """Delete a model, removing only the formations it actually owns.

        Debt #37 — the old behaviour deleted **every** project formation
        on any model delete. Formations are project-scoped (no model FK,
        correct as shared vocabulary), and multiple models per project is
        a designed capability (``set_active_model`` clears siblings), so
        the blanket delete meant: deleting model A silently destroyed the
        formations of model B. That is catastrophic, hard-to-explain data
        loss for a dogfeeding engineer.

        New, model-aware rule:

        * A formation with a contact in THIS model and **none in any
          other model** is exclusively this model's → delete it (ORM
          cascade drops its contacts + geotechnical units).
        * A formation with a contact in another model is shared → KEEP
          it (the other model still needs it).
        * A formation with no contacts in any model is unplaced project
          vocabulary. KEEP it when other models remain; delete it only
          when this is the project's **last** model — that preserves the
          original single-model "delete the model = clean slate, no
          orphan formations stranding a stale inspector badge" intent
          without touching shared vocabulary in the multi-model case.

        The model's own contacts + surfaces always cascade via the
        ``GeologicalModelOrm`` ORM relationships when ``session.delete``
        runs, regardless of formation ownership.

        Parameters
        ----------
        model_id
            Primary key of the model to remove.

        Returns
        -------
        bool
            ``True`` when the model existed and was removed, ``False``
            when no row matched ``model_id``.
        """
        self.debug(f"delete_model entry model_id={model_id}")
        model = await self._session.get(GeologicalModelOrm, model_id)
        if model is None:
            self.warning(f"delete_model: model {model_id} not found — nothing to do")
            return False

        project_id = model.app_project_id

        # Does the project have any OTHER model? Drives the orphan-
        # formation rule below (last model → clean slate; otherwise keep
        # shared vocabulary).
        sibling_model_ids = [
            mid
            for mid in (
                await self._session.execute(
                    select(GeologicalModelOrm.id).where(
                        GeologicalModelOrm.app_project_id == project_id,
                        GeologicalModelOrm.id != model_id,
                    )
                )
            )
            .scalars()
            .all()
        ]
        is_last_model = not sibling_model_ids

        # Formation ids with at least one contact in THIS model.
        fids_here: set[UUID] = set(
            (
                await self._session.execute(
                    select(FormationContactOrm.formation_id)
                    .where(FormationContactOrm.model_id == model_id)
                    .distinct()
                )
            )
            .scalars()
            .all()
        )
        # Formation ids referenced by ANY sibling model.
        fids_elsewhere: set[UUID] = set()
        if sibling_model_ids:
            fids_elsewhere = set(
                (
                    await self._session.execute(
                        select(FormationContactOrm.formation_id)
                        .where(FormationContactOrm.model_id.in_(sibling_model_ids))
                        .distinct()
                    )
                )
                .scalars()
                .all()
            )

        formations = await self.list_formations(project_id)
        deleted = 0
        kept_shared = 0
        kept_vocab = 0
        for formation in formations:
            here = formation.id in fids_here
            elsewhere = formation.id in fids_elsewhere
            if here and not elsewhere:
                # Exclusively this model's — safe to delete.
                await self._session.delete(formation)
                deleted += 1
            elif elsewhere:
                # Used by another model — must survive.
                kept_shared += 1
            elif is_last_model:
                # Unplaced vocabulary, no other model → clean slate.
                await self._session.delete(formation)
                deleted += 1
            else:
                # Unplaced, but other models remain → keep as project
                # vocabulary they may still use.
                kept_vocab += 1

        # Delete the model — ORM cascade drops its contacts + surfaces.
        await self._session.delete(model)
        await self._session.flush()
        self.success(
            f"delete_model ok model_id={model_id} "
            f"formations_deleted={deleted} kept_shared={kept_shared} "
            f"kept_vocab={kept_vocab} is_last_model={is_last_model}"
        )
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

    async def list_contacts_by_ids(self, contact_ids: list[UUID]) -> list[FormationContactOrm]:
        """Load contacts by id in one IN-query.

        Used by the batch-update use case for the all-or-nothing
        scope check. Returns in arbitrary order — the caller indexes
        by ``id`` (not by list position) when matching against the
        request entries.
        """
        if not contact_ids:
            return []
        stmt = select(FormationContactOrm).where(FormationContactOrm.id.in_(contact_ids))
        return list((await self._session.execute(stmt)).scalars().all())

    async def list_surfaces(self, model_id: UUID) -> list[FormationSurfaceOrm]:
        """List every cached TIN surface for the model.

        Used by the section-view consumer to fetch all formations'
        slice-ready geometry in one round trip. Order is arbitrary;
        the renderer indexes by formation_id.
        """
        stmt = select(FormationSurfaceOrm).where(FormationSurfaceOrm.model_id == model_id)
        return list((await self._session.execute(stmt)).scalars().all())

    async def mark_surfaces_stale(
        self,
        pairs: Iterable[tuple[UUID, UUID]],
    ) -> int:
        """Flip ``is_stale=True`` on the listed (model_id, formation_id) surfaces.

        Cheap bulk path used by every contact-mutating use case in the
        on-click build pivot: a contact PATCH that affects formation
        F in model M flips F's surface row to stale rather than
        triggering Delaunay. The user clicks Build to materialise.

        Pairs that don't have a corresponding surface row are silently
        ignored — a formation with no built TIN can't go stale.

        Parameters
        ----------
        pairs : Iterable[tuple[UUID, UUID]]
            ``(model_id, formation_id)`` tuples. Re-anchor mutations
            (a contact moving from formation A to formation B) pass
            both pairs; same-formation edits pass one.

        Returns
        -------
        int
            Number of surface rows actually updated. Useful for logs;
            a return of 0 means the affected formations had no built
            TIN to mark stale (still legal — no-op).
        """
        unique = list({(m, f) for m, f in pairs})
        if not unique:
            return 0
        # Single UPDATE with an IN-list per model_id keeps this O(1)
        # round-trips. For v1 cardinality (≤ 2 pairs per mutation) the
        # complexity is irrelevant; the API is shaped for the future
        # batch-update path that may pass dozens.
        total = 0
        # Group by model_id so the WHERE clause stays cheap.
        by_model: dict[UUID, list[UUID]] = {}
        for model_id, formation_id in unique:
            by_model.setdefault(model_id, []).append(formation_id)
        for model_id, formation_ids in by_model.items():
            result = await self._session.execute(
                update(FormationSurfaceOrm)
                .where(
                    FormationSurfaceOrm.model_id == model_id,
                    FormationSurfaceOrm.formation_id.in_(formation_ids),
                )
                .values(is_stale=True)
            )
            total += result.rowcount or 0
        if total:
            self.debug(f"mark_surfaces_stale: flipped {total} row(s) across {len(unique)} pair(s)")
        return total

    async def mark_all_surfaces_stale(self, model_id: UUID) -> int:
        """Flip ``is_stale=True`` on EVERY cached TIN surface of a model.

        Used when a change reaches the whole model rather than one formation —
        a bed override, say, cuts the ground the TINs clip to everywhere, so
        every surface needs rebuilding. Cheaper and clearer than reading the
        surfaces to build the ``(model, formation)`` pairs ``mark_surfaces_stale``
        expects.

        Parameters
        ----------
        model_id : UUID
            The model whose surfaces are invalidated.

        Returns
        -------
        int
            Rows flipped. ``0`` when the model has no built TIN yet (a legal
            no-op — the user has not clicked Build).
        """
        result = await self._session.execute(
            update(FormationSurfaceOrm)
            .where(FormationSurfaceOrm.model_id == model_id)
            .values(is_stale=True)
        )
        count = result.rowcount or 0
        if count:
            self.debug(f"mark_all_surfaces_stale: flipped {count} row(s) for model={model_id}")
        return count

    async def stale_surfaces_for_investigation(
        self,
        *,
        cpt_id: UUID | None = None,
        borehole_id: UUID | None = None,
    ) -> int:
        """Stale every TIN that has a contact anchored at this investigation.

        Closes debt #34: a contact's absolute z is
        ``investigation.elevation_m - depth_top_m``, so editing an
        investigation's elevation silently invalidates every cached
        surface that has a contact at that anchor — yet the old
        ``PATCH .../elevation`` path never flipped ``is_stale``, so the
        section editor / 3D viewer kept rendering the wrong geometry as
        if it were fresh. This finds the affected ``(model_id,
        formation_id)`` pairs (across ALL models — the URL is
        project-scoped, not model-scoped) and reuses
        :meth:`mark_surfaces_stale`.

        Exactly one of ``cpt_id`` / ``borehole_id`` must be given —
        contacts carry an XOR anchor.

        Parameters
        ----------
        cpt_id : UUID | None
            The edited CPT, when the anchor is a CPT.
        borehole_id : UUID | None
            The edited borehole, when the anchor is a borehole.

        Returns
        -------
        int
            Number of surface rows flipped to stale (0 when the
            investigation has no contacts, or its formations have no
            built TIN yet — both legal no-ops).

        Raises
        ------
        ValueError
            When neither or both anchor ids are supplied (the XOR
            contract is a programming error, not a user input error).
        """
        pairs = await self.contact_scope_for_investigation(cpt_id=cpt_id, borehole_id=borehole_id)
        anchor_val = cpt_id if cpt_id is not None else borehole_id
        if not pairs:
            return 0
        flipped = await self.mark_surfaces_stale(pairs)
        self.debug(
            f"stale_surfaces_for_investigation("
            f"{'cpt' if cpt_id is not None else 'borehole'}={anchor_val}): "
            f"{len(pairs)} (model, formation) pair(s) → {flipped} surface(s) stale"
        )
        return flipped

    async def contact_scope_for_investigation(
        self,
        *,
        cpt_id: UUID | None = None,
        borehole_id: UUID | None = None,
    ) -> list[tuple[UUID, UUID]]:
        """Return the distinct ``(model_id, formation_id)`` pairs anchored here.

        This is the blast radius of an elevation edit: every model that holds a
        contact at this investigation, and which formation the contact belongs
        to. Callers use it to invalidate whatever they cache per model
        (``formation_surface`` TINs) or per (model, formation) pair.

        Runs across ALL models — geological, litho and geotech alike — because
        the URL is project-scoped, not model-scoped, and an accepted litho layer
        mirrors into ``formation_contact`` too.

        Parameters
        ----------
        cpt_id : UUID | None
            The edited CPT, when the anchor is a CPT.
        borehole_id : UUID | None
            The edited borehole, when the anchor is a borehole.

        Returns
        -------
        list[tuple[UUID, UUID]]
            Distinct ``(model_id, formation_id)`` pairs; empty when the
            investigation carries no contacts (a legal no-op).

        Raises
        ------
        ValueError
            When neither or both anchor ids are supplied (the XOR contract is a
            programming error, not a user input error).
        """
        if (cpt_id is None) == (borehole_id is None):
            raise ValueError(
                "contact_scope_for_investigation needs exactly one of "
                "cpt_id / borehole_id (contacts carry an XOR anchor)"
            )
        anchor_col = (
            FormationContactOrm.cpt_id if cpt_id is not None else FormationContactOrm.borehole_id
        )
        anchor_val = cpt_id if cpt_id is not None else borehole_id
        rows = await self._session.execute(
            select(
                FormationContactOrm.model_id,
                FormationContactOrm.formation_id,
            )
            .where(anchor_col == anchor_val)
            .distinct()
        )
        return [(m, f) for m, f in rows.all()]

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
