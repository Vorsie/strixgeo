"""Assemble the implicit-stratigraphic builder's domain inputs from the DB.

This is the application-layer bridge between the persisted lithostratigraphic
model and the pure strat-field domain services (``stratigraphic_order`` →
``control_data`` → ``strat_builder``).  It owns the DB reads — the accepted
body-assigned litho picks (via ``LithoLayerRepository.load_body_picks``) — and
turns them into the value objects the strat builder expects, WITHOUT leaking any
ORM object across the layer boundary.

Mapping (spec ``2026-06-13-implicit-stratigraphic-3d-builder-design.md``, Task 8)
--------------------------------------------------------------------------------
Each :class:`~groundmodel.domain.services.litho_body_pick.BodyLayerPick` is one
member-layer of a resolver body at one investigation.  Grouped by investigation
and sorted top→bottom, the picks become:

* a **Stage-1 column** — a ``tuple[OrderInputUnit, ...]`` per investigation.  The
  topo-sort over the union of columns yields the global stratigraphic order.
* a **Stage-2 column** — an :class:`InvestigationColumn` carrying the same units
  plus the investigation's ``(x, y, surface_elev_m)`` so each contact projects to
  an elevation control point.

The two stages share a **synthetic contact_id** per pick
(``f"{investigation_id}|{body_id}|{top_depth_m:.4f}"``) so the order's
``contact_ids`` line up exactly with the Stage-2 control observations.  The
``instance_key`` is the resolver ``body_id`` — correlated layers across
investigations share it, so they collapse to ONE stratigraphic instance (the
design: a correlated unit is one body lofted across the section).

Section-drawn contacts are NOT threaded in v1 — the borehole/CPT contacts
constrain the field directly; ``section_contacts=[]`` is passed.  Adding drawn
section contacts is a later refinement (it needs the per-section partition's
contact polylines mapped onto strat horizon ids).

The ``domain`` Block reuses the loft pipeline's ``build_model_domain`` (alpha
hull + DEM top + deep base — pure geometry, NOT geological band coupling) to get
the footprint hull, then frames it vertically with a small margin so the caps sit
just outside the data.

Per-band path (Task 8 wiring)
------------------------------
When the litho model has a parent geological model WITH built, non-stale surfaces,
:meth:`AssembleStratInputs.assemble_with_geo` builds per geological band:

1. The full-domain hull :class:`Block` is built ONCE via ``_build_domain`` — the
   shared polygon ensures the per-band :class:`Block` objects produce bit-identical
   grids (the Task-7 watertight-seam contract).
2. Each band's picks are assembled independently (Stage-1 order → Stage-2 control
   → lens partition → lens carve inputs) so lenses inside one band stay inside it.
3. Bands with fewer than 2 picks (no internal contact) produce no output — they are
   skipped and logged at INFO.
4. The result is a :class:`StratAssemblyPerBand` carrying the band list ready for
   ``build_strat_model_per_band`` (Task 7's builder).  The single-flat-block path
   is unchanged (no parent geo model / no surfaces → :class:`StratAssembly`).

``RecomputeLithoSolids`` consumes the result.
"""

from __future__ import annotations

import hashlib
import math
import struct
from collections import defaultdict
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.domain.services.litho_body_pick import BodyLayerPick
from groundmodel.domain.services.model_domain import DomainTest, build_model_domain
from groundmodel.domain.services.strat_field.control_data import (
    ContactObservation,
    InvestigationColumn,
    build_control_data,
)
from groundmodel.domain.services.strat_field.geo_blocks import (
    band_blocks,
    partition_picks_by_geology,
)
from groundmodel.domain.services.strat_field.lens_carving import LensCarveInput
from groundmodel.domain.services.strat_field.lens_classification import classify_lenses
from groundmodel.domain.services.strat_field.lens_geometry import build_lens_carve_inputs
from groundmodel.domain.services.strat_field.lens_types import LensPartition
from groundmodel.domain.services.strat_field.strat_builder import BandBuildInput
from groundmodel.domain.services.strat_field.strat_types import (
    Block,
    StratControlData,
    SurfaceBound,
)
from groundmodel.domain.services.strat_field.stratigraphic_order import (
    OrderInputUnit,
    build_stratigraphic_order,
)
from groundmodel.domain.value_objects.tin_surface import TinSurface
from groundmodel.infrastructure.db.repositories.geology_repository import GeologyRepository
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# Default build-grid spacing (metres) the lens carve inputs are sampled on, used
# only when ``assemble`` is called WITHOUT an explicit spacing (the unit-test
# convenience path).  In production ``RecomputeLithoSolids`` reads the project's
# ``strat_grid_spacing_m`` pref and passes it through, so the lens carve grid
# MATCHES the matrix body-assembly grid exactly — the shared-grid watertight
# contract.  Mirrors ``RecomputeLithoSolids._DEFAULT_STRAT_GRID_SPACING_M``.
_DEFAULT_BUILD_GRID_SPACING_M: float = 1.0

