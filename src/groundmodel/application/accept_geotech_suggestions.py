"""Persist accepted NAD packing sub-units for a geotechnical model (Task C2b).

Geotechnical stage — Slice 1, Task C2b (the ACCEPT half of Task C2; spec
``docs/superpowers/specs/2026-06-23-geotech-stage-slice-1-design.md``).

``AcceptGeotechSuggestions`` is the **write** half of the geotech subdivision
flow.  Task C2a's ``SuggestGeotechSubdivision`` produced ephemeral
:class:`~groundmodel.application.suggest_geotech_subdivision.GeotechGhostSubUnit`
ghosts; this use case takes the subset the user accepted and persists them:

1. For each accepted SEGMENT (an investigation's geo-bounded ``[top, base)``
   range), delete the geotech model's existing ``FormationContact`` rows for that
   investigation whose ``depth_top_m`` falls in the half-open ``[seg_top, seg_base)``
   range.  Capturing the skeleton segment-top contact's ``parent_geo_contact_id``
   provenance BEFORE the delete so it survives the rewrite (idempotency mirrors
   ``BuildGeotechModelFromLitho``).
2. For each accepted sub-unit, top-to-bottom, write ONE geotech contact at the
   sub-unit top:

   * ``nad_class is None`` (borehole carry-through / unclassifiable) → reference
     the SKELETON formation found-or-created by the dual-ref pair
     ``(source_litho_formation_id, source_geo_formation_id)`` with ``nad_class=None``
     (it usually still exists from the C1 build).
   * else → reference the CLASSIFIED formation found-or-created by the FULL TRIPLE
     ``(nad_class, source_litho_formation_id, source_geo_formation_id)`` — DB-backed
     find-or-create so cross-segment + re-accept both dedupe.  Inherits soil
     code / admixtures / colour / name / display_order from the source litho
     formation.

   The FIRST sub-unit's contact takes the segment top depth and carries the
   skeleton contact's ``parent_geo_contact_id``; internal sub-unit tops are fresh
   contacts with ``parent_geo_contact_id=None``.
3. After all writes, delete any SKELETON formation under this project (``nad_class``
   IS NULL, ``source_litho_formation_id`` set) that now has ZERO referencing
   ``FormationContact`` rows (its contacts were all retargeted to classified
   formations).

This use case is deliberately NOT ``AcceptLithoSuggestions``: it fires no
litho-only triggers (no absence recompute, no wedge-tip detection, no admixture
propagation).  Single commit at the end; the caller owns the session.

Constraint recorded elsewhere (not handled here): a later C1 re-build deletes a
section's geotech contacts and would clobber these accepts — that C1↔C2
interaction is a Build-endpoint design concern.  This use case only guarantees
ACCEPT itself is correct + idempotent on re-accept.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.scope_guard import load_scoped_or_raise
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# A skeleton contact top within this margin of the segment top is treated as the
# segment's carried-through top → it inherits the skeleton's parent_geo_contact_id
# provenance.  The depths come from the same arithmetic pipeline (C1 wrote the
# skeleton tops, C2a read them back verbatim), so a tight numeric guard suffices.
_SEGMENT_TOP_EPS_M: float = 1e-4


# ---------------------------------------------------------------------------
# Accept-request DTOs (the input shape)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class AcceptedGeotechSubUnit:
    """One accepted NAD packing sub-unit to persist.

    Mirrors Task C2a's ``GeotechGhostSubUnit`` field-for-field plus an explicit
    ``investigation_id`` so a flat sub-unit list is self-describing.

    Parameters
    ----------
    investigation_id : UUID
        The CPT or borehole this sub-unit is anchored on.
    depth_top_m : float
        Top depth of the sub-unit (metres, positive down).
    depth_base_m : float
        Base depth of the sub-unit (metres, positive down).
    nad_class : int | None
        Accepted NAD packing class 1–31, or ``None`` for a borehole
        carry-through (no qc → unclassifiable).
    source_litho_formation_id : UUID
        The lithostratigraphic formation this geotech sub-unit subdivides.
    source_geo_formation_id : UUID | None
        The geological formation the sub-unit sits within (``None`` for the
        open shallow band above the topmost geological surface).
    """

    investigation_id: UUID
    depth_top_m: float
    depth_base_m: float
    nad_class: int | None
    source_litho_formation_id: UUID
    source_geo_formation_id: UUID | None


@dataclass(frozen=True)
class AcceptGeotechSegment:
    """An accepted geo-bounded skeleton segment with its accepted sub-units.

    The segment ``[segment_top_m, segment_base_m)`` defines the half-open depth
    range whose existing skeleton contacts are replaced; ``sub_units`` are the
    accepted NAD sub-units that re-fill it.

    Parameters
    ----------
    investigation_id : UUID
        The CPT or borehole this segment is anchored on.
    segment_top_m : float
        Top of the geo-bounded skeleton segment (= the original skeleton
        segment-top contact depth).
    segment_base_m : float
        Base of the segment (next skeleton contact top, or investigation total
        depth).  The half-open ``[top, base)`` range excludes the next segment's
        top so a single delete sweep does not clobber a neighbour.
    sub_units : list[AcceptedGeotechSubUnit]
        Accepted sub-units within the segment, ordered top-to-bottom.  May be
        empty (an accepted-nothing segment is a no-op rewrite of that range).
    """

    investigation_id: UUID
    segment_top_m: float
    segment_base_m: float
    sub_units: list[AcceptedGeotechSubUnit] = field(default_factory=list)


@dataclass(frozen=True)
class AcceptGeotechResult:
    """Return value of :meth:`AcceptGeotechSuggestions.execute`.

    Attributes
    ----------
    created_formation_ids : list[UUID]
        Classified geotech ``geological_formation`` rows created in this call.
    created_contact_ids : list[UUID]
        Geotech ``FormationContact`` rows created in this call.
    deleted_skeleton_ids : list[UUID]
        Orphaned skeleton formations deleted in this call.
    """

    created_formation_ids: list[UUID]
    created_contact_ids: list[UUID]
    deleted_skeleton_ids: list[UUID]


class AcceptGeotechSuggestions(GroundModelLogger):
    """Persist accepted NAD packing sub-units (Task C2b).

    The caller owns the session; this use case flushes as it goes and commits
    once at the end.

    Parameters
    ----------
    session : AsyncSession
        Active SQLAlchemy async session.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    async def execute(
        self,
        *,
        project_id: UUID,
        geotech_model_id: UUID,
        section_id: UUID,
        segments: list[AcceptGeotechSegment],
    ) -> AcceptGeotechResult:
        """Persist the accepted sub-units for a geotech model's segments.

        Parameters
        ----------
        project_id : UUID
            Project scope guard — the geotech model must belong to this project.
        geotech_model_id : UUID
            The ``kind='geotechnical'`` model the accepted contacts belong to.
        section_id : UUID
            The cross-section the suggestion was produced for (carried for
            symmetry with the suggest path + logging; the accept itself is
            keyed on the explicit per-segment ``[top, base)`` ranges).
        segments : list[AcceptGeotechSegment]
            The accepted segments + their accepted sub-units.

        Returns
        -------
        AcceptGeotechResult
            Created formation ids, created contact ids, deleted skeleton ids.

        Raises
        ------
        ValueError
            When the geotech model is missing / not scoped to the project.

        Notes
        -----
        Re-calling with the same arguments is safe: each segment's existing
        contacts in ``[seg_top, seg_base)`` are deleted before the rewrite, and
        formation find-or-create is DB-backed so no duplicate rows accumulate.
        """
        self.info(
            f"AcceptGeotechSuggestions: geotech_model={geotech_model_id} "
            f"section={section_id} {len(segments)} accepted segment(s)"
        )

        geotech_model = await load_scoped_or_raise(
            self._session,
            GeologicalModelOrm,
            geotech_model_id,
            project_id,
            label="Geotech model",
        )

        if not segments:
            await self._session.commit()
            self.warning("AcceptGeotechSuggestions: no accepted segments — nothing written")
            return AcceptGeotechResult(
                created_formation_ids=[], created_contact_ids=[], deleted_skeleton_ids=[]
            )

        # In-memory find-or-create caches for this call.  Classified formations
        # key on the full triple; skeleton (carry-through) formations key on the
        # dual-ref pair.  Both fall back to a DB query on a cache miss so a
        # re-accept reuses existing rows.
        classified_by_key: dict[tuple[int, UUID, UUID | None], GeologicalFormationOrm] = {}
        skeleton_by_key: dict[tuple[UUID, UUID | None], GeologicalFormationOrm] = {}
        created_formation_ids: list[UUID] = []
        created_contact_ids: list[UUID] = []

        for seg in segments:
            anchor = await self._anchor_kwargs(seg.investigation_id)
            if not anchor:
                self.warning(
                    f"AcceptGeotechSuggestions: investigation {seg.investigation_id} "
                    "not found as borehole or CPT — skipping its accepted segment"
                )
                continue

            # Capture the skeleton segment-top contact's provenance BEFORE the
            # delete, so the rewritten segment-top contact inherits it.
            segment_top_provenance = await self._capture_segment_top_provenance(
                geotech_model.id, anchor, seg.segment_top_m
            )

            # Idempotency: delete this investigation's existing geotech contacts in
            # the half-open [seg_top, seg_base) range before rewriting them.
            await self._delete_segment_contacts(
                geotech_model.id, anchor, seg.segment_top_m, seg.segment_base_m
            )

            sub_units = sorted(seg.sub_units, key=lambda s: s.depth_top_m)
            for idx, sub in enumerate(sub_units):
                formation = await self._find_or_create_formation(
                    project_id=project_id,
                    classified_by_key=classified_by_key,
                    skeleton_by_key=skeleton_by_key,
                    created_formation_ids=created_formation_ids,
                    sub=sub,
                )
                # The first sub-unit re-takes the segment top + the skeleton's
                # geo-division provenance; internal sub-unit tops are fresh cuts.
                is_segment_top = idx == 0
                parent_geo = segment_top_provenance if is_segment_top else None
                contact = FormationContactOrm(
                    id=uuid7(),
                    model_id=geotech_model.id,
                    formation_id=formation.id,
                    depth_top_m=sub.depth_top_m,
                    # Derived geotech structure (a NAD-band split of a litho
                    # segment) — 'interpolated' is the valid derived-geometry
                    # source token, matching the C1 skeleton contacts.
                    source="interpolated",
                    confidence="medium",
                    parent_geo_contact_id=parent_geo,
                    **anchor,
                )
                self._session.add(contact)
                created_contact_ids.append(contact.id)

        await self._session.flush()

        # Orphan cleanup: skeleton formations whose contacts were all retargeted.
        deleted_skeleton_ids = await self._delete_orphan_skeletons(project_id)

        await self._session.commit()
        self.success(
            f"AcceptGeotechSuggestions: geotech_model={geotech_model.id} "
            f"{len(created_formation_ids)} classified formation(s), "
            f"{len(created_contact_ids)} contact(s), "
            f"{len(deleted_skeleton_ids)} orphan skeleton(s) deleted"
        )
        return AcceptGeotechResult(
            created_formation_ids=created_formation_ids,
            created_contact_ids=created_contact_ids,
            deleted_skeleton_ids=deleted_skeleton_ids,
        )

    # ------------------------------------------------------------------
    # Segment-top provenance + idempotent delete
    # ------------------------------------------------------------------

    async def _capture_segment_top_provenance(
        self, model_id: UUID, anchor: dict[str, UUID], segment_top_m: float
    ) -> UUID | None:
        """Read the skeleton segment-top contact's ``parent_geo_contact_id``.

        Captured BEFORE the segment delete so the rewritten segment-top contact
        can inherit the geo-division provenance the skeleton carried.  ``None``
        when no skeleton contact sits at the segment top (carried-through litho
        top with no geo cut) or none survives within the numeric tolerance.

        Parameters
        ----------
        model_id : UUID
            The geotech model id.
        anchor : dict[str, UUID]
            The contact's XOR anchor kwargs (``borehole_id`` or ``cpt_id``).
        segment_top_m : float
            The segment top depth to match.

        Returns
        -------
        UUID | None
            The skeleton contact's ``parent_geo_contact_id``, or ``None``.
        """
        anchor_col = self._anchor_column(anchor)
        anchor_id = next(iter(anchor.values()))
        row = (
            await self._session.execute(
                select(FormationContactOrm.parent_geo_contact_id).where(
                    FormationContactOrm.model_id == model_id,
                    anchor_col == anchor_id,
                    FormationContactOrm.depth_top_m >= segment_top_m - _SEGMENT_TOP_EPS_M,
                    FormationContactOrm.depth_top_m <= segment_top_m + _SEGMENT_TOP_EPS_M,
                )
            )
        ).first()
        return row[0] if row is not None else None

    async def _delete_segment_contacts(
        self, model_id: UUID, anchor: dict[str, UUID], seg_top_m: float, seg_base_m: float
    ) -> None:
        """Delete this investigation's geotech contacts in ``[seg_top, seg_base)``.

        Half-open range, with a ``_SEGMENT_TOP_EPS_M`` float guard on each bound:
        the predicate is ``seg_top - eps <= depth_top_m < seg_base - eps``. The
        ``- eps`` on the upper bound excludes the next segment's top at
        ``seg_base`` (so a per-segment sweep never clobbers the neighbouring
        segment's top contact); the ``- eps`` on the lower bound keeps the
        segment's own top contact within range despite float drift.

        Parameters
        ----------
        model_id : UUID
            The geotech model id.
        anchor : dict[str, UUID]
            The contact's XOR anchor kwargs.
        seg_top_m : float
            Inclusive lower bound (the segment top).
        seg_base_m : float
            Exclusive upper bound (the next segment top / total depth).
        """
        anchor_col = self._anchor_column(anchor)
        anchor_id = next(iter(anchor.values()))
        await self._session.execute(
            delete(FormationContactOrm).where(
                FormationContactOrm.model_id == model_id,
                anchor_col == anchor_id,
                FormationContactOrm.depth_top_m >= seg_top_m - _SEGMENT_TOP_EPS_M,
                FormationContactOrm.depth_top_m < seg_base_m - _SEGMENT_TOP_EPS_M,
            )
        )

    @staticmethod
    def _anchor_column(anchor: dict[str, UUID]):  # type: ignore[no-untyped-def]
        """Return the ORM column matching the anchor kwargs (``borehole`` or ``cpt``)."""
        if "borehole_id" in anchor:
            return FormationContactOrm.borehole_id
        return FormationContactOrm.cpt_id

    # ------------------------------------------------------------------
    # Formation find-or-create
    # ------------------------------------------------------------------

    async def _find_or_create_formation(
        self,
        *,
        project_id: UUID,
        classified_by_key: dict[tuple[int, UUID, UUID | None], GeologicalFormationOrm],
        skeleton_by_key: dict[tuple[UUID, UUID | None], GeologicalFormationOrm],
        created_formation_ids: list[UUID],
        sub: AcceptedGeotechSubUnit,
    ) -> GeologicalFormationOrm:
        """Find-or-create the formation a sub-unit's contact references.

        ``nad_class is None`` → the skeleton formation by the dual-ref pair
        ``(source_litho, source_geo)``; else the classified formation by the full
        triple ``(nad_class, source_litho, source_geo)``.  Both branches query the
        DB on a cache miss so cross-segment sharing + re-accept dedupe.

        Parameters
        ----------
        project_id : UUID
            Owning project.
        classified_by_key : dict
            In-memory cache for classified formations (mutated).
        skeleton_by_key : dict
            In-memory cache for skeleton (carry-through) formations (mutated).
        created_formation_ids : list[UUID]
            Accumulator of classified ids created in this call (mutated).
        sub : AcceptedGeotechSubUnit
            The accepted sub-unit.

        Returns
        -------
        GeologicalFormationOrm
            The found-or-created formation row.
        """
        if sub.nad_class is None:
            return await self._find_or_create_skeleton(
                project_id=project_id,
                skeleton_by_key=skeleton_by_key,
                source_litho_formation_id=sub.source_litho_formation_id,
                source_geo_formation_id=sub.source_geo_formation_id,
            )
        return await self._find_or_create_classified(
            project_id=project_id,
            classified_by_key=classified_by_key,
            created_formation_ids=created_formation_ids,
            nad_class=sub.nad_class,
            source_litho_formation_id=sub.source_litho_formation_id,
            source_geo_formation_id=sub.source_geo_formation_id,
        )

    async def _find_or_create_classified(
        self,
        *,
        project_id: UUID,
        classified_by_key: dict[tuple[int, UUID, UUID | None], GeologicalFormationOrm],
        created_formation_ids: list[UUID],
        nad_class: int,
        source_litho_formation_id: UUID,
        source_geo_formation_id: UUID | None,
    ) -> GeologicalFormationOrm:
        """Find-or-create a CLASSIFIED geotech formation by the full triple.

        Inherits soil code / admixtures / colour / name / display_order from the
        source litho formation.

        Parameters
        ----------
        project_id : UUID
            Owning project.
        classified_by_key : dict
            In-memory find-or-create cache (mutated).
        created_formation_ids : list[UUID]
            Accumulator of created ids (mutated).
        nad_class : int
            The accepted NAD packing class.
        source_litho_formation_id : UUID
            The litho formation this geotech unit subdivides.
        source_geo_formation_id : UUID | None
            The geological formation the unit sits within (``None`` for the open
            shallow band).

        Returns
        -------
        GeologicalFormationOrm
            The found-or-created classified formation row.
        """
        key = (nad_class, source_litho_formation_id, source_geo_formation_id)
        cached = classified_by_key.get(key)
        if cached is not None:
            return cached

        # `.is_(None)` is required for the NULL geo case — `== None` produces the
        # wrong SQL predicate (Python None-comparison).
        geo_filter = (
            GeologicalFormationOrm.source_geo_formation_id.is_(None)
            if source_geo_formation_id is None
            else GeologicalFormationOrm.source_geo_formation_id == source_geo_formation_id
        )
        db_row = (
            (
                await self._session.execute(
                    select(GeologicalFormationOrm).where(
                        GeologicalFormationOrm.app_project_id == project_id,
                        GeologicalFormationOrm.nad_class == nad_class,
                        GeologicalFormationOrm.source_litho_formation_id
                        == source_litho_formation_id,
                        geo_filter,
                    )
                )
            )
            .scalars()
            .first()
        )
        if db_row is not None:
            classified_by_key[key] = db_row
            self.debug(
                f"_find_or_create_classified: reused {db_row.id} "
                f"nad={nad_class} litho={source_litho_formation_id} geo={source_geo_formation_id}"
            )
            return db_row

        source_litho = await self._session.get(GeologicalFormationOrm, source_litho_formation_id)
        soil_code = source_litho.litho_main_soil_code if source_litho is not None else None
        admixtures = source_litho.litho_admixtures if source_litho is not None else None
        color = source_litho.color if source_litho is not None else "#bbbbbb"
        base_name = source_litho.name if source_litho is not None else "geotech unit"
        display_order = source_litho.display_order if source_litho is not None else 0

        formation = GeologicalFormationOrm(
            id=uuid7(),
            app_project_id=project_id,
            name=f"{base_name} (NAD {nad_class})",
            color=color,
            display_order=display_order,
            nad_class=nad_class,
            litho_main_soil_code=soil_code,
            litho_admixtures=admixtures,
            source_litho_formation_id=source_litho_formation_id,
            source_geo_formation_id=source_geo_formation_id,
        )
        self._session.add(formation)
        await self._session.flush()
        classified_by_key[key] = formation
        created_formation_ids.append(formation.id)
        self.debug(
            f"_find_or_create_classified: created {formation.id} nad={nad_class} "
            f"litho={source_litho_formation_id} geo={source_geo_formation_id} soil={soil_code}"
        )
        return formation

    async def _find_or_create_skeleton(
        self,
        *,
        project_id: UUID,
        skeleton_by_key: dict[tuple[UUID, UUID | None], GeologicalFormationOrm],
        source_litho_formation_id: UUID,
        source_geo_formation_id: UUID | None,
    ) -> GeologicalFormationOrm:
        """Find-or-create a SKELETON (``nad_class=None``) formation for a carry-through.

        Used by borehole / unclassifiable sub-units that cannot be NAD-classified.
        Keyed on the dual-ref pair ``(source_litho, source_geo)`` so it reuses the
        C1-built skeleton row when it still exists.

        Parameters
        ----------
        project_id : UUID
            Owning project.
        skeleton_by_key : dict
            In-memory find-or-create cache (mutated).
        source_litho_formation_id : UUID
            The litho formation this geotech unit subdivides.
        source_geo_formation_id : UUID | None
            The geological formation the unit sits within.

        Returns
        -------
        GeologicalFormationOrm
            The found-or-created skeleton formation row.
        """
        key = (source_litho_formation_id, source_geo_formation_id)
        cached = skeleton_by_key.get(key)
        if cached is not None:
            return cached

        geo_filter = (
            GeologicalFormationOrm.source_geo_formation_id.is_(None)
            if source_geo_formation_id is None
            else GeologicalFormationOrm.source_geo_formation_id == source_geo_formation_id
        )
        db_row = (
            (
                await self._session.execute(
                    select(GeologicalFormationOrm).where(
                        GeologicalFormationOrm.app_project_id == project_id,
                        GeologicalFormationOrm.nad_class.is_(None),
                        GeologicalFormationOrm.source_litho_formation_id
                        == source_litho_formation_id,
                        geo_filter,
                    )
                )
            )
            .scalars()
            .first()
        )
        if db_row is not None:
            skeleton_by_key[key] = db_row
            return db_row

        # No skeleton survived (e.g. it was orphan-cleaned on a prior accept) —
        # recreate it so the carry-through has a formation to reference.
        source_litho = await self._session.get(GeologicalFormationOrm, source_litho_formation_id)
        soil_code = source_litho.litho_main_soil_code if source_litho is not None else None
        admixtures = source_litho.litho_admixtures if source_litho is not None else None
        color = source_litho.color if source_litho is not None else "#bbbbbb"
        name = f"{source_litho.name} (geotech)" if source_litho is not None else "geotech unit"
        display_order = source_litho.display_order if source_litho is not None else 0

        formation = GeologicalFormationOrm(
            id=uuid7(),
            app_project_id=project_id,
            name=name,
            color=color,
            display_order=display_order,
            nad_class=None,
            litho_main_soil_code=soil_code,
            litho_admixtures=admixtures,
            source_litho_formation_id=source_litho_formation_id,
            source_geo_formation_id=source_geo_formation_id,
        )
        self._session.add(formation)
        await self._session.flush()
        skeleton_by_key[key] = formation
        return formation

    # ------------------------------------------------------------------
    # Orphan cleanup
    # ------------------------------------------------------------------

    async def _delete_orphan_skeletons(self, project_id: UUID) -> list[UUID]:
        """Delete project skeleton formations now referenced by zero contacts.

        A skeleton (``nad_class`` IS NULL, ``source_litho_formation_id`` set) whose
        contacts were all retargeted to classified formations carries zero
        ``FormationContact`` rows and can be removed.  A skeleton still referenced
        by ANY contact (e.g. another section's carry-through) is preserved — the
        NOT-EXISTS sub-query is project-wide, not section-scoped, so a row shared
        across sections survives.

        Parameters
        ----------
        project_id : UUID
            Owning project to scope the cleanup to.

        Returns
        -------
        list[UUID]
            The skeleton formation ids deleted.
        """
        skeleton_ids = (
            (
                await self._session.execute(
                    select(GeologicalFormationOrm.id).where(
                        GeologicalFormationOrm.app_project_id == project_id,
                        GeologicalFormationOrm.nad_class.is_(None),
                        GeologicalFormationOrm.source_litho_formation_id.is_not(None),
                    )
                )
            )
            .scalars()
            .all()
        )
        deleted: list[UUID] = []
        for skel_id in skeleton_ids:
            ref_count = (
                await self._session.execute(
                    select(func.count()).where(FormationContactOrm.formation_id == skel_id)
                )
            ).scalar_one()
            if ref_count == 0:
                await self._session.execute(
                    delete(GeologicalFormationOrm).where(GeologicalFormationOrm.id == skel_id)
                )
                deleted.append(skel_id)
        if deleted:
            self.debug(
                f"_delete_orphan_skeletons: deleted {len(deleted)} orphaned skeleton "
                f"formation(s) under project {project_id}"
            )
        return deleted

    # ------------------------------------------------------------------
    # Anchor resolution
    # ------------------------------------------------------------------

    async def _anchor_kwargs(self, investigation_id: UUID) -> dict[str, UUID]:
        """Resolve an investigation id to its contact XOR anchor kwargs.

        Mirrors ``BuildGeotechModelFromLitho._resolve_anchor_kinds`` /
        ``_anchor_kwargs`` but for a single id: one ``SELECT id`` per table tells
        whether the investigation is a borehole or a CPT, returning the matching
        anchor column kwarg.  An id present in neither table returns an empty dict
        (the caller skips its segment — a contact needs exactly one anchor).

        Parameters
        ----------
        investigation_id : UUID
            The accepted segment's investigation id.

        Returns
        -------
        dict[str, UUID]
            ``{"borehole_id": uuid}`` or ``{"cpt_id": uuid}``; empty when neither.
        """
        bh = (
            await self._session.execute(
                select(BoreholeOrm.id).where(BoreholeOrm.id == investigation_id)
            )
        ).first()
        if bh is not None:
            return {"borehole_id": investigation_id}
        cpt = (
            await self._session.execute(select(CptOrm.id).where(CptOrm.id == investigation_id))
        ).first()
        if cpt is not None:
            return {"cpt_id": investigation_id}
        return {}
