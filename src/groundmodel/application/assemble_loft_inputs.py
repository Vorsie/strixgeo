"""Assemble the watertight-loft pipeline's domain inputs from the DB.

This is the application-layer bridge between the persisted lithostratigraphic
model and the pure loft domain services (``section_partition`` →
``model_domain`` → ``loft_field`` → ``loft_mesher``).  It owns the DB reads —
sections, accepted layers, approved correlation edges, investigation anchors,
geological band surfaces — and turns them into the value objects the domain
expects, WITHOUT leaking any ORM object across the layer boundary.

Per spec §1/§3 of ``2026-06-12-watertight-loft-body-builder-design.md``:

* Each cross-section becomes a :class:`SectionInput` — its line endpoints, the
  ascending along-positions of the on-section investigation columns, and the
  ``compute_section_fill`` regions for those columns.
* All on-section investigations (deduplicated across sections) become the
  :class:`DomainTest` list that ``build_model_domain`` triangulates.
* The geological surfaces of the parent model become :class:`BandSurface`
  callables so the loft fill is clipped per geological band.

``RecomputeLithoSolids`` consumes the result; the geo-bounding transforms it
already runs (``mark_and_truncate_shallow_tests`` / ``divide_picks_by_geology``)
stay in the use case — this module is purely the input-assembly stage.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.domain.services.loft_field import BandSurface, SectionInput
from groundmodel.domain.services.model_domain import DomainTest
from groundmodel.domain.services.section_partition import (
    CorrelationEdge,
    PartitionColumn,
    PartitionUnit,
    compute_section_fill,
)
from groundmodel.domain.services.tin_surface import evaluate_tin_at
from groundmodel.domain.value_objects.tin_surface import TinSurface
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.repositories.cross_section_repository import (
    CrossSectionRepository,
)
from groundmodel.infrastructure.db.repositories.geology_repository import GeologyRepository
from groundmodel.infrastructure.gis.section_projection import (
    SectionEndpoints,
    project_point_onto_line,
    section_length,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# Open-bound sentinel (metres) for the outermost geological bands.  The top of
# the shallowest band and the base of the deepest band are open — the loft's
# ``_clip_to_domain`` trims them to the real ground surface / deep base, so this
# only needs to comfortably exceed any plausible model elevation range.
_BAND_SENTINEL_M: float = 1.0e6


@dataclass(frozen=True)
class _Anchor:
    """One investigation's map-plane position + surface elevation.

    Parameters
    ----------
    investigation_id : str
        CPT/borehole id (the partition + domain identity).
    x_m, y_m : float
        Map-plane coordinates in the project CRS.
    surface_elev_m : float
        Ground-surface elevation (mTAW, positive up).
    base_elev_m : float
        Elevation of the deepest accepted litho layer's base at this anchor.
    """

    investigation_id: str
    x_m: float
    y_m: float
    surface_elev_m: float
    base_elev_m: float


@dataclass(frozen=True)
class LoftAssembly:
    """The assembled loft inputs.

    Attributes
    ----------
    sections : list[SectionInput]
        One per cross-section that has at least two on-section investigation
        columns (a section needs a gap to partition).
    tests : list[DomainTest]
        Every on-section investigation (deduplicated), for the model domain.
    band_surfaces : list[BandSurface]
        Geological band surfaces bounding the litho fill, top → deep.  Empty
        when the model has no parent geological model.
    on_section_investigation_ids : set[str]
        Every investigation id that projects onto at least one section
        corridor.  A resolver body is section-PRESENT (and so shapes the loft)
        iff one of its investigations is in this set — the spec's definition of
        section presence is geometric (test projection), independent of which
        body id the partition later assigns the volume.
    """

    sections: list[SectionInput]
    tests: list[DomainTest]
    band_surfaces: list[BandSurface]
    on_section_investigation_ids: set[str]


class AssembleLoftInputs(GroundModelLogger):
    """Assemble the loft pipeline's domain inputs for one lithostratigraphic model.

    Reads the DB; returns pure value objects.  The caller (``RecomputeLithoSolids``)
    owns the session + the transaction boundary.

    Parameters
    ----------
    session : AsyncSession
        Active SQLAlchemy async session.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    async def execute(self, model_id: UUID) -> LoftAssembly:
        """Build :class:`LoftAssembly` for the given model.

        Parameters
        ----------
        model_id : UUID
            The lithostratigraphic model to assemble.

        Returns
        -------
        LoftAssembly
            Sections + domain tests + band surfaces ready for the loft.  When
            the model has no accepted layers or no usable section, ``sections``
            and ``tests`` come back empty and the caller short-circuits.
        """
        self.info(f"AssembleLoftInputs: model={model_id}")

        model = await self._session.get(GeologicalModelOrm, model_id)
        if model is None:
            self.warning(f"AssembleLoftInputs: model {model_id} not found")
            return LoftAssembly(
                sections=[], tests=[], band_surfaces=[], on_section_investigation_ids=set()
            )

        # --- Accepted layers (the partition unit stacks) ---
        layer_rows = list(
            (
                await self._session.execute(
                    select(
                        LithoLayerOrm.id,
                        LithoLayerOrm.body_id,
                        LithoLayerOrm.formation_id,
                        LithoLayerOrm.depth_top_m,
                        LithoLayerOrm.depth_base_m,
                        LithoLayerOrm.borehole_id,
                        LithoLayerOrm.cpt_id,
                    )
                    .where(
                        LithoLayerOrm.model_id == model_id,
                        LithoLayerOrm.status == "accepted",
                    )
                    .order_by(LithoLayerOrm.depth_top_m)
                )
            ).all()
        )
        if not layer_rows:
            self.info(f"AssembleLoftInputs: model={model_id} — no accepted layers")
            return LoftAssembly(
                sections=[], tests=[], band_surfaces=[], on_section_investigation_ids=set()
            )

        # --- Anchor coordinates (bulk-load by id, same source as load_body_picks) ---
        anchors = await self._load_anchors(layer_rows)

        # --- Per-anchor unit stacks (depth-sorted), keyed by investigation id ---
        units_by_inv: dict[str, list[PartitionUnit]] = {}
        for r in layer_rows:
            anchor_id = str(r.borehole_id if r.borehole_id is not None else r.cpt_id)
            if anchor_id not in anchors:
                continue
            units_by_inv.setdefault(anchor_id, []).append(
                PartitionUnit(
                    top_depth_m=r.depth_top_m,
                    base_depth_m=r.depth_base_m,
                    formation_id=str(r.formation_id),
                    body_id=str(r.body_id) if r.body_id is not None else None,
                    layer_id=str(r.id),
                )
            )

        # --- Approved correlation edges (layer-id pairs), model-wide ---
        # Deliberately model-wide, NOT section-scoped (do not "fix" this to
        # ``section_id == sec.id``): the loft IS the 3D model, and the owner
        # design has the 3D model use the UNION of every section's edges
        # ("ResolveLithoInstances unions ALL sections' edges for body_id/3D" —
        # memory project_correlations_section_scoped).  Section-scoping is for
        # the 2D RENDER only.  The 3D-at-section slice does not have to equal the
        # 2D partition anyway — they only coincide when every test lies exactly
        # on the section line; in general the loft interpolates real off-line
        # positions.  ``compute_section_fill`` filters edges per gap, so passing
        # the whole model's edges is correct.
        edges = await self._load_edges(model_id)

        # --- One SectionInput per usable cross-section ---
        # ``SectionInput`` carries no investigation ids (parity with the TS
        # interface), so the builder also returns the on-section id set the
        # domain-test selection needs.
        sections, on_section_ids = await self._build_sections(model, units_by_inv, anchors, edges)

        # --- Domain tests: every on-section investigation, deduplicated ---
        tests = [
            DomainTest(
                test_id=a.investigation_id,
                x_m=a.x_m,
                y_m=a.y_m,
                surface_elev_m=a.surface_elev_m,
                base_elev_m=a.base_elev_m,
            )
            for inv_id, a in anchors.items()
            if inv_id in on_section_ids
        ]

        # --- Geological band surfaces (geology-prevails clipping) ---
        band_surfaces = await self._build_band_surfaces(model)

        self.success(
            f"AssembleLoftInputs: model={model_id} — {len(sections)} section(s), "
            f"{len(tests)} on-section test(s), {len(band_surfaces)} band surface(s)"
        )
        return LoftAssembly(
            sections=sections,
            tests=tests,
            band_surfaces=band_surfaces,
            on_section_investigation_ids=on_section_ids,
        )

    # -----------------------------------------------------------------
    # Anchor loading
    # -----------------------------------------------------------------

    async def _load_anchors(self, layer_rows: Sequence[Any]) -> dict[str, _Anchor]:
        """Bulk-load anchor coordinates + per-anchor base elevation.

        The (location_x, location_y, elevation_m) source matches
        ``load_body_picks`` so the loft + the legacy builder share one
        coordinate origin.  ``base_elev_m`` is the deepest accepted layer's
        base elevation at the anchor — the depth constraint the model domain's
        deep-base surface interpolates through.

        Parameters
        ----------
        layer_rows : list
            Accepted-layer rows (id, body_id, formation_id, depths, anchor ids).

        Returns
        -------
        dict[str, _Anchor]
            ``investigation_id → _Anchor`` for every anchor with complete
            coordinates.  Anchors with a missing row or null coordinate are
            skipped (logged).
        """
        bh_ids: set[UUID] = {r.borehole_id for r in layer_rows if r.borehole_id is not None}
        cpt_ids: set[UUID] = {r.cpt_id for r in layer_rows if r.cpt_id is not None}

        boreholes_by_id: dict[UUID, BoreholeOrm] = (
            {
                b.id: b
                for b in (
                    await self._session.execute(
                        select(BoreholeOrm).where(BoreholeOrm.id.in_(bh_ids))
                    )
                )
                .scalars()
                .all()
            }
            if bh_ids
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

        # Track the deepest base elevation per anchor across its accepted layers.
        deepest_base: dict[str, float] = {}
        coords: dict[str, tuple[float, float, float]] = {}
        skipped = 0
        for r in layer_rows:
            anchor: BoreholeOrm | CptOrm | None
            if r.borehole_id is not None:
                anchor = boreholes_by_id.get(r.borehole_id)
                anchor_id = str(r.borehole_id)
            else:
                anchor = cpts_by_id.get(r.cpt_id)
                anchor_id = str(r.cpt_id)
            if anchor is None or (
                anchor.location_x is None or anchor.location_y is None or anchor.elevation_m is None
            ):
                skipped += 1
                continue
            coords[anchor_id] = (anchor.location_x, anchor.location_y, anchor.elevation_m)
            base_e = anchor.elevation_m - r.depth_base_m
            if anchor_id not in deepest_base or base_e < deepest_base[anchor_id]:
                deepest_base[anchor_id] = base_e

        if skipped:
            self.warning(
                f"AssembleLoftInputs: skipped {skipped} layer row(s) with a missing "
                "anchor or incomplete coordinates"
            )

        return {
            inv_id: _Anchor(
                investigation_id=inv_id,
                x_m=x,
                y_m=y,
                surface_elev_m=elev,
                base_elev_m=deepest_base[inv_id],
            )
            for inv_id, (x, y, elev) in coords.items()
        }

    # -----------------------------------------------------------------
    # Correlation edges
    # -----------------------------------------------------------------

    async def _load_edges(self, model_id: UUID) -> list[CorrelationEdge]:
        """Load the model's approved correlation edges as layer-id pairs.

        Parameters
        ----------
        model_id : UUID
            The lithostratigraphic model.

        Returns
        -------
        list[CorrelationEdge]
            Each edge as a ``(layer_id_a, layer_id_b)`` pair (string ids).
        """
        rows = list(
            (
                await self._session.execute(
                    select(
                        LithoContactCorrelationEdgeOrm.contact_a_id,
                        LithoContactCorrelationEdgeOrm.contact_b_id,
                    ).where(
                        LithoContactCorrelationEdgeOrm.model_id == model_id,
                        LithoContactCorrelationEdgeOrm.user_approved.is_(True),
                    )
                )
            ).all()
        )
        return [CorrelationEdge(a=str(r.contact_a_id), b=str(r.contact_b_id)) for r in rows]

    # -----------------------------------------------------------------
    # Section building
    # -----------------------------------------------------------------

    async def _build_sections(
        self,
        model: GeologicalModelOrm,
        units_by_inv: dict[str, list[PartitionUnit]],
        anchors: dict[str, _Anchor],
        edges: list[CorrelationEdge],
    ) -> tuple[list[SectionInput], set[str]]:
        """Project investigations onto each cross-section and run the partition.

        Parameters
        ----------
        model : GeologicalModelOrm
            The lithostratigraphic model (for its ``app_project_id`` scope).
        units_by_inv : dict[str, list[PartitionUnit]]
            Per-investigation accepted unit stacks.
        anchors : dict[str, _Anchor]
            Per-investigation map-plane position + surface elevation.
        edges : list[CorrelationEdge]
            The model's approved correlation edges.

        Returns
        -------
        tuple[list[SectionInput], set[str]]
            One ``SectionInput`` per section with ≥ 2 on-section columns
            (sections with fewer are skipped — a partition needs a gap), plus
            the deduplicated set of investigation ids backing those columns.
        """
        section_repo = CrossSectionRepository(self._session)
        sections_orm = await section_repo.list_all(model.app_project_id)

        out: list[SectionInput] = []
        on_section_ids: set[str] = set()
        for sec in sections_orm:
            endpoints = SectionEndpoints(
                start_x=sec.start_x,
                start_y=sec.start_y,
                end_x=sec.end_x,
                end_y=sec.end_y,
            )
            length = section_length(endpoints)
            if length < 1e-6:
                continue  # degenerate section line

            excluded_bh = set(sec.excluded_borehole_ids or [])
            excluded_cpt = set(sec.excluded_cpt_ids or [])
            buffer_m = sec.projection_buffer_m

            # Project every investigation that has an accepted unit stack onto
            # the line; keep in-corridor ones (along ∈ [0, length], |offset| ≤ buffer).
            on_section: list[tuple[float, str]] = []  # (along, investigation_id)
            for inv_id, anchor in anchors.items():
                if inv_id not in units_by_inv:
                    continue
                inv_uuid = UUID(inv_id)
                if inv_uuid in excluded_bh or inv_uuid in excluded_cpt:
                    continue
                proj = project_point_onto_line(endpoints, anchor.x_m, anchor.y_m)
                if proj is None or proj.along < 0 or proj.along > length:
                    continue
                if abs(proj.offset) > buffer_m:
                    continue
                on_section.append((proj.along, inv_id))

            if len(on_section) < 2:
                continue  # a section needs ≥ 2 columns to form a gap

            on_section_ids.update(inv_id for _, inv_id in on_section)

            # Ascending along-order is the column order the partition expects.
            on_section.sort(key=lambda pair: pair[0])
            column_alongs = tuple(along for along, _ in on_section)
            columns = tuple(
                PartitionColumn(
                    investigation_id=inv_id,
                    surface_elev_m=anchors[inv_id].surface_elev_m,
                    units=tuple(units_by_inv[inv_id]),
                )
                for _, inv_id in on_section
            )

            regions = compute_section_fill(columns, edges)

            out.append(
                SectionInput(
                    section_id=str(sec.id),
                    ax=sec.start_x,
                    ay=sec.start_y,
                    bx=sec.end_x,
                    by=sec.end_y,
                    column_alongs=column_alongs,
                    regions=tuple(regions),
                )
            )
            self.debug(
                f"AssembleLoftInputs: section {sec.id} — {len(columns)} column(s), "
                f"{len(regions)} region(s)"
            )

        return out, on_section_ids

    # -----------------------------------------------------------------
    # Geological band surfaces
    # -----------------------------------------------------------------

    async def _build_band_surfaces(self, model: GeologicalModelOrm) -> list[BandSurface]:
        """Build the geological band surfaces that bound the litho fill.

        Each consecutive pair of geological surfaces (sorted top → deep at a
        sampled point) frames one band.  The surfaces are wrapped as callables
        evaluating the parent model's ``FormationSurfaceOrm`` TINs, so a band's
        top is surface ``k`` and its base is surface ``k+1``; the deepest
        surface's band extends to the model's deep base (handled by the loft's
        domain clip — here the deepest band's base callable returns the deepest
        surface elevation, and the domain's ``deep_base_at`` provides the floor).

        Parameters
        ----------
        model : GeologicalModelOrm
            The lithostratigraphic model whose parent supplies the surfaces.

        Returns
        -------
        list[BandSurface]
            ``N + 1`` bands for ``N`` geological surfaces (the surfaces split
            the domain into above / between / below slices); empty when there
            is no parent model or it has no surfaces.

        Notes
        -----
        Geology-prevails (owner directive 2026-06-11): litho never crosses a
        band boundary.  The loft field clips each per-column stack to these
        bands and fills any uncovered band volume with the band itself.  The
        outermost bands use ±``_BAND_SENTINEL_M`` for their open bound; the
        loft's ``_clip_to_domain`` then trims those to the real ground top /
        deep base.  A single surface therefore yields TWO bands (above + below
        it), not zero — the case the per-consecutive-pair rule missed.
        """
        parent_id = model.parent_geological_model_id
        if parent_id is None:
            return []

        surfaces = await GeologyRepository(self._session).list_surfaces(parent_id)
        tins: list[tuple[str, TinSurface]] = [
            (
                str(s.formation_id),
                TinSurface(
                    vertices=[tuple(v) for v in s.vertices],
                    triangles=[tuple(t) for t in s.triangles],
                ),
            )
            for s in surfaces
        ]
        if not tins:
            # No surfaces → no bands; the loft runs unbounded (the domain's
            # top/deep-base still clip it).
            return []

        # Surfaces are not globally ordered (different formations may cross), so
        # each band's bound callables sample ALL surfaces at (x, y) and pick the
        # k-th / (k+1)-th by elevation — robust to crossing TINs.  Band k spans
        # boundary k-1 (above) → boundary k (below); the top of band 0 and the
        # base of band N are the open ±sentinel the domain clip later trims.
        #
        # Every surface contributes a FINITE elevation at every (x, y): when the
        # query is outside a surface's TIN footprint the nearest TIN vertex is
        # used (mirroring ``ModelDomain.top_at`` / ``deep_base_at``).  Without
        # this fallback a node just past a surface's footprint would lose that
        # boundary, so a band would swallow the whole column there and a body
        # could span the boundary — exactly the geology-prevails violation the
        # bands exist to prevent.  The boundary count is therefore CONSTANT (N)
        # across the whole domain.
        def _surface_elev(tin: TinSurface, x: float, y: float) -> float:
            """Surface elevation at (x, y); nearest-vertex fallback off-footprint."""
            e = evaluate_tin_at(tin, x, y)
            if e is not None:
                return e
            best_d = math.inf
            best_e = 0.0
            for vx, vy, vz in tin.vertices:
                d = (vx - x) ** 2 + (vy - y) ** 2
                if d < best_d:
                    best_d = d
                    best_e = vz
            return best_e

        def _sorted_elevs(x: float, y: float) -> list[float]:
            """Every surface's elevation at (x, y), sorted high → low (all finite)."""
            es = [_surface_elev(tin, x, y) for _fid, tin in tins]
            es.sort(reverse=True)
            return es

        def _make_band(k: int, fid: str) -> BandSurface:
            """Band ``k``: top = boundary ``k-1`` (or +sentinel), base = boundary ``k``."""

            def top_at(x: float, y: float, _k: int = k) -> float:
                es = _sorted_elevs(x, y)
                if _k == 0:
                    return _BAND_SENTINEL_M  # open top → trimmed to ground later
                return es[_k - 1] if _k - 1 < len(es) else -_BAND_SENTINEL_M

            def base_at(x: float, y: float, _k: int = k) -> float:
                es = _sorted_elevs(x, y)
                if _k >= len(es):
                    return -_BAND_SENTINEL_M  # open base → trimmed to deep base later
                return es[_k]

            return BandSurface(formation_id=fid, top_elev_at=top_at, base_elev_at=base_at)

        # N surfaces → N + 1 bands.  Band 0's formation is the topmost surface's
        # (the body beneath each top surface, per the geological convention); the
        # deepest band reuses the deepest surface's formation as its filler colour.
        n = len(tins)
        bands: list[BandSurface] = [_make_band(k, tins[min(k, n - 1)][0]) for k in range(n + 1)]
        return bands