# Vertical margin (metres) added above the highest surface and below the deepest
# pick base so the strat builder's flat top / base caps sit just OUTSIDE the data
# rather than slicing through the shallowest / deepest control point.  1 m is well
# below contact resolution and comfortably clears float-accumulation noise.
_DOMAIN_VERTICAL_MARGIN_M: float = 1.0

# Horizontal margin (metres) the alpha-hull ring is inflated OUTWARD (away from
# its centroid).  The strat builder samples the field on a regular grid and keeps
# only grid CELLS whose four corners all fall inside the domain polygon; the bare
# alpha hull passes exactly through the outermost tests, so with a sparse test set
# (e.g. a 3-point hull = a tight triangle) almost no full cell fits inside and the
# bodies come back empty.  Inflating the ring a few metres past the data gives the
# grid interior cells to fill — the lateral analogue of the vertical cap margin —
# without distorting the hull shape.  10 m sits just past typical investigation
# spacing while staying tight to the data footprint.
_DOMAIN_HORIZONTAL_MARGIN_M: float = 10.0

# Snap tolerance (metres) for the geology-bounded pick partition: a geological
# surface within this distance of a pick's top or base is treated as coincident
# (snap, no cut), so the observed litho contact stands in for the divider and no
# spurious thin sliver is created.  0.20 m matches the litho↔geology snap
# tolerance the section editor defaults to (``view_state.litho_segmenter.
# litho_snap_tolerance_m``) and is good enough for the per-band partition.
_GEO_SNAP_TOLERANCE_M: float = 0.20

# Minimum number of picks in a band to attempt a build.  A single pick gives ONE
# stratigraphic instance — no internal horizon, no control point, nothing for the
# field to interpolate.  Two or more picks at the same formation give the field at
# least one contact pair to anchor the iso.  Bands below this threshold are skipped.
_MIN_BAND_PICKS: int = 2


def _inflate_ring(
    ring: list[tuple[float, float]], margin_m: float
) -> tuple[tuple[float, float], ...]:
    """Push each polygon vertex outward from the ring centroid by ``margin_m``.

    Keeps the ring's SHAPE (each vertex moves radially out from the centroid) so
    the inflated polygon still honours the hull's concavities, just a few metres
    larger.  A degenerate (zero-length) radial for a vertex coincident with the
    centroid is left in place.

    Parameters
    ----------
    ring : list[tuple[float, float]]
        The alpha-hull ring (no repeated last vertex).
    margin_m : float
        Outward offset in metres.

    Returns
    -------
    tuple[tuple[float, float], ...]
        The inflated ring.
    """
    if not ring:
        return ()
    cx = sum(p[0] for p in ring) / len(ring)
    cy = sum(p[1] for p in ring) / len(ring)
    out: list[tuple[float, float]] = []
    for x, y in ring:
        dx, dy = x - cx, y - cy
        dist = math.hypot(dx, dy)
        if dist < 1e-9:
            out.append((x, y))
            continue
        out.append((x + dx / dist * margin_m, y + dy / dist * margin_m))
    return tuple(out)


def _synthetic_contact_id(pick: BodyLayerPick) -> str:
    """Build the per-pick synthetic contact id shared by both build stages.

    The id must be identical in the Stage-1 ``OrderInputUnit`` and the Stage-2
    ``ContactObservation`` for the same pick so the order's ``contact_ids`` index
    resolves the control point's horizon rank.  Keyed by investigation + body +
    rounded top depth, it is unique per observed contact at an investigation.

    Parameters
    ----------
    pick : BodyLayerPick
        The body member-layer pick.

    Returns
    -------
    str
        ``"{investigation_id}|{body_id}|{top_depth_m:.4f}"``.
    """
    return f"{pick.investigation_id}|{pick.body_id}|{pick.top_depth_m:.4f}"


