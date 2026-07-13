"""Shared borehole-materialisation helpers for the geotech subdivision stage.

Both :class:`SubdivideAllBodies` and :class:`DivideBoreholes` find-or-create
classified geotech formations while materialising layers.  This base class
extracts the shared segment-grouping + find-or-create logic so neither use
case copy-pastes it.  (Borehole TIN-division itself lives in DivideBoreholes
as ``_materialise_borehole_bands_litho_confined`` — SubdivideAllBodies
materialises CPT bands only.)

Who inherits
------------
* :class:`~groundmodel.application.subdivide_all_bodies.SubdivideAllBodies`
* :class:`~groundmodel.application.divide_boreholes.DivideBoreholes`

Who does NOT inherit
--------------------
Dataclasses, value objects, enums, exception classes — they hold data, not
behaviour.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.view_state_helpers import (
    load_project_view_state,
    read_view_state_float,
)
from groundmodel.domain.services.litho_body_pick import BodyLayerPick
from groundmodel.domain.services.litho_geo_bounding import BoundarySampler
from groundmodel.domain.services.tin_surface import evaluate_tin_at
from groundmodel.domain.value_objects.tin_surface import TinSurface
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.repositories.geology_repository import GeologyRepository
from groundmodel.infrastructure.db.repositories.litho_layer_repository import LithoLayerRepository
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# Geo↔litho snap tolerance for the geotech geo-bounding.  When a geological
# surface crosses a litho unit within this distance of a litho contact, the
# division SNAPS to the contact instead of carving a thin sliver.  Geotech uses
# a wider default (0.3 m) than the litho stage's 0.20 m so true near-coincident
# slivers snap, while a genuine mid-unit geo boundary further than 0.3 m from
# any contact still divides (a 0.44 m division is real, not a sliver — owner).
# Read from ``view_state["geotech_subdivision"]``, kept separate from the litho
# stage's ``litho_segmenter.litho_snap_tolerance_m``.
_DEFAULT_GEOTECH_SNAP_TOLERANCE_M: float = 0.30


@dataclass
class _GeoSurface:
    """A parent-geology band surface kept WITH its geological formation id.

    ``load_geo_surfaces`` drops the formation id; the geotech builders need it
    so a cut can be attributed to its geological formation and matched to a
    geological contact row for provenance.

    Attributes
    ----------
    formation_id : UUID
        The geological formation whose top this surface is.
    tin : TinSurface
        The cached interpolated surface mesh.
    """

    formation_id: UUID
    tin: TinSurface


class GeotechBoreholeMaterialiser(GroundModelLogger):
    """Base class that provides shared segment-grouping and find-or-create logic.

    Concrete subclasses must call ``super().__init__(__name__, session)`` so
    the logger uses the caller's module path (not the base class path).

    Parameters
    ----------
    name : str
        Logger name — pass ``__name__`` from the concrete class.
    session : AsyncSession
        Active SQLAlchemy async session.
    """

    def __init__(self, name: str, session: AsyncSession) -> None:
        """Initialise logger + shared infrastructure references."""
        super().__init__(name)
        self._session = session
        self._litho_repo = LithoLayerRepository(session)
        self._repo = GeologyRepository(session)

    # ------------------------------------------------------------------
    # Grouping helper
    # ------------------------------------------------------------------

    async def _group_segments(
        self,
        divided: list[BodyLayerPick],
        geo_surfaces: list[_GeoSurface],
    ) -> dict[tuple[str, UUID | None], list[BodyLayerPick]]:
        """Group geo-bounded segments by ``(body_id, source_geo_formation_id)``.

        Parameters
        ----------
        divided : list[BodyLayerPick]
            Geo-bounded picks from ``divide_picks_by_geology``.
        geo_surfaces : list[_GeoSurface]
            Parent geology band surfaces.

        Returns
        -------
        dict[tuple[str, UUID | None], list[BodyLayerPick]]
            Keyed by ``(body_id_str, source_geo_formation_id)``.
        """
        groups: dict[tuple[str, UUID | None], list[BodyLayerPick]] = defaultdict(list)
        for seg in divided:
            geo_fid = self._geo_formation_at_midpoint(seg, geo_surfaces)
            groups[(seg.body_id, geo_fid)].append(seg)
        return dict(groups)

    # ------------------------------------------------------------------
    # Geotech model ensure-or-create
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
                        GeologicalModelOrm.parent_model_id == litho_model.id,
                        GeologicalModelOrm.kind == "geotechnical",
                    )
                )
            )
            .scalars()
            .first()
        )
        if existing is not None:
            # Ensure the reused model is active — the frontend derives
            # ``activeGeotechModel`` via ``find(m => m.is_active && m.kind
            # === 'geotechnical')``, so an inactive reused model would be
            # invisible to the UI after the first build.  A model may become
            # inactive if ``activateModel`` was called for a different model
            # of the same kind (unlikely for geotech which allows only one
            # child, but defensive correctness matters here).
            if not existing.is_active:
                existing.is_active = True
                self.info(
                    f"_ensure_geotech_model: re-activated inactive geotech model {existing.id}"
                )
            else:
                self.debug(f"_ensure_geotech_model: reusing existing geotech model {existing.id}")
            return existing, False

        model = await self._repo.create_model(
            litho_model.app_project_id,
            name=f"{litho_model.name} — geotechnical",
            is_active=True,
            kind="geotechnical",
            parent_model_id=litho_model.id,
        )
        self.info(f"_ensure_geotech_model: created geotech model {model.id}")
        return model, True

    # ------------------------------------------------------------------
    # Geo surfaces + boundary samplers
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

    # ------------------------------------------------------------------
    # Formation find-or-create helpers
    # ------------------------------------------------------------------

    async def _find_or_create_formation(
        self,
        *,
        project_id: UUID,
        classified_by_key: dict[tuple[int, UUID, UUID | None], GeologicalFormationOrm],
        skeleton_by_key: dict[tuple[UUID, UUID | None], GeologicalFormationOrm],
        created_formation_ids: list[UUID],
        nad_class: int | None,
        source_litho_formation_id: UUID,
        source_geo_formation_id: UUID | None,
    ) -> GeologicalFormationOrm:
        """Find-or-create the geotech formation for one sub-unit.

        Delegates to :meth:`_find_or_create_classified` for
        ``nad_class is not None`` or to :meth:`_find_or_create_skeleton` for
        the borehole-only carry-through.

        Parameters
        ----------
        project_id : UUID
            Owning project.
        classified_by_key : dict
            In-memory cache for classified formations (mutated).
        skeleton_by_key : dict
            In-memory cache for skeleton formations (mutated).
        created_formation_ids : list[UUID]
            Accumulator of classified formation ids created (mutated).
        nad_class : int | None
            NAD packing class, or ``None`` for a skeleton carry-through.
        source_litho_formation_id : UUID
            The litho formation this geotech unit subdivides.
        source_geo_formation_id : UUID | None
            The geological formation the unit sits within.

        Returns
        -------
        GeologicalFormationOrm
            The found-or-created formation row.
        """
        if nad_class is None:
            return await self._find_or_create_skeleton(
                project_id=project_id,
                skeleton_by_key=skeleton_by_key,
                source_litho_formation_id=source_litho_formation_id,
                source_geo_formation_id=source_geo_formation_id,
            )
        return await self._find_or_create_classified(
            project_id=project_id,
            classified_by_key=classified_by_key,
            created_formation_ids=created_formation_ids,
            nad_class=nad_class,
            source_litho_formation_id=source_litho_formation_id,
            source_geo_formation_id=source_geo_formation_id,
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
        """Find-or-create a classified geotech formation by the full triple.

        The triple ``(nad_class, source_litho_formation_id,
        source_geo_formation_id)`` is the stable find-or-create key for
        classified geotech formations.

        Parameters
        ----------
        project_id : UUID
            Owning project.
        classified_by_key : dict
            In-memory find-or-create cache (mutated).
        created_formation_ids : list[UUID]
            Accumulator of ids created in this call (mutated).
        nad_class : int
            The NAD packing class.
        source_litho_formation_id : UUID
            The litho formation this geotech unit subdivides.
        source_geo_formation_id : UUID | None
            The geological formation the unit sits within.

        Returns
        -------
        GeologicalFormationOrm
            The found-or-created classified formation row.
        """
        key = (nad_class, source_litho_formation_id, source_geo_formation_id)
        cached = classified_by_key.get(key)
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
                f"nad={nad_class} litho={source_litho_formation_id} "
                f"geo={source_geo_formation_id}"
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
            f"_find_or_create_classified: created {formation.id} "
            f"nad={nad_class} soil={soil_code} "
            f"litho={source_litho_formation_id} geo={source_geo_formation_id}"
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
        """Find-or-create a skeleton (``nad_class=None``) formation.

        Used for borehole-only sub-bodies in a CPT-free body (permanent — they
        cannot be TIN-divided), and as a last resort when no CPT data exists in
        the model at all.

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
        self.debug(
            f"_find_or_create_skeleton: created {formation.id} "
            f"litho={source_litho_formation_id} geo={source_geo_formation_id}"
        )
        return formation

    # ------------------------------------------------------------------
    # DB helpers
    # ------------------------------------------------------------------

    async def _resolve_anchor_kinds(self, investigation_ids: set[UUID]) -> dict[str, str]:
        """Classify each investigation id as ``"borehole"`` or ``"cpt"``.

        Parameters
        ----------
        investigation_ids : set[UUID]
            Investigation UUIDs to classify.

        Returns
        -------
        dict[str, str]
            ``investigation_id (str) -> "borehole" | "cpt"``.
        """
        if not investigation_ids:
            return {}
        kinds: dict[str, str] = {}
        bh_ids = (
            await self._session.execute(
                select(BoreholeOrm.id).where(BoreholeOrm.id.in_(investigation_ids))
            )
        ).scalars()
        for bid in bh_ids:
            kinds[str(bid)] = "borehole"
        cpt_ids = (
            await self._session.execute(select(CptOrm.id).where(CptOrm.id.in_(investigation_ids)))
        ).scalars()
        for cid in cpt_ids:
            kinds[str(cid)] = "cpt"
        return kinds

    async def _read_geotech_snap_tolerance_m(self, project_id: UUID) -> float:
        """Read the geotech geo↔litho snap tolerance from the project view-state.

        Reads ``view_state["geotech_subdivision"]["litho_snap_tolerance_m"]`` —
        a GEOTECH-specific, WIDER tolerance than the litho stage's, so a
        geological surface that crosses a litho unit within this distance of a
        litho contact snaps to the contact (no sliver) rather than dividing.

        Parameters
        ----------
        project_id : UUID
            Owning project id.

        Returns
        -------
        float
            The configured geotech snap tolerance, or
            ``_DEFAULT_GEOTECH_SNAP_TOLERANCE_M`` (0.30 m) when absent,
            non-positive, or non-numeric.
        """
        view_state = await load_project_view_state(self._session, project_id)
        return read_view_state_float(
            view_state,
            "geotech_subdivision",
            "litho_snap_tolerance_m",
            _DEFAULT_GEOTECH_SNAP_TOLERANCE_M,
        )
