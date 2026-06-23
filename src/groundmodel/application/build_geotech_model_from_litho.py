"""Build the geotechnical model's geo-bounded structural skeleton from litho.

Geotechnical stage — Slice 1, Task C1 (spec
``docs/superpowers/specs/2026-06-23-geotech-stage-slice-1-design.md`` §4 Step A).

``BuildGeotechModelFromLitho`` is the **build** half of the geotech stage: given a
lithostratigraphic model + a cross-section, it ensures the ``kind='geotechnical'``
sibling model exists and lays down its STRUCTURAL skeleton — every section-scoped
litho column divided at the geological boundaries (geology = hard bound), persisted
as geotech ``FormationContact`` rows.  The NAD packing classification + the
subdivision into sub-units happens LATER (Task C2 suggest / accept); this use case
only writes the geo-bounded structure with ``nad_class=None`` skeleton formations.

What it persists (one transaction, single commit at the end)
------------------------------------------------------------
1. **The geotech model** — find-or-create a ``geological_model`` row with
   ``kind='geotechnical'`` whose parent is the litho model.  Reuses the existing
   ``GeologyRepository.create_model`` + ``REQUIRED_PARENT_KIND`` invariant; an
   already-existing geotech child is reused.
2. **Skeleton geotech formations** — one ``geological_formation`` row per distinct
   ``(source_litho_formation_id, source_geo_formation_id)`` pair encountered, with
   ``nad_class=None``, the inherited ``litho_main_soil_code`` + ``litho_admixtures``
   from the source litho formation, and both dual-ref FKs set (the columns added in
   migration ``c120996a504d``).  These satisfy the NOT-NULL ``formation_id`` FK on
   the contacts; ``nad_class=None`` is a valid transient state (Task C2's accept
   find-or-creates the real ``(nad_class, …)`` formation and retargets the
   contacts).  Find-or-create is DB-backed (queries before inserting) so skeletons
   are shared across sections and survive a re-build without duplication.
3. **Geotech ``FormationContact`` rows** at each segment top per investigation: the
   carried-through litho contact tops AND the geo-division cuts.  A contact created
   at a geo-division boundary carries ``parent_geo_contact_id`` pointing at the
   geological contact that forced the cut (provenance, set at BUILD).

Idempotency on re-build
-----------------------
Calling ``execute`` a second time on the same ``(litho_model_id, section_id)`` is
safe.  Before writing new contacts (Phase 5) the use case deletes the geotech
model's existing ``FormationContact`` rows for the in-corridor investigations
(scoped to the section's corridor, so other sections' contacts are untouched).
Skeleton formations are DB-backed find-or-create: a re-build reuses the existing
rows instead of inserting duplicates.  Skeleton rows that become wholly unreferenced
after a re-build are **not** garbage-collected here — that is acceptable because
Task C2 accept manages the skeleton lifecycle and the orphaned rows carry no
user-visible state.

The geo-bounding geometry
-------------------------
The snap-or-divide decision reuses the PURE
:mod:`groundmodel.domain.services.litho_geo_bounding` transforms
(``mark_and_truncate_shallow_tests`` then ``divide_picks_by_geology``) over the
section-scoped ``BodyLayerPick`` list.  The boundary samplers are built from the
parent geological model's cached ``formation_surface`` TINs — but, unlike
``load_geo_surfaces`` (which drops the geo ``formation_id``), this use case keeps
the per-surface ``formation_id`` so each cut can be attributed to its geological
formation (for ``source_geo_formation_id``) and matched to a geological contact row
(for ``parent_geo_contact_id``).
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.project_investigations_onto_section import (
    project_investigations_onto_section,
)
from groundmodel.application.resolve_litho_instances_use_case import ResolveLithoInstances
from groundmodel.application.scope_guard import load_scoped_or_raise
from groundmodel.domain.services.litho_body_pick import BodyLayerPick
from groundmodel.domain.services.litho_geo_bounding import (
    BoundarySampler,
    divide_picks_by_geology,
    mark_and_truncate_shallow_tests,
)
from groundmodel.domain.services.tin_surface import evaluate_tin_at
from groundmodel.domain.value_objects.tin_surface import TinSurface
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.repositories.geology_repository import GeologyRepository
from groundmodel.infrastructure.db.repositories.litho_layer_repository import LithoLayerRepository
from groundmodel.infrastructure.db.repositories.project_repository import ProjectRepository
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# Project view-state default for the litho↔geology snap tolerance (metres) — the
# distance within which a litho contact is treated as coincident with a geological
# surface (snap, no cut).  Mirrors ``BuildVoxelLithoModel._read_litho_snap_tolerance_m``
# and the section editor's ``view_state.litho_segmenter.litho_snap_tolerance_m`` default.
_DEFAULT_LITHO_SNAP_TOLERANCE_M: float = 0.20

# A geotech-skeleton contact whose top depth is within this margin of an original
# litho-layer top is treated as that carried-through contact, NOT a geo-division
# cut — so it does not get matched a ``parent_geo_contact_id``.  The boundary depths
# come from the same arithmetic pipeline, so a tight numeric guard suffices.
_ORIGINAL_TOP_EPS_M: float = 1e-4


@dataclass
class _GeoSurface:
    """A parent-geology band surface kept WITH its geological formation id.

    ``load_geo_surfaces`` drops the formation id; this use case needs it so a
    cut can be attributed to its geological formation and matched to a geological
    contact row for provenance.

    Attributes
    ----------
    formation_id : UUID
        The geological formation whose top this surface is.
    tin : TinSurface
        The cached interpolated surface mesh.
    """

    formation_id: UUID
    tin: TinSurface


@dataclass(frozen=True)
class BuildGeotechResult:
    """Return value of :meth:`BuildGeotechModelFromLitho.execute`.

    Attributes
    ----------
    geotech_model_id : UUID
        The geotechnical model created or reused.
    created_model : bool
        ``True`` when the geotech model was created in this call, ``False`` when
        an existing one was reused.
    created_formation_ids : list[UUID]
        Skeleton geotech ``geological_formation`` rows created in this call.
    created_contact_ids : list[UUID]
        Geotech ``FormationContact`` rows created in this call.
    divided_contact_count : int
        Count of geo-division cuts (segments whose top is a geological-boundary
        cut, not a carried-through litho top).  Note a cut may still carry a
        null ``parent_geo_contact_id`` when no geological contact was within
        tolerance — ``divided_contact_count`` counts cuts, not matched
        provenance links.
    """

    geotech_model_id: UUID
    created_model: bool
    created_formation_ids: list[UUID]
    created_contact_ids: list[UUID]
    divided_contact_count: int


class BuildGeotechModelFromLitho(GroundModelLogger):
    """Build the geotech model's geo-bounded structural skeleton (Task C1).

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
        self._repo = GeologyRepository(session)
        self._litho_repo = LithoLayerRepository(session)

    async def execute(
        self,
        *,
        project_id: UUID,
        litho_model_id: UUID,
        section_id: UUID,
    ) -> BuildGeotechResult:
        """Build the geo-bounded geotech skeleton for one section corridor.

        Parameters
        ----------
        project_id : UUID
            Project scope guard — the litho model + section must both belong to
            this project.
        litho_model_id : UUID
            The lithostratigraphic model to subdivide.  Must be
            ``kind='lithostratigraphic'`` (the router validates this).
        section_id : UUID
            The cross-section whose in-corridor investigations are subdivided.

        Returns
        -------
        BuildGeotechResult
            The geotech model id + per-phase counts.

        Raises
        ------
        ValueError
            When the litho model is missing / out of project, or the section is
            not in the project.

        Notes
        -----
        Re-calling with the same arguments is safe.  Before writing new contacts
        the method deletes existing geotech contacts for the in-corridor
        investigations (section-scoped delete — other sections' contacts are
        untouched).  Skeleton formations are reused from the DB when they already
        exist, so a second build produces no duplicate rows.
        """
        self.info(f"BuildGeotechModelFromLitho: litho_model={litho_model_id} section={section_id}")

        litho_model = await load_scoped_or_raise(
            self._session, GeologicalModelOrm, litho_model_id, project_id, label="Litho model"
        )

        # Phase 1 — ensure the geotech sibling model exists.
        geotech_model, created_model = await self._ensure_geotech_model(litho_model)

        # Phase 2 — resolve body_id (load_body_picks filters on it) then load the
        # section-scoped picks.  ResolveLithoInstances runs commit=False so the
        # body stamp + the contact writes share one transaction.
        await ResolveLithoInstances(self._session).execute(model_id=litho_model_id, commit=False)

        in_corridor = await project_investigations_onto_section(
            self._session, project_id=project_id, section_id=section_id
        )
        picks = await self._litho_repo.load_body_picks(
            litho_model_id, restrict_to_investigation_ids=set(in_corridor.keys())
        )
        self.info(
            f"BuildGeotechModelFromLitho: {len(picks)} section-scoped pick(s) "
            f"over {len(in_corridor)} in-corridor investigation(s)"
        )
        if not picks:
            await self._session.commit()
            self.warning(
                "BuildGeotechModelFromLitho: no in-corridor picks — geotech model "
                "created/reused but no skeleton written"
            )
            return BuildGeotechResult(
                geotech_model_id=geotech_model.id,
                created_model=created_model,
                created_formation_ids=[],
                created_contact_ids=[],
                divided_contact_count=0,
            )

        # Phase 2b — delete this section's existing geotech contacts for the
        # in-corridor investigations before re-writing them.  This makes contact
        # creation idempotent: a second build replaces, not duplicates, the prior
        # skeleton contacts.  The delete is scoped to the section's in-corridor
        # investigations so contacts for OTHER sections are untouched.
        #
        # in_corridor is guaranteed non-empty here: if picks is non-empty (we
        # returned early above when it wasn't), then load_body_picks found rows
        # restricted to in_corridor.keys(), so in_corridor must have entries.
        corridor_ids = list(in_corridor.keys())
        await self._session.execute(
            delete(FormationContactOrm).where(
                FormationContactOrm.model_id == geotech_model.id,
                FormationContactOrm.borehole_id.in_(corridor_ids)
                | FormationContactOrm.cpt_id.in_(corridor_ids),
            )
        )
        self.debug(
            f"BuildGeotechModelFromLitho: deleted prior geotech contacts for "
            f"{len(corridor_ids)} in-corridor investigation(s) on re-build"
        )

        # Phase 3 — geo-bounding geometry.  Build the per-formation surfaces, the
        # boundary samplers, and run the pure transforms (geology = hard bound).
        snap_tol = await self._read_litho_snap_tolerance_m(litho_model_id)
        geo_surfaces = await self._load_geo_surfaces_with_formation(
            litho_model.parent_geological_model_id
        )

        # Remember each investigation's ORIGINAL litho-layer tops so a divided
        # segment top can be told apart from a carried-through litho contact.
        original_tops: dict[str, set[float]] = defaultdict(set)
        for p in picks:
            original_tops[p.investigation_id].add(p.top_depth_m)

        boundary_sampler = self._make_boundary_sampler(geo_surfaces)
        lowest_sampler = self._make_lowest_boundary_sampler(geo_surfaces)

        shallow = mark_and_truncate_shallow_tests(picks, lowest_sampler)
        if shallow.marked_investigation_ids:
            self.debug(
                "BuildGeotechModelFromLitho: marked shallow test(s): "
                f"{shallow.marked_investigation_ids}"
            )
        divided = divide_picks_by_geology(shallow.picks, boundary_sampler, snap_tol)
        self.info(
            f"BuildGeotechModelFromLitho: {len(picks)} pick(s) → {len(divided)} "
            f"geo-bounded segment(s) (snap_tol={snap_tol} m)"
        )

        # Phase 4 — load the parent-geology contacts per investigation for the
        # provenance match (parent_geo_contact_id).
        geo_contacts_by_inv = await self._load_geo_contacts_by_investigation(
            litho_model.parent_geological_model_id, set(in_corridor.keys())
        )

        # Phase 5 — persist skeleton formations + geotech contacts.
        litho_formation_by_id = await self._load_litho_formations(picks)
        skeleton_by_key: dict[tuple[UUID, UUID | None], GeologicalFormationOrm] = {}
        created_formation_ids: list[UUID] = []
        created_contact_ids: list[UUID] = []
        divided_count = 0

        # Group divided segments by investigation so each contact carries the
        # right anchor + the geo-contact lookup is per column.
        segs_by_inv: dict[str, list[BodyLayerPick]] = defaultdict(list)
        for seg in divided:
            segs_by_inv[seg.investigation_id].append(seg)

        # A pick's investigation_id is a borehole OR CPT id (string); resolve
        # which, so the geotech FormationContact gets the right XOR anchor column.
        anchor_kind = await self._resolve_anchor_kinds({UUID(inv_id) for inv_id in segs_by_inv})

        for inv_id, segs in segs_by_inv.items():
            anchor = self._anchor_kwargs(inv_id, anchor_kind)
            if not anchor:
                # Investigation vanished between pick load and here — a contact
                # needs exactly one anchor (XOR CHECK), so skip its segments.
                self.warning(
                    f"BuildGeotechModelFromLitho: investigation {inv_id} not found "
                    "as borehole or CPT — skipping its geotech contacts"
                )
                continue
            for seg in segs:
                source_geo_fid = self._geo_formation_at_midpoint(seg, geo_surfaces)
                source_litho_fid = UUID(seg.formation_id)

                skeleton = await self._find_or_create_skeleton_formation(
                    project_id=project_id,
                    skeleton_by_key=skeleton_by_key,
                    created_formation_ids=created_formation_ids,
                    source_litho_formation_id=source_litho_fid,
                    source_geo_formation_id=source_geo_fid,
                    litho_formation_by_id=litho_formation_by_id,
                )

                # A segment top that is NOT one of the investigation's original
                # litho-layer tops is a geo-division cut → attach provenance.
                is_cut = not self._is_original_top(seg, original_tops[inv_id])
                parent_geo_contact_id: UUID | None = None
                if is_cut and source_geo_fid is not None:
                    parent_geo_contact_id = self._match_geo_contact(
                        seg.top_depth_m,
                        source_geo_fid,
                        geo_contacts_by_inv.get(inv_id, []),
                        snap_tol,
                    )
                    divided_count += 1

                contact = FormationContactOrm(
                    id=uuid7(),
                    model_id=geotech_model.id,
                    formation_id=skeleton.id,
                    depth_top_m=seg.top_depth_m,
                    # The geotech skeleton is DERIVED structure (litho boundary
                    # carried through, or a geological-surface cut) — not a
                    # measured contact.  'interpolated' is the existing
                    # FormationContact source token for derived geometry
                    # (ck_formation_contact_source_valid); a dedicated
                    # 'geotech_geo_bounding' token would need a CHECK migration,
                    # out of C1 scope.
                    source="interpolated",
                    confidence="medium",
                    parent_geo_contact_id=parent_geo_contact_id,
                    **anchor,
                )
                self._session.add(contact)
                created_contact_ids.append(contact.id)

        await self._session.flush()
        await self._session.commit()
        self.success(
            f"BuildGeotechModelFromLitho: geotech_model={geotech_model.id} "
            f"created_model={created_model} "
            f"{len(created_formation_ids)} skeleton formation(s), "
            f"{len(created_contact_ids)} contact(s) ({divided_count} geo-division cut(s))"
        )
        return BuildGeotechResult(
            geotech_model_id=geotech_model.id,
            created_model=created_model,
            created_formation_ids=created_formation_ids,
            created_contact_ids=created_contact_ids,
            divided_contact_count=divided_count,
        )

    # ------------------------------------------------------------------
    # Phase 1 — geotech model ensure-or-create
    # ------------------------------------------------------------------

    async def _ensure_geotech_model(
        self, litho_model: GeologicalModelOrm
    ) -> tuple[GeologicalModelOrm, bool]:
        """Find the geotech child of *litho_model* or create one.

        The geotech model is the single ``kind='geotechnical'`` model whose parent
        is the litho model.  When one already exists it is reused (idempotent
        re-build); otherwise a new one is created via the repository, satisfying
        the ``REQUIRED_PARENT_KIND['geotechnical'] == 'lithostratigraphic'``
        invariant the ``POST /models`` endpoint normally enforces.

        Parameters
        ----------
        litho_model : GeologicalModelOrm
            The lithostratigraphic parent model.

        Returns
        -------
        tuple[GeologicalModelOrm, bool]
            ``(geotech_model, created)`` — ``created`` is ``True`` when a new row
            was inserted.
        """
        existing = (
            (
                await self._session.execute(
                    select(GeologicalModelOrm).where(
                        GeologicalModelOrm.parent_geological_model_id == litho_model.id,
                        GeologicalModelOrm.kind == "geotechnical",
                    )
                )
            )
            .scalars()
            .first()
        )
        if existing is not None:
            self.debug(f"_ensure_geotech_model: reusing existing geotech model {existing.id}")
            return existing, False

        model = await self._repo.create_model(
            litho_model.app_project_id,
            name=f"{litho_model.name} — geotechnical",
            is_active=True,
            kind="geotechnical",
            parent_geological_model_id=litho_model.id,
        )
        self.info(f"_ensure_geotech_model: created geotech model {model.id}")
        return model, True

    # ------------------------------------------------------------------
    # Phase 3 — geo surfaces + boundary samplers
    # ------------------------------------------------------------------

    async def _load_geo_surfaces_with_formation(
        self, parent_geo_model_id: UUID | None
    ) -> list[_GeoSurface]:
        """Load the parent geo model's built, non-stale surfaces WITH formation id.

        Unlike ``load_geo_surfaces`` (which returns ``SurfaceBound`` and drops the
        geological ``formation_id``), this keeps the formation id so a cut can be
        attributed to its geological formation.  Stale, vertex-less, or
        triangle-less surfaces are skipped — a surface with vertices but no
        triangles (e.g. a 2-contact formation) would produce a ``TinSurface``
        whose ``evaluate_tin_at`` always returns ``None``, silently degrading
        every evaluation to the nearest-vertex fallback.

        Parameters
        ----------
        parent_geo_model_id : UUID | None
            The parent geological model id; ``None`` (a litho model with no geo
            parent) yields an empty list (no geology to bound against).

        Returns
        -------
        list[_GeoSurface]
            Built, non-stale surfaces with their geological formation id.
        """
        if parent_geo_model_id is None:
            return []
        rows = await self._repo.list_surfaces(parent_geo_model_id)
        out: list[_GeoSurface] = []
        for row in rows:
            if row.is_stale or not row.vertices or not row.triangles:
                continue
            tin = TinSurface(
                vertices=[tuple(v) for v in row.vertices],
                triangles=[tuple(t) for t in row.triangles],
            )
            out.append(_GeoSurface(formation_id=row.formation_id, tin=tin))
        self.debug(
            f"_load_geo_surfaces_with_formation: {len(out)} usable surface(s) "
            f"of {len(rows)} for geo model {parent_geo_model_id}"
        )
        return out

    @staticmethod
    def _evaluate(surface: _GeoSurface, x: float, y: float) -> float:
        """Elevation of *surface* at ``(x, y)``; nearest-vertex fallback off-footprint.

        Mirrors ``SurfaceBound.evaluate`` so the band logic matches the pure
        geo-bounding functions exactly.
        """
        elevation = evaluate_tin_at(surface.tin, x, y)
        if elevation is not None:
            return elevation
        nearest = min(surface.tin.vertices, key=lambda v: (v[0] - x) ** 2 + (v[1] - y) ** 2)
        return nearest[2]

    def _make_boundary_sampler(self, geo_surfaces: list[_GeoSurface]) -> BoundarySampler:
        """Build the ``(x, y) -> [(formation_id, elevation), ...]`` sampler.

        The list is sorted by elevation DESCENDING (top surface first) — the shape
        ``divide_picks_by_geology`` expects.  The geological ``formation_id`` is
        carried as a string so it round-trips back to a UUID in the segment loop.
        """

        def sample(x: float, y: float) -> list[tuple[str, float]]:
            pairs = [(str(s.formation_id), self._evaluate(s, x, y)) for s in geo_surfaces]
            pairs.sort(key=lambda fe: fe[1], reverse=True)
            return pairs

        return sample

    def _make_lowest_boundary_sampler(
        self, geo_surfaces: list[_GeoSurface]
    ) -> Callable[[float, float], float | None]:
        """Build the ``(x, y) -> lowest elevation | None`` sampler for shallow-test marking."""

        def sample(x: float, y: float) -> float | None:
            if not geo_surfaces:
                return None
            return min(self._evaluate(s, x, y) for s in geo_surfaces)

        return sample

    def _geo_formation_at_midpoint(
        self, seg: BodyLayerPick, geo_surfaces: list[_GeoSurface]
    ) -> UUID | None:
        """Geological formation the segment sits within = lowest surface above its midpoint.

        Mirrors ``divide_picks_by_geology``'s ``band_key`` rule: the segment's
        geological band is the formation of the lowest geological surface still
        ABOVE the segment midpoint; ``None`` (the open shallow band) when no
        surface is above it.

        Parameters
        ----------
        seg : BodyLayerPick
            One geo-bounded segment (already divided).
        geo_surfaces : list[_GeoSurface]
            The parent geology band surfaces.

        Returns
        -------
        UUID | None
            The geological formation id, or ``None`` for the open shallow band.
        """
        if not geo_surfaces:
            return None
        top_e = seg.surface_elev_m - seg.top_depth_m
        base_e = seg.surface_elev_m - seg.base_depth_m
        mid = 0.5 * (top_e + base_e)
        above = [(s.formation_id, self._evaluate(s, seg.x_m, seg.y_m)) for s in geo_surfaces]
        above = [(fid, elev) for fid, elev in above if elev > mid]
        if not above:
            return None
        return min(above, key=lambda fe: fe[1])[0]

    @staticmethod
    def _is_original_top(seg: BodyLayerPick, original_tops: set[float]) -> bool:
        """True when the segment top matches one of the investigation's litho tops."""
        return any(abs(seg.top_depth_m - t) <= _ORIGINAL_TOP_EPS_M for t in original_tops)

    # ------------------------------------------------------------------
    # Phase 4 — geo contact provenance
    # ------------------------------------------------------------------

    async def _load_geo_contacts_by_investigation(
        self, parent_geo_model_id: UUID | None, investigation_ids: set[UUID]
    ) -> dict[str, list[tuple[float, UUID, UUID]]]:
        """Load parent-geology contacts grouped by investigation for provenance.

        Each entry is ``(depth_top_m, formation_id, contact_id)`` — the shape the
        provenance match consumes.  Keyed by the investigation id as a STRING so
        it joins with ``BodyLayerPick.investigation_id`` (also a string).

        Parameters
        ----------
        parent_geo_model_id : UUID | None
            The parent geological model id; ``None`` → empty map.
        investigation_ids : set[UUID]
            The in-corridor investigation ids to restrict the contacts to.

        Returns
        -------
        dict[str, list[tuple[float, UUID, UUID]]]
            ``investigation_id (str) -> [(depth_top_m, geo_formation_id, contact_id), ...]``.
        """
        if parent_geo_model_id is None or not investigation_ids:
            return {}
        rows = (
            await self._session.execute(
                select(
                    FormationContactOrm.depth_top_m,
                    FormationContactOrm.formation_id,
                    FormationContactOrm.id,
                    FormationContactOrm.borehole_id,
                    FormationContactOrm.cpt_id,
                ).where(
                    FormationContactOrm.model_id == parent_geo_model_id,
                    FormationContactOrm.borehole_id.in_(investigation_ids)
                    | FormationContactOrm.cpt_id.in_(investigation_ids),
                )
            )
        ).all()
        out: dict[str, list[tuple[float, UUID, UUID]]] = defaultdict(list)
        for r in rows:
            anchor = r.borehole_id if r.borehole_id is not None else r.cpt_id
            out[str(anchor)].append((r.depth_top_m, r.formation_id, r.id))
        return dict(out)

    @staticmethod
    def _match_geo_contact(
        cut_depth_m: float,
        geo_formation_id: UUID,
        geo_contacts: list[tuple[float, UUID, UUID]],
        tolerance_m: float,
    ) -> UUID | None:
        """Match a geo-division cut to the geological contact that forced it.

        Picks the geological contact OF THE SAME geological formation whose depth
        is nearest ``cut_depth_m`` and within ``tolerance_m``.  ``None`` when no
        contact of that formation is within tolerance (the surface was interpolated
        at this column — honest NULL provenance).

        Parameters
        ----------
        cut_depth_m : float
            The geo-division cut depth (segment top).
        geo_formation_id : UUID
            The geological formation the cut sits below (its top forced the cut).
        geo_contacts : list[tuple[float, UUID, UUID]]
            ``(depth_top_m, formation_id, contact_id)`` for the investigation.
        tolerance_m : float
            Maximum allowed depth difference.

        Returns
        -------
        UUID | None
            The geological contact id, or ``None`` when nothing matches.
        """
        best: tuple[float, UUID] | None = None
        for depth, fid, contact_id in geo_contacts:
            if fid != geo_formation_id:
                continue
            d = abs(depth - cut_depth_m)
            if d <= tolerance_m and (best is None or d < best[0]):
                best = (d, contact_id)
        return best[1] if best is not None else None

    # ------------------------------------------------------------------
    # Phase 5 — skeleton formations + persistence helpers
    # ------------------------------------------------------------------

    async def _load_litho_formations(
        self, picks: list[BodyLayerPick]
    ) -> dict[UUID, GeologicalFormationOrm]:
        """Load the litho formation rows referenced by the picks, keyed by id.

        Used to inherit ``litho_main_soil_code`` + ``litho_admixtures`` onto the
        skeleton geotech formations.

        Parameters
        ----------
        picks : list[BodyLayerPick]
            The section-scoped picks (their ``formation_id`` are the litho units).

        Returns
        -------
        dict[UUID, GeologicalFormationOrm]
            ``litho_formation_id -> formation row``.
        """
        fids = {UUID(p.formation_id) for p in picks}
        if not fids:
            return {}
        rows = (
            (
                await self._session.execute(
                    select(GeologicalFormationOrm).where(GeologicalFormationOrm.id.in_(fids))
                )
            )
            .scalars()
            .all()
        )
        return {f.id: f for f in rows}

    async def _find_or_create_skeleton_formation(
        self,
        *,
        project_id: UUID,
        skeleton_by_key: dict[tuple[UUID, UUID | None], GeologicalFormationOrm],
        created_formation_ids: list[UUID],
        source_litho_formation_id: UUID,
        source_geo_formation_id: UUID | None,
        litho_formation_by_id: dict[UUID, GeologicalFormationOrm],
    ) -> GeologicalFormationOrm:
        """Find-or-create the skeleton geotech formation for a ``(litho, geo)`` pair.

        Shared across investigations/sections by the dual-ref key
        ``(source_litho_formation_id, source_geo_formation_id)``; ``nad_class`` stays
        ``None`` (Task C2's accept assigns the real class + retargets contacts).
        ``litho_main_soil_code`` + ``litho_admixtures`` are inherited from the
        source litho formation so the C2 classifier can pick the right NAD column.

        Parameters
        ----------
        project_id : UUID
            Owning project.
        skeleton_by_key : dict
            In-memory find-or-create cache for this build (mutated).
        created_formation_ids : list[UUID]
            Accumulator of ids created in this build (mutated).
        source_litho_formation_id : UUID
            The litho formation this geotech unit subdivides.
        source_geo_formation_id : UUID | None
            The geological formation the unit sits within (``None`` for the open
            shallow band — no geological surface above it).
        litho_formation_by_id : dict[UUID, GeologicalFormationOrm]
            Litho formation rows for inheritance.

        Returns
        -------
        GeologicalFormationOrm
            The found-or-created skeleton formation row.
        """
        key = (source_litho_formation_id, source_geo_formation_id)
        cached = skeleton_by_key.get(key)
        if cached is not None:
            return cached

        # Cache miss — query the DB before inserting so that a re-build (or a
        # concurrent build for a different section) reuses the existing skeleton
        # row instead of creating a duplicate.
        #
        # The source_geo_formation_id IS NULL case requires `.is_(None)` in the
        # WHERE clause; using `== None` would be treated as Python None-comparison
        # and silently produce the wrong SQL predicate.
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
                        GeologicalFormationOrm.source_litho_formation_id
                        == source_litho_formation_id,
                        geo_filter,
                        GeologicalFormationOrm.nad_class.is_(None),
                    )
                )
            )
            .scalars()
            .first()
        )
        if db_row is not None:
            skeleton_by_key[key] = db_row
            self.debug(
                f"_find_or_create_skeleton_formation: reused {db_row.id} "
                f"litho={source_litho_formation_id} geo={source_geo_formation_id}"
            )
            return db_row

        litho_formation = litho_formation_by_id.get(source_litho_formation_id)
        soil_code = litho_formation.litho_main_soil_code if litho_formation is not None else None
        admixtures = litho_formation.litho_admixtures if litho_formation is not None else None
        color = litho_formation.color if litho_formation is not None else "#bbbbbb"
        name = (
            f"{litho_formation.name} (geotech)" if litho_formation is not None else "geotech unit"
        )
        # Inherit display_order so the formation-list UI orders geotech units like
        # their litho parents; fall back to 0 when the litho row is missing.
        display_order = litho_formation.display_order if litho_formation is not None else 0

        formation = GeologicalFormationOrm(
            id=uuid7(),
            app_project_id=project_id,
            name=name,
            color=color,
            display_order=display_order,
            nad_class=None,  # set at Task C2 accept
            litho_main_soil_code=soil_code,
            litho_admixtures=admixtures,
            source_litho_formation_id=source_litho_formation_id,
            source_geo_formation_id=source_geo_formation_id,
        )
        self._session.add(formation)
        await self._session.flush()
        skeleton_by_key[key] = formation
        created_formation_ids.append(formation.id)
        self.debug(
            f"_find_or_create_skeleton_formation: created {formation.id} "
            f"litho={source_litho_formation_id} geo={source_geo_formation_id} soil={soil_code}"
        )
        return formation

    async def _resolve_anchor_kinds(self, investigation_ids: set[UUID]) -> dict[str, str]:
        """Classify each investigation id as ``"borehole"`` or ``"cpt"``.

        A ``BodyLayerPick.investigation_id`` is a bare id string with no anchor-kind
        flag, but the geotech ``FormationContact`` needs the right XOR column
        (``borehole_id`` vs ``cpt_id``).  One ``SELECT id`` per table resolves the
        whole set; an id present in neither table (deleted between pick load and
        here) is omitted and its contacts are skipped at the call site.

        Parameters
        ----------
        investigation_ids : set[UUID]
            The investigation ids to classify.

        Returns
        -------
        dict[str, str]
            ``investigation_id (str) -> "borehole" | "cpt"``.
        """
        if not investigation_ids:
            return {}
        kinds: dict[str, str] = {}
        bh_rows = (
            await self._session.execute(
                select(BoreholeOrm.id).where(BoreholeOrm.id.in_(investigation_ids))
            )
        ).scalars()
        for bid in bh_rows:
            kinds[str(bid)] = "borehole"
        cpt_rows = (
            await self._session.execute(select(CptOrm.id).where(CptOrm.id.in_(investigation_ids)))
        ).scalars()
        for cid in cpt_rows:
            kinds[str(cid)] = "cpt"
        return kinds

    @staticmethod
    def _anchor_kwargs(inv_id: str, anchor_kind: dict[str, str]) -> dict[str, UUID]:
        """Build the contact's XOR anchor kwargs for an investigation id.

        Parameters
        ----------
        inv_id : str
            The pick's ``investigation_id``.
        anchor_kind : dict[str, str]
            ``investigation_id -> "borehole" | "cpt"`` from
            :meth:`_resolve_anchor_kinds`.

        Returns
        -------
        dict[str, UUID]
            ``{"borehole_id": uuid}`` or ``{"cpt_id": uuid}``.  Empty dict when the
            id is in neither table (the caller skips contacts with no anchor — a
            ``FormationContact`` needs exactly one anchor).
        """
        kind = anchor_kind.get(inv_id)
        if kind == "borehole":
            return {"borehole_id": UUID(inv_id)}
        if kind == "cpt":
            return {"cpt_id": UUID(inv_id)}
        return {}

    async def _read_litho_snap_tolerance_m(self, model_id: UUID) -> float:
        """Read the project's ``litho_snap_tolerance_m`` from its view-state.

        Mirrors ``BuildVoxelLithoModel._read_litho_snap_tolerance_m`` /
        ``RecomputeLithoSolids._read_strat_grid_spacing_m``: model → its project →
        the JSON knob, guarding bad / non-positive values back to the 0.20 m default.

        Parameters
        ----------
        model_id : UUID
            The lithostratigraphic model (to find its project).

        Returns
        -------
        float
            The configured snap tolerance, or the 0.20 m default.
        """
        model = await self._session.get(GeologicalModelOrm, model_id)
        if model is None:
            return _DEFAULT_LITHO_SNAP_TOLERANCE_M
        project = await ProjectRepository(self._session).get_by_id(model.app_project_id)
        view_state = project.view_state if project is not None else None
        seg = (view_state or {}).get("litho_segmenter") or {}
        try:
            tol = float(seg.get("litho_snap_tolerance_m", _DEFAULT_LITHO_SNAP_TOLERANCE_M))
            return tol if tol > 0 else _DEFAULT_LITHO_SNAP_TOLERANCE_M
        except (TypeError, ValueError):
            return _DEFAULT_LITHO_SNAP_TOLERANCE_M