@dataclass(frozen=True)
class StratAssembly:
    """The assembled implicit-stratigraphic builder inputs (single flat block).

    Attributes
    ----------
    control : StratControlData
        The Stage-2 control data (its ``.column`` carries the Stage-1 order),
        ready for ``build_strat_model``.
    domain : Block
        The model block framing the solid build (alpha-hull footprint + vertical
        span).  Passed as both the solid ``domain`` and the single field-fit
        block in v1.
    lens_partition : LensPartition
        The matrix/lens split of all bodies.  Its ``matrix_body_ids`` filtered the
        Stage-1 order (so an enclosed-lens over-merge no longer cycles); its
        ``lenses`` are the enclosed minorities carved back in after the matrix
        bodies are assembled.  Empty ``lenses`` for a conformable model.
    lens_carve_inputs : list of LensCarveInput
        One :class:`LensCarveInput` per lens — its top/base surfaces + footprint
        over the shared build grid — ready for the Task-4 carve step (consumed by
        Task 5b's build).  Empty for a conformable model.
    """

    control: StratControlData
    domain: Block
    lens_partition: LensPartition
    lens_carve_inputs: list[LensCarveInput]


@dataclass(frozen=True)
class StratAssemblyPerBand:
    """The assembled inputs for the geology-bounded per-band build path.

    Produced by :meth:`AssembleStratInputs.assemble_with_geo` when a parent
    geological model has built surfaces.  Consumed by
    ``RecomputeLithoSolids.execute`` which calls ``build_strat_model_per_band``.

    Attributes
    ----------
    bands : list[BandBuildInput]
        One entry per geological band with picks, ordered shallowest → deepest.
        Empty bands (fewer than ``_MIN_BAND_PICKS`` picks) are omitted.
    domain : Block
        The full-domain hull block (same polygon shared across ALL bands so the
        per-band grids are bit-identical → watertight cross-band seam).  Kept
        for the checksum path and orphan-delete bookkeeping.
    geo_surface_digest : bytes
        BLAKE2b-16 digest of the geological surfaces' vertex + triangle geometry.
        The build checksum folds this in so a geo-surface change forces a rebuild.
    """

    bands: list[BandBuildInput]
    domain: Block
    geo_surface_digest: bytes


def _digest_surfaces(surfaces: list[SurfaceBound]) -> bytes:
    """BLAKE2b-16 digest of the geological surfaces' mesh geometry.

    Covers every vertex triple + triangle triple in sorted surface order (sorted
    by ``(min_x, min_y)`` of each surface's vertices for determinism when the
    surface load order is DB-arbitrary).  Folded into the build checksum by
    ``RecomputeLithoSolids`` so any geo-surface rebuild forces a litho rebuild.

    Parameters
    ----------
    surfaces : list[SurfaceBound]
        The parent geological model's band surfaces.

    Returns
    -------
    bytes
        16-byte BLAKE2b digest.
    """
    h = hashlib.blake2b(digest_size=16)

    # Sort surfaces by their vertex centroid for determinism across DB load orders.
    def _surface_sort_key(s: SurfaceBound) -> tuple[float, float]:
        if not s.vertices:
            return (0.0, 0.0)
        return (
            sum(v[0] for v in s.vertices) / len(s.vertices),
            sum(v[1] for v in s.vertices) / len(s.vertices),
        )

    for s in sorted(surfaces, key=_surface_sort_key):
        h.update(struct.pack("<I", len(s.vertices)))
        for x, y, z in s.vertices:
            h.update(struct.pack("<ddd", x, y, z))
        h.update(struct.pack("<I", len(s.triangles)))
        for i, j, k in s.triangles:
            h.update(struct.pack("<III", i, j, k))
    return h.digest()


