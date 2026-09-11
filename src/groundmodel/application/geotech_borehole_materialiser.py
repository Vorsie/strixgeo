"""Shared borehole-materialisation helpers for the geotech subdivision stage.

Both :class:`SubdivideAllBodies` and :class:`DivideBoreholes` find-or-create
classified geotech formations while materialising layers.  This base class
extracts the shared segment-grouping + find-or-create logic so neither use
case copy-pastes it.  (Borehole TIN-division itself lives in DivideBoreholes
as ``_plan_borehole_bands_litho_confined`` — SubdivideAllBodies
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
from collections.abc import Callable, Collection
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.domain.services.litho_body_pick import BodyLayerPick
from groundmodel.domain.services.litho_column_digest import (
    litho_column_digest,
    next_stamp_map,
)
from groundmodel.domain.services.nad_classifier import clamp_class_to_soil, soil_family_of
from groundmodel.domain.services.tin_surface import evaluate_tin_at
from groundmodel.domain.value_objects.tin_surface import TinSurface
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.repositories.geology_repository import GeologyRepository
from groundmodel.infrastructure.db.repositories.litho_layer_repository import LithoLayerRepository
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


def _canonical_column_id(column_id: str) -> str:
    """Normalise a column id to the ``str(UUID)`` form the digest maps key on."""
    try:
        return str(UUID(column_id))
    except (ValueError, AttributeError, TypeError):
        # Not a uuid: return it unchanged rather than dropping the column. An
        # id that never matches is visible in the stamped/banded counts; an id
        # silently discarded here is not.
        return column_id


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
        self._family_clamp_count = 0
        """Bands this press left unclassified because the class was foreign.

        A per-band WARNING already names each one; this is what lets the press
        say how many there were in one line, so a run that silently dropped
        forty classes cannot read like a clean one.
        """

    # ------------------------------------------------------------------
    # Grouping helper
    # ------------------------------------------------------------------

    def _group_segments(
        self,
        segments: list[BodyLayerPick],
        geo_surfaces: list[_GeoSurface],
    ) -> dict[tuple[str, UUID | None, str], list[BodyLayerPick]]:
        """Group litho picks by ``(body_id, source_geo_formation_id, formation_id)``.

        The picks arrive WHOLE — nothing has cut them at a geological surface
        since the owner dropped that wall (2026-08-26). This pass is where the
        geological model gets its say, and its say is a LABEL: each pick is
        attributed to the geological unit it mostly lies in
        (:meth:`_geo_formation_at_midpoint`), never divided by one.

        The LITHO FORMATION is part of the key because both presses read the
        group's first segment as THE litho formation of every band they mint
        from it, and a body does not identify one: the resolver merges
        admixture variants of the same soil into a single body
        (``resolve_litho_instances.same_mass`` — *"Admixture variants of the
        SAME soil (different formation rows, same litho_main_soil_code) still
        merge"*).  Owner dogfeed 2026-09-11, borehole GEO-52/110/14-b13: his
        clean sand and the glauconitic sand below it shared a body, so every
        band of both took the CLEAN sand's formation; the merge-back then read
        one litho unit either side of his 14.52 m contact and joined two dense
        bands straight through it, and the split he had drawn appeared to have
        moved up to 12.93 m.  A packing band belongs to ONE litho unit,
        admixture included — the rule the CPT axis has followed since
        2026-09-07 (seam identity = soil | class | admixture).

        Parameters
        ----------
        segments : list[BodyLayerPick]
            Body-assigned litho picks, already shallow-test flagged.
        geo_surfaces : list[_GeoSurface]
            Parent geology band surfaces; empty when the litho model has no
            geological parent, which labels every pick ``None``.

        Returns
        -------
        dict[tuple[str, UUID | None, str], list[BodyLayerPick]]
            Keyed by ``(body_id_str, source_geo_formation_id,
            litho_formation_id_str)``.  Every pick in a group shares one litho
            formation, which is what both presses assume of it.
        """
        groups: dict[tuple[str, UUID | None, str], list[BodyLayerPick]] = defaultdict(list)
        for seg in segments:
            geo_fid = self._geo_formation_at_midpoint(seg, geo_surfaces)
            groups[(seg.body_id, geo_fid, seg.formation_id)].append(seg)
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
    # Litho provenance (debt #266)
    # ------------------------------------------------------------------

    async def _stamp_litho_provenance(
        self,
        *,
        geotech_model: GeologicalModelOrm,
        litho_model_id: UUID,
        rebuilt_column_ids: Collection[str],
    ) -> int:
        """Record which litho stack each rebuilt column's bands were made from.

        Debt #266: without this the bands carry no link to the litho under them,
        so dragging a litho contact leaves every band in that column describing a
        stack that no longer exists — silently, all the way into an export.

        Lives on the shared base because BOTH presses have to do it and they must
        do it identically: ``SubdivideAllBodies`` rebuilds the CPT columns,
        ``DivideBoreholes`` the borehole ones, each leaving the other's columns —
        and any column ``skip_existing`` protected — with the provenance they
        already had.  Two copies of this fold would drift into two answers about
        the same model.

        Writes a NEW dict rather than mutating in place: SQLAlchemy does not
        track in-place mutation of a plain JSONB value, so an in-place update
        would be silently dropped at flush.

        Call it inside the verb's transaction, before its single commit.

        Parameters
        ----------
        geotech_model : GeologicalModelOrm
            The geotech model being written; its
            ``derived_from_litho_digests`` map is replaced.
        litho_model_id : UUID
            The parent lithostratigraphic model the bands were derived from.
        rebuilt_column_ids : Collection[str]
            Column ids (``str(UUID)``) this press actually (re)built.  Columns
            outside it keep whatever provenance they had — including none.

        Returns
        -------
        int
            How many columns the stored map now vouches for.
        """
        repo = LithoLayerRepository(self._session)
        current = await repo.load_column_digests(litho_model_id)
        banded = await repo.banded_column_ids(geotech_model.id)

        # Both presses key their layer index on ``str(uuid)``, and so do the two
        # repository reads — but a single mis-cased id here would leave that
        # column unstamped FOREVER, silently, which is the failure mode this
        # whole feature exists to remove.  Canonicalise rather than trust.
        rebuilt = {_canonical_column_id(column) for column in rebuilt_column_ids}

        # A rebuilt column absent from ``current`` was built over ground with no
        # accepted litho at all.  Stamping the empty-stack digest states that
        # honestly, so litho appearing there later reads as a change.
        empty = litho_column_digest([])
        rebuilt_digests = {column: current.get(column, empty) for column in rebuilt}

        previous = geotech_model.derived_from_litho_digests or {}
        folded = next_stamp_map(
            previous=previous,
            rebuilt_digests=rebuilt_digests,
            banded_column_ids=banded,
        )
        geotech_model.derived_from_litho_digests = folded

        unstamped = len(banded) - len(folded)
        self.info(
            f"_stamp_litho_provenance: geotech_model={geotech_model.id} "
            f"litho_model={litho_model_id} rebuilt={len(rebuilt_digests)} "
            f"stamped={len(folded)}/{len(banded)} banded column(s)"
            + (
                f"; {unstamped} column(s) still carry bands with no recorded "
                "provenance (banded before #266 shipped — they read as not stale)"
                if unstamped
                else ""
            )
        )
        return len(folded)

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

        The segment's geological band is the formation of the lowest geological
        surface still ABOVE the segment midpoint; ``None`` (the open shallow
        band) when no surface is above it.

        Reading the MIDPOINT is the thickness-weighted majority rule (the A2
        precedent in ``docs/domain-model.md``): where one surface crosses the
        segment, the midpoint lies in whichever side is thicker, exactly. That
        only started to matter on 2026-08-26, when the owner dropped the
        geological wall and segments became able to straddle a surface at all.
        The hand-edit writers apply the same rule over their written interval
        (``geotech_band_edit_helpers.geo_parent_for_interval``), so a re-subdivide
        cannot relabel a band the engineer just touched.

        Parameters
        ----------
        seg : BodyLayerPick
            One litho pick, whole — nothing cuts it at a geological surface.
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
        classified_by_key: dict[tuple[int, UUID], GeologicalFormationOrm],
        skeleton_by_key: dict[tuple[UUID], GeologicalFormationOrm],
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
            NAD packing class, or ``None`` for a skeleton carry-through. A
            class outside the source litho unit's own soil family is treated
            as ``None`` — see the clamp below. Callers that record the class
            alongside the row must read it back off the returned formation,
            never from what they passed in.
        source_litho_formation_id : UUID
            The litho formation this geotech unit subdivides.
        source_geo_formation_id : UUID | None
            The geological formation the unit sits within.

        Returns
        -------
        GeologicalFormationOrm
            The found-or-created formation row. A class from another soil
            family yields the SKELETON row, not a classified one.
        """
        if nad_class is not None:
            soil_code = await self._source_litho_soil_code(source_litho_formation_id)
            if clamp_class_to_soil(nad_class, soil_code) is None:
                # Owner ruling 2026-08-26: *"no a zand body can never carry a
                # silt packing class"* — *"the nad coupling is absolute."*
                # Every geotech band in the model is minted here, so this is
                # the one door the invariant has to hold at, whatever chose
                # the class upstream.
                #
                # The band becomes UNCLASSIFIED rather than being nudged into
                # the right family. A silt's firmness is not evidence about a
                # sand's density, so there is no same-rank substitute to reach
                # for; inventing one would dress a guess as a reading (the
                # no-guessing rule, Data Integrity Rule 3). "Not yet
                # classified" is the honest state, it is visible in the
                # roster, and the engineer can set it by hand.
                self.warning(
                    f"_find_or_create_formation: NAD {nad_class} is "
                    f"{soil_family_of(nad_class)} but litho unit "
                    f"{source_litho_formation_id} is {soil_code!r} — leaving the band "
                    "unclassified (a packing class belongs to its own soil column)"
                )
                self._family_clamp_count += 1
                nad_class = None
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
        classified_by_key: dict[tuple[int, UUID], GeologicalFormationOrm],
        created_formation_ids: list[UUID],
        nad_class: int,
        source_litho_formation_id: UUID,
        source_geo_formation_id: UUID | None,
    ) -> GeologicalFormationOrm:
        """Find-or-create a classified geotech formation by (class, litho parent).

        The pair ``(nad_class, source_litho_formation_id)`` is the stable
        find-or-create key. The geological parent is a LABEL, not identity
        (owner ruling 2026-08-31, R1, debt #278), so one row serves a class +
        litho unit however many geological units the bands straddle; the DB
        lookup takes the OLDEST matching row (the twin-merge migration's
        survivor rule). ``source_geo_formation_id`` is still accepted — it is
        the band's attribution, recorded on the band's own
        ``source_geo_formation_id`` stamp — but never forks the row.

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
            The geological formation the unit sits within — attribution only,
            NOT part of the row identity (R1).

        Returns
        -------
        GeologicalFormationOrm
            The found-or-created classified formation row.
        """
        key = (nad_class, source_litho_formation_id)
        cached = classified_by_key.get(key)
        if cached is not None:
            return cached

        # R1 (owner 2026-08-31, debt #278): the geological parent is a LABEL, not
        # identity — one row per (class, litho parent), whatever geological unit a
        # band sits in. The lookup drops the geological filter and takes the
        # OLDEST matching row: that is the survivor rule the one-time twin-merge
        # migration applies, so a re-subdivide converges on the row the migration
        # will keep even before it has run.
        db_row = (
            (
                await self._session.execute(
                    select(GeologicalFormationOrm)
                    .where(
                        GeologicalFormationOrm.app_project_id == project_id,
                        GeologicalFormationOrm.nad_class == nad_class,
                        GeologicalFormationOrm.source_litho_formation_id
                        == source_litho_formation_id,
                    )
                    .order_by(
                        GeologicalFormationOrm.created_at.asc(),
                        GeologicalFormationOrm.id.asc(),
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
            # R1: the geological parent is not identity — the row is shared
            # across geological units. The band's geological label is DERIVED
            # LIVE from geometry on read (the GP1 midpoint rule in
            # ``geo_parent_for_interval`` for band edits, ``majority_geo_formation``
            # in ``GetBodyGeoLabels`` for the units pane), never stored here.
            source_geo_formation_id=None,
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
        skeleton_by_key: dict[tuple[UUID], GeologicalFormationOrm],
        source_litho_formation_id: UUID,
        source_geo_formation_id: UUID | None,
    ) -> GeologicalFormationOrm:
        """Find-or-create a skeleton (``nad_class=None``) formation by litho parent.

        Used for borehole-only sub-bodies in a CPT-free body (permanent — they
        cannot be TIN-divided), and as a last resort when no CPT data exists in
        the model at all.

        The key is ``(source_litho_formation_id,)`` — the geological parent is a
        LABEL, not identity (owner ruling 2026-08-31, R1, debt #278), so one
        skeleton row serves a litho unit across every geological boundary and
        the lookup takes the OLDEST matching row (the twin-merge migration's
        survivor rule).

        Parameters
        ----------
        project_id : UUID
            Owning project.
        skeleton_by_key : dict
            In-memory find-or-create cache (mutated).
        source_litho_formation_id : UUID
            The litho formation this geotech unit subdivides.
        source_geo_formation_id : UUID | None
            The geological formation the unit sits within — attribution only,
            NOT part of the row identity (R1).

        Returns
        -------
        GeologicalFormationOrm
            The found-or-created skeleton formation row.
        """
        key = (source_litho_formation_id,)
        cached = skeleton_by_key.get(key)
        if cached is not None:
            return cached

        # R1 (owner 2026-08-31, debt #278): the geological parent is attribution,
        # not identity — one skeleton row per litho parent, oldest wins (the
        # twin-merge migration's survivor rule).
        db_row = (
            (
                await self._session.execute(
                    select(GeologicalFormationOrm)
                    .where(
                        GeologicalFormationOrm.app_project_id == project_id,
                        GeologicalFormationOrm.nad_class.is_(None),
                        GeologicalFormationOrm.source_litho_formation_id
                        == source_litho_formation_id,
                    )
                    .order_by(
                        GeologicalFormationOrm.created_at.asc(),
                        GeologicalFormationOrm.id.asc(),
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
            # R1: the geological parent is attribution, not identity — the row is
            # shared across geological units; the band carries its own stamp.
            source_geo_formation_id=None,
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

    async def _source_litho_soil_code(self, source_litho_formation_id: UUID) -> str | None:
        """The main soil of the litho unit a geotech band subdivides.

        The row is almost always already in the session's identity map (the
        caller has just grouped by it), so this is a dict hit rather than a
        query on every band.

        Parameters
        ----------
        source_litho_formation_id : UUID
            The litho formation the geotech unit subdivides.

        Returns
        -------
        str | None
            ``litho_main_soil_code``, or ``None`` when the row is missing or
            carries none — in which case there is no NAD family to judge a
            class against and the clamp stays silent.
        """
        row = await self._session.get(GeologicalFormationOrm, source_litho_formation_id)
        if row is None:
            self.warning(
                f"_source_litho_soil_code: litho formation {source_litho_formation_id} "
                "is not in the database — the soil-family clamp cannot judge this band"
            )
            return None
        return row.litho_main_soil_code

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