def _build_stage1_stage2(
    picks: list[BodyLayerPick],
) -> tuple[list[tuple[OrderInputUnit, ...]], list[InvestigationColumn]]:
    """Build Stage-1 columns (order) and Stage-2 columns (control) from picks.

    Shared by the single-block and per-band assembly paths — both convert a flat
    pick list through the same two-stage mapping.  The ``picks`` list is assumed
    to be already grouped for one domain (the full model, or one band).

    Parameters
    ----------
    picks : list[BodyLayerPick]
        Body-assigned picks, all at investigations in the same domain scope.

    Returns
    -------
    (list[tuple[OrderInputUnit, ...]], list[InvestigationColumn])
        Stage-1 columns and Stage-2 columns, one entry per investigation.
    """
    by_inv: dict[str, list[BodyLayerPick]] = defaultdict(list)
    for p in picks:
        by_inv[p.investigation_id].append(p)
    for inv_id in by_inv:
        by_inv[inv_id].sort(key=lambda x: x.top_depth_m)

    stage1_columns: list[tuple[OrderInputUnit, ...]] = []
    stage2_columns: list[InvestigationColumn] = []
    for inv_id, inv_picks in by_inv.items():
        anchor = inv_picks[0]
        order_units: list[OrderInputUnit] = []
        obs_units: list[ContactObservation] = []
        for p in inv_picks:
            cid = _synthetic_contact_id(p)
            order_units.append(
                OrderInputUnit(
                    instance_key=p.body_id,
                    formation_id=p.formation_id,
                    contact_id=cid,
                )
            )
            obs_units.append(
                ContactObservation(
                    instance_key=p.body_id,
                    formation_id=p.formation_id,
                    contact_id=cid,
                    top_depth_m=p.top_depth_m,
                )
            )
        stage1_columns.append(tuple(order_units))
        stage2_columns.append(
            InvestigationColumn(
                investigation_id=inv_id,
                x=anchor.x_m,
                y=anchor.y_m,
                surface_elev_m=anchor.surface_elev_m,
                units=tuple(obs_units),
            )
        )
    return stage1_columns, stage2_columns


class AssembleStratInputs(GroundModelLogger):
    """Assemble the strat-field builder inputs for one lithostratigraphic model.

    Takes the already-loaded body-assigned picks and returns pure value objects.
    The caller (``RecomputeLithoSolids``) owns the session + transaction boundary
    and has already run ``ResolveLithoInstances`` so ``body_id`` stamps are
    current before the picks are loaded.

    Parameters
    ----------
    session : AsyncSession
        Active SQLAlchemy async session (used for geo-surface DB reads on the
        per-band path; held for future DEM-sampling hooks on the flat path).
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    def assemble(
        self,
        picks: list[BodyLayerPick],
        grid_spacing_m: float = _DEFAULT_BUILD_GRID_SPACING_M,
    ) -> StratAssembly | None:
        """Map the model's body picks to the strat builder's control + domain.

        Pure, synchronous mapping over an already-loaded pick set (no DB read —
        the caller loads picks once and shares them with the checksum + the
        no-picks short-circuit).  Returns ``None`` when the picks cannot frame a
        3-D domain (fewer than 3 non-collinear investigations, or no
        deep-reaching test) — the caller flags every body in that case.

        The picks are classified into a MATRIX backbone plus enclosed LENSES
        (:func:`classify_lenses`) BEFORE the order is built: only the matrix
        body ids drive ``build_stratigraphic_order``, so an over-merged model
        whose host body is recorded both above AND below a minority (a 2-cycle
        on a single iso-order) becomes conformable.  The classified lenses are
        turned into per-lens carve inputs (surfaces + footprint over the shared
        build grid) for the Task-5b carve step.

        Parameters
        ----------
        picks : list[BodyLayerPick]
            The model's accepted body-assigned picks (one per member-layer).
        grid_spacing_m : float, optional
            The build-grid spacing the lens carve surfaces are sampled on.  MUST
            match the spacing the matrix body assembly uses (the shared-grid
            watertight contract) — ``RecomputeLithoSolids`` passes the project's
            ``strat_grid_spacing_m`` pref.  Defaults to
            ``_DEFAULT_BUILD_GRID_SPACING_M`` for the unit-test convenience path.

        Returns
        -------
        StratAssembly | None
            The control data + domain block + lens partition + carve inputs, or
            ``None`` when the domain is unbuildable.

        Raises
        ------
        NonConformableError
            Propagated from ``build_stratigraphic_order`` when the MATRIX
            backbone (after the lenses are carved out) still forms a cycle — a
            true interfingering reversal the v1 builder cannot model.  The caller
            catches this and flags the model.
        LensClassificationError
            Propagated from ``classify_lenses`` when lenses WERE found yet the
            matrix backbone still cycles (the enclosure criterion failed to break
            every cycle).  Task 5b's caller must handle this; for now it surfaces
            so the model is flagged rather than silently mis-built.
        ValueError
            Propagated from ``build_stratigraphic_order`` on an inconsistent
            ``instance_key`` → ``formation_id`` mapping (a data-model bug).
        """
        self.info(f"AssembleStratInputs: {len(picks)} pick(s)")

        domain = self._build_domain(picks)
        if domain is None:
            self.warning(
                "AssembleStratInputs: domain unbuildable "
                f"({len({p.investigation_id for p in picks})} investigation(s)) "
                "— caller will flag every body"
            )
            return None

        stage1_columns, stage2_columns = _build_stage1_stage2(picks)

        partition = classify_lenses(stage1_columns)
        self.info(
            f"AssembleStratInputs: {len(partition.lenses)} lens(es), "
            f"{len(partition.matrix_body_ids)} matrix body(ies)"
        )

        order = build_stratigraphic_order(stage1_columns, matrix_body_ids=partition.matrix_body_ids)
        control = build_control_data(stage2_columns, section_contacts=[], order=order)

        picks_by_body: dict[str, list[BodyLayerPick]] = defaultdict(list)
        for p in picks:
            picks_by_body[p.body_id].append(p)
        lens_carve_inputs = build_lens_carve_inputs(
            partition, dict(picks_by_body), domain, grid_spacing_m
        )

        self.success(
            f"AssembleStratInputs: {len(stage2_columns)} column(s), "
            f"{len(order.horizons)} horizon(s), {len(control.points)} control point(s), "
            f"{len(lens_carve_inputs)} lens carve input(s)"
        )
        return StratAssembly(
            control=control,
            domain=domain,
            lens_partition=partition,
            lens_carve_inputs=lens_carve_inputs,
        )

    async def assemble_with_geo(
        self,
        picks: list[BodyLayerPick],
        parent_geo_model_id: UUID,
        grid_spacing_m: float = _DEFAULT_BUILD_GRID_SPACING_M,
    ) -> StratAssemblyPerBand | None:
        """Assemble per-geological-band when a parent geo model has built surfaces.

        Loads the parent geological model's cached TIN surfaces from the DB,
        partitions the picks by geological band (snap-or-divide), builds the
        shared domain hull once, derives one surface-bounded :class:`Block` per
        band (Task 6's ``band_blocks``), and assembles the Stage-1/2 pipeline
        per band (Stage-1 order → Stage-2 control → lens classification → lens
        carve inputs), filtering out bands with too few picks to be buildable.

        Returns ``None`` when the full-domain hull is unbuildable (same semantics
        as :meth:`assemble`).  Returns a :class:`StratAssemblyPerBand` with an
        empty ``bands`` list when every band is too sparse (the caller falls back
        to the flag-all path).

        Parameters
        ----------
        picks : list[BodyLayerPick]
            The model's accepted body-assigned picks.
        parent_geo_model_id : UUID
            The parent geological model whose ``formation_surface`` rows supply
            the geological band surfaces.
        grid_spacing_m : float, optional
            Build-grid spacing (same value passed to the matrix and lens carve
            paths so all grids are bit-identical — the watertight seam contract).

        Returns
        -------
        StratAssemblyPerBand | None
            Per-band assembly, or ``None`` when the domain is unbuildable.

        Raises
        ------
        NonConformableError
            Propagated from any band's ``build_stratigraphic_order`` call when the
            band's MATRIX backbone still cycles after lens extraction.  The caller
            catches this and flags the whole model.
        LensClassificationError
            Propagated from any band's ``classify_lenses`` when lenses were found
            yet the matrix still cycles.
        ValueError
            Propagated from ``build_stratigraphic_order`` on an inconsistent
            ``instance_key`` → ``formation_id`` mapping.
        """
        self.info(
            f"AssembleStratInputs.assemble_with_geo: {len(picks)} pick(s) "
            f"parent_geo={parent_geo_model_id}"
        )

        # Load the parent geo model's built surfaces.
        surfaces = await self._load_geo_surfaces(parent_geo_model_id)
        if not surfaces:
            self.info(
                "AssembleStratInputs.assemble_with_geo: no built surfaces on parent geo model "
                f"{parent_geo_model_id} — falling back to single-flat-block path"
            )
            return None

        geo_surface_digest = _digest_surfaces(surfaces)
        self.info(
            f"AssembleStratInputs.assemble_with_geo: {len(surfaces)} geological surface(s) loaded"
        )

        # Build the FULL-domain hull ONCE — its polygon is shared across all bands
        # so ``build_shared_grid`` yields bit-identical gx/gy for every band call
        # (the Task-7 watertight-seam contract: shared polygon → shared grid →
        # per-band caps byte-identical at the dividing surface).
        domain = self._build_domain(picks)
        if domain is None:
            self.warning(
                "AssembleStratInputs.assemble_with_geo: domain unbuildable — "
                "caller will flag every body"
            )
            return None

        # Partition picks by geological band (snap-or-divide at each surface).
        picks_by_band = partition_picks_by_geology(picks, surfaces, _GEO_SNAP_TOLERANCE_M)
        all_band_indices = sorted(picks_by_band.keys())
        self.info(
            f"AssembleStratInputs.assemble_with_geo: {len(all_band_indices)} band(s) "
            f"with picks after partition: {all_band_indices}"
        )

        # One surface-bounded Block per band — same hull polygon across all bands.
        blocks = band_blocks(surfaces, domain.polygon, domain.z_min, domain.z_max)
        # blocks[k] corresponds to geological band index k; if the partition has
        # more band indices than blocks (shouldn't happen on valid data but guard
        # defensively), cap at block count.
        n_blocks = len(blocks)

        bands: list[BandBuildInput] = []
        for band_idx in all_band_indices:
            band_picks = picks_by_band[band_idx]
            n_band_picks = len(band_picks)

            if n_band_picks < _MIN_BAND_PICKS:
                self.info(
                    f"  [band {band_idx}] skipped — only {n_band_picks} pick(s) "
                    f"(need ≥{_MIN_BAND_PICKS} for an internal contact)"
                )
                continue

            if band_idx >= n_blocks:
                # Defensive: a band index beyond the block list means the partition
                # produced a band the geo surfaces don't cover (shouldn't happen).
                self.warning(
                    f"  [band {band_idx}] skipped — band index ≥ block count ({n_blocks}); "
                    "geo surfaces may not fully cover the pick footprint"
                )
                continue

            block = blocks[band_idx]

            # Stage-1 + Stage-2 for this band.
            stage1_columns, stage2_columns = _build_stage1_stage2(band_picks)

            # Lens classification within the band (each band is a subgraph of the
            # global DAG — the lens-out already guarantees the matrix is acyclic
            # WITHIN each band after geology-bounded partitioning resolves
            # cross-band over-merges).
            partition = classify_lenses(stage1_columns)

            n_inv = len(stage2_columns)
            self.info(
                f"  [band {band_idx}] {n_band_picks} pick(s), {n_inv} investigation(s), "
                f"{len(partition.lenses)} lens(es), "
                f"{len(partition.matrix_body_ids)} matrix body(ies)"
            )

            # May raise NonConformableError / ValueError — propagated to the caller.
            order = build_stratigraphic_order(
                stage1_columns, matrix_body_ids=partition.matrix_body_ids
            )
            control = build_control_data(stage2_columns, section_contacts=[], order=order)

            picks_by_body: dict[str, list[BodyLayerPick]] = defaultdict(list)
            for p in band_picks:
                picks_by_body[p.body_id].append(p)

            # Use the BAND block (not the full domain) for the lens carve inputs
            # so the lens footprint is evaluated against the band's grid — same
            # polygon as the domain but surface-bounded, so the carve stays in band.
            lens_carve_inputs = build_lens_carve_inputs(
                partition, dict(picks_by_body), block, grid_spacing_m
            )

            self.info(
                f"  [band {band_idx}] {len(order.horizons)} horizon(s), "
                f"{len(control.points)} control point(s), "
                f"{len(lens_carve_inputs)} lens carve input(s)"
            )

            band_input: BandBuildInput = {
                "control": control,
                "block": block,
            }
            if lens_carve_inputs:
                band_input["lens_inputs"] = lens_carve_inputs

            bands.append(band_input)

        self.success(
            f"AssembleStratInputs.assemble_with_geo: {len(bands)} buildable band(s) "
            f"of {len(all_band_indices)} with picks"
        )
        return StratAssemblyPerBand(
            bands=bands,
            domain=domain,
            geo_surface_digest=geo_surface_digest,
        )

    # -----------------------------------------------------------------
    # Domain block
    # -----------------------------------------------------------------

    def _build_domain(self, picks: list[BodyLayerPick]) -> Block | None:
        """Frame the strat builder's :class:`Block` from the picks' geometry.

        Builds the loft pipeline's :class:`ModelDomain` (alpha-hull footprint +
        DEM top + deep base — pure geometry, NOT geological band coupling), then
        converts its hull polygon + the picks' elevation extents into a
        :class:`Block` with a small vertical margin so the caps sit just outside
        the data.

        One :class:`DomainTest` is emitted per investigation; its
        ``surface_elev_m`` is the anchor surface and its ``base_elev_m`` is the
        deepest member-layer base elevation at that investigation (the depth
        constraint the domain's deep-base surface interpolates through).

        Parameters
        ----------
        picks : list[BodyLayerPick]
            The model's body picks.

        Returns
        -------
        Block | None
            The domain block, or ``None`` when ``build_model_domain`` cannot
            frame a 3-D domain (fewer than 3 tests, collinear, or no
            deep-reaching test — its ``ValueError`` paths).
        """
        surf_by_inv: dict[str, tuple[float, float]] = {}
        elev_by_inv: dict[str, float] = {}
        deepest_base_by_inv: dict[str, float] = {}
        for p in picks:
            base_e = p.surface_elev_m - p.base_depth_m
            surf_by_inv[p.investigation_id] = (p.x_m, p.y_m)
            elev_by_inv[p.investigation_id] = p.surface_elev_m
            cur = deepest_base_by_inv.get(p.investigation_id)
            if cur is None or base_e < cur:
                deepest_base_by_inv[p.investigation_id] = base_e

        tests = [
            DomainTest(
                test_id=inv_id,
                x_m=surf_by_inv[inv_id][0],
                y_m=surf_by_inv[inv_id][1],
                surface_elev_m=elev_by_inv[inv_id],
                base_elev_m=deepest_base_by_inv[inv_id],
            )
            for inv_id in surf_by_inv
        ]

        try:
            # No geological band reference → the no-geo deep-reaching fallback
            # (deepest-overall threshold) is used; geology coupling stays OUT of
            # the litho model (spec owner directive 2026-06-13).
            model_domain = build_model_domain(tests, lowest_band_elev_at=None)
        except ValueError as err:
            self.warning(f"AssembleStratInputs: build_model_domain failed — {err}")
            return None

        z_min = min(deepest_base_by_inv.values()) - _DOMAIN_VERTICAL_MARGIN_M
        z_max = max(elev_by_inv.values()) + _DOMAIN_VERTICAL_MARGIN_M

        polygon = _inflate_ring(list(model_domain.polygon), _DOMAIN_HORIZONTAL_MARGIN_M)

        return Block(
            polygon=polygon,
            z_min=z_min,
            z_max=z_max,
        )

    # -----------------------------------------------------------------
    # Geo-surface loader
    # -----------------------------------------------------------------

    async def _load_geo_surfaces(self, parent_geo_model_id: UUID) -> list[SurfaceBound]:
        """Load the parent geological model's built, non-stale surfaces as bounds.

        Reads ``formation_surface`` rows for ``parent_geo_model_id``, skipping
        rows that are stale (not yet rebuilt) or have empty geometry (no vertices).
        Wraps each usable surface as a :class:`SurfaceBound` via
        :meth:`SurfaceBound.from_tin`.

        Parameters
        ----------
        parent_geo_model_id : UUID
            The parent geological model's id.

        Returns
        -------
        list[SurfaceBound]
            Built, non-stale surfaces as band bounds.  Empty when none exist.
        """
        surface_rows = await GeologyRepository(self._session).list_surfaces(parent_geo_model_id)
        bounds: list[SurfaceBound] = []
        for row in surface_rows:
            if row.is_stale:
                self.debug(f"  geo surface formation={row.formation_id} is_stale=True — skipping")
                continue
            if not row.vertices:
                self.debug(f"  geo surface formation={row.formation_id} has no vertices — skipping")
                continue
            tin = TinSurface(
                vertices=[tuple(v) for v in row.vertices],
                triangles=[tuple(t) for t in row.triangles],
            )
            bounds.append(SurfaceBound.from_tin(tin))

        skipped = len(surface_rows) - len(bounds)
        if skipped:
            self.info(
                f"AssembleStratInputs._load_geo_surfaces: {len(bounds)} usable surface(s), "
                f"{skipped} stale/empty skipped"
            )
        return bounds
