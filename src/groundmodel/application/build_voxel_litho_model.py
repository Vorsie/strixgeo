"""Build the 3-D litho-solid cache from the validated 2-D voxel partitions.

This use case replaced the retired implicit strat-field builder
(``RecomputeLithoSolids``, deleted with the ``strat_field`` package — #237;
git history has both).  Where the implicit builder fit a stratigraphic field
through the DB picks, this builder takes the frontend's already-validated 2-D
section partitions (``computeSectionFill``) as the SOURCE OF TRUTH and:

1. Builds a :class:`~groundmodel.domain.services.model_domain.ModelDomain` from
   the section columns' world positions (the footprint that gates labelling) —
   via ``build_domain_from_sections``.  The payload is self-contained; NO
   database picks are loaded for the domain.
2. Labels a regular 3-D voxel grid from the partitions
   (:func:`~groundmodel.domain.services.voxel_litho.label_voxels.label_voxels`):
   every voxel carries the body that fills it.  A labelling of space is itself a
   partition, so the extracted boundaries are watertight AND faithful by
   construction (interfingering / pinch-out is representable — the implicit
   field could not do this).
3. Extracts each body's greedy-meshed watertight boundary
   (:func:`~groundmodel.domain.services.voxel_litho.extract_body_solids.extract_body_solids`).
4. Upserts each mesh into ``litho_body_solid`` (method ``"voxel"``) via the
   shared :class:`~groundmodel.application.litho_solid_persistence.LithoSolidPersistenceMixin`,
   orphan-deletes rows no longer built, and commits once.

Checksum
--------
The build is GLOBAL (one labelling of the whole grid), so the checksum is
model-level: a single digest over the section partition payload (every region's
formation / body / polygon / gap + every column's world position) plus the grid
spacing.  When the digest matches every stored row AND ``force`` is False the
whole rebuild is skipped.  The on-click Build passes ``force=True``.

Honor-borehole
--------------
The section blend at an investigation's TRUE map ``(x, y)`` can disagree with
the investigation's own observed log, because a borehole feeds a section at its
PROJECTED foot on the section line — usually metres off its true position.  So
this use case ALSO loads the model's resolved picks
(:meth:`LithoLayerRepository.load_body_picks`) and builds one
:class:`~groundmodel.domain.services.voxel_litho.voxel_types.InvestigationColumn`
per investigation; ``label_voxels`` then labels each investigation's own grid
column from its OWN log within its observed depth range (the section blend still
fills above the log's top / below its base, so a shallow log punches no hole).
The picks' ``body_id`` is the resolved value, so the honored voxels group with
the matching section-partition bodies.

What this use case deliberately does NOT do
------------------------------------------
* It does NOT run ``ResolveLithoInstances`` (unlike the retired implicit
  builder): the payload's ``body_id`` values — and the picks' ``body_id`` (which
  ``load_body_picks`` reflects from the resolver) — ALREADY reflect the resolved
  state, so re-resolving could desync the 3-D model from the 2-D partition the
  user validated.  The frontend is the single source of body identity here.

Domain-layer purity is preserved: the API converts its Pydantic request into the
frozen domain value objects (``SectionPartitionInput``) before calling
``execute``; this use case only sees value objects.
"""

from __future__ import annotations

import hashlib
import struct
import time
from collections import defaultdict
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.litho_solid_persistence import (
    LithoSolidPersistenceMixin,
    LithoSolidsOutcome,
    _SolidMeta,
    storage_body_id,
)
from groundmodel.application.load_geo_surfaces import digest_surfaces, load_geo_surfaces
from groundmodel.application.view_state_helpers import (
    load_project_view_state,
    read_view_state_float,
)
from groundmodel.domain.services.litho_body_pick import BodyLayerPick
from groundmodel.domain.services.surface_bound import SurfaceBound
from groundmodel.domain.services.voxel_litho.build_domain_from_sections import (
    build_domain_from_sections,
)
from groundmodel.domain.services.voxel_litho.extract_body_solids import extract_body_solids
from groundmodel.domain.services.voxel_litho.label_voxels import label_voxels
from groundmodel.domain.services.voxel_litho.voxel_types import (
    InvestigationColumn,
    SectionPartitionInput,
)
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.repositories.litho_layer_repository import LithoLayerRepository
from groundmodel.shared.timing import phase_timer

# Default litho↔geology snap tolerance (metres) when the project view-state does
# not configure one — mirrors the section editor's
# ``view_state.litho_segmenter.litho_snap_tolerance_m`` default.
_DEFAULT_LITHO_SNAP_TOLERANCE_M: float = 0.20


def _partition_checksum(
    sections: list[SectionPartitionInput],
    grid_spacing_m: float,
    investigation_columns: tuple[InvestigationColumn, ...] = (),
    geo_surfaces: tuple[SurfaceBound, ...] = (),
    *,
    vertical_spacing_m: float | None = None,
) -> bytes:
    """Model-wide BLAKE2b-16 digest over the voxel build inputs.

    The voxel build is a single global labelling of the grid, so the digest is
    model-level (not per-body): any change to a region's lithology / body /
    polygon, a column's world position, the section line, the grid spacing, OR
    a honored investigation's observed log moves the labelling and must bust the
    cache.

    The digest folds in, deterministically (sections in payload order, regions
    and columns in their payload order — both are stable for an unchanged
    payload; investigation columns pre-sorted by ``investigation_id``):

    * the (horizontal / cubic) grid spacing,
    * the vertical spacing, ONLY when an anisotropic build is requested
      (``vertical_spacing_m`` is not ``None``) — so a cubic build's digest is
      byte-stable with the pre-anisotropy form (no one-time cache bust), while
      switching the vertical spacing or toggling anisotropy busts the cache,
    * each section's line endpoints,
    * each column's investigation id + world position,
    * each region's formation id + body id (the empty string for ``None``) +
      gap index + every polygon ``(fraction, elevation)`` point,
    * each honored investigation column's id + world position + observed
      intervals (so a pick change rebuilds — see
      :func:`_investigation_columns_checksum`),
    * the parent geological model's band-surface geometry digest (so a geo
      rebuild that moves a band busts the voxel cache — see
      :func:`~groundmodel.application.load_geo_surfaces.digest_surfaces`).

    Parameters
    ----------
    sections : list of SectionPartitionInput
        The section partitions (the build payload).
    grid_spacing_m : float
        The voxel grid spacing.
    investigation_columns : tuple of InvestigationColumn, optional
        The honored per-investigation observed columns (loaded from the DB
        picks); defaults to ``()`` (no honoring → digest unchanged from the
        section-only form for that case).
    vertical_spacing_m : float or None, optional
        The anisotropic Z spacing.  ``None`` (the cubic case) is NOT folded in,
        so the cubic digest is byte-stable with the pre-anisotropy form; a set
        value is folded after a domain-separator byte so an anisotropy change
        rebuilds.
    geo_surfaces : tuple of SurfaceBound, optional
        The parent geological model's built band surfaces.  Folded in (via
        ``digest_surfaces``) after a domain-separator byte so a geo-surface
        change forces a rebuild; defaults to ``()`` (un-bounded → digest
        unchanged from the no-geo form, an empty digest appended).

    Returns
    -------
    bytes
        16-byte BLAKE2b digest.
    """
    h = hashlib.blake2b(digest_size=16)
    h.update(struct.pack("<d", grid_spacing_m))
    # Anisotropy: fold the vertical spacing ONLY when set (after a domain
    # separator), keeping the cubic digest byte-stable with the pre-anisotropy
    # form — a cubic build never re-meshes spuriously, while switching the
    # vertical spacing or toggling anisotropy busts the cache.
    if vertical_spacing_m is not None:
        h.update(b"\x03")
        h.update(struct.pack("<d", vertical_spacing_m))
    for s in sections:
        h.update(struct.pack("<dddd", s.start_x, s.start_y, s.end_x, s.end_y))
        for c in s.columns:
            h.update(c.investigation_id.encode("utf-8"))
            h.update(struct.pack("<ddd", c.along_m, c.world_x, c.world_y))
        for r in s.regions:
            h.update(r.formation_id.encode("utf-8"))
            # body_id may be None (never-correlated minority) — use a sentinel
            # that cannot collide with a real body_id string.
            h.update(b"\x00" if r.body_id is None else r.body_id.encode("utf-8"))
            h.update(struct.pack("<i", r.gap_index))
            for frac, elev in r.polygon:
                h.update(struct.pack("<dd", frac, elev))
    _investigation_columns_checksum(h, investigation_columns)
    # Domain-separator byte before the geo-surface digest so the surface block
    # cannot collide with a trailing investigation-column block.
    h.update(b"\x02")
    h.update(digest_surfaces(list(geo_surfaces)))
    return h.digest()


def _investigation_columns_from_picks(
    picks: list[BodyLayerPick],
) -> tuple[InvestigationColumn, ...]:
    """Group body-assigned picks into per-investigation observed columns.

    Each pick is one member-layer at one investigation; grouped by
    ``investigation_id``, converted from depth to absolute elevation
    (``elevation = surface_elev_m - depth_m``), and ordered top → bottom.  The
    pick's ``body_id`` is the resolver-assigned identity (``load_body_picks``
    reflects the resolver), so the honored voxels group with the matching
    section-partition bodies in the mesher.

    Parameters
    ----------
    picks : list of BodyLayerPick
        Accepted body-assigned picks from
        :meth:`LithoLayerRepository.load_body_picks`.

    Returns
    -------
    tuple of InvestigationColumn
        One column per investigation, ordered by ``investigation_id`` for a
        deterministic checksum, intervals ordered top → bottom.
    """
    by_inv: dict[str, list[BodyLayerPick]] = defaultdict(list)
    for p in picks:
        by_inv[p.investigation_id].append(p)

    columns: list[InvestigationColumn] = []
    for inv_id in sorted(by_inv):
        inv_picks = by_inv[inv_id]
        # Picks at one investigation are assumed depth-ordered top < base (the
        # upstream litho-layer constraint), and may have VERTICAL GAPS — a
        # body-unassigned / rejected layer between two accepted ones is dropped
        # by ``load_body_picks``, so the resulting intervals are not necessarily
        # contiguous.  The honor labeller is gap-aware (an unlogged interval
        # defers to the section blend), so a gap here is correct, not a defect.
        # Surface + world position are per-investigation constants on every pick.
        first = inv_picks[0]
        intervals = tuple(
            sorted(
                (
                    (
                        p.body_id,
                        p.formation_id,
                        p.surface_elev_m - p.top_depth_m,
                        p.surface_elev_m - p.base_depth_m,
                    )
                    for p in inv_picks
                ),
                key=lambda iv: -iv[2],  # descending top elevation = top → bottom
            )
        )
        columns.append(
            InvestigationColumn(
                investigation_id=inv_id,
                world_x=first.x_m,
                world_y=first.y_m,
                intervals=intervals,
            )
        )
    return tuple(columns)


def _investigation_columns_checksum(
    h: hashlib.blake2b, columns: tuple[InvestigationColumn, ...]
) -> None:
    """Fold the honored investigation columns into an open BLAKE2b digest.

    A pick change (a moved contact, a re-assigned body, an added / removed
    layer) must bust the model cache so the on-open / force=false path rebuilds.
    Columns arrive already sorted by ``investigation_id`` (deterministic order);
    each interval is folded in its top → bottom order.

    Parameters
    ----------
    h : hashlib.blake2b
        The open digest being accumulated (mutated in place).
    columns : tuple of InvestigationColumn
        The honored investigation columns to fold in.
    """
    for c in columns:
        h.update(b"\x01")  # domain separator between sections + columns
        h.update(c.investigation_id.encode("utf-8"))
        h.update(struct.pack("<dd", c.world_x, c.world_y))
        for body_id, formation_id, top, base in c.intervals:
            h.update(body_id.encode("utf-8"))
            h.update(formation_id.encode("utf-8"))
            h.update(struct.pack("<dd", top, base))


class BuildVoxelLithoModel(LithoSolidPersistenceMixin):
    """Build + persist the litho 3-D solids from the validated 2-D voxel partitions.

    Persists into the ``litho_body_solid`` cache with the upsert / orphan /
    model-checksum semantics inherited from
    :class:`~groundmodel.application.litho_solid_persistence.LithoSolidPersistenceMixin`,
    taking the frontend section partitions as its input.  The ``method``
    column is stamped ``"voxel"``.

    The caller owns the session; this use case commits once at the end.

    Parameters
    ----------
    session : AsyncSession
        Active SQLAlchemy async session.
    """

    # Stamp ``method="voxel"`` on every persisted solid row (the mixin reads it).
    _solid_method: str = "voxel"

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    async def execute(
        self,
        model_id: UUID,
        sections: list[SectionPartitionInput],
        *,
        grid_spacing_m: float,
        vertical_spacing_m: float | None = None,
        force: bool = False,
    ) -> LithoSolidsOutcome:
        """Label a voxel grid from ``sections`` and upsert the watertight solids.

        Parameters
        ----------
        model_id : UUID
            The lithostratigraphic model to (re)build.
        sections : list of SectionPartitionInput
            The validated 2-D section partitions (the build payload, the source
            of truth for body identity + geometry).
        grid_spacing_m : float
            The HORIZONTAL (X/Y) voxel edge length in metres; also the Z edge
            length when ``vertical_spacing_m`` is ``None`` (the cubic case).  Must
            be positive.
        vertical_spacing_m : float or None, optional
            The Z (elevation) voxel edge length in metres.  ``None`` (the default)
            → a cubic grid (Z uses ``grid_spacing_m``), byte-identical to the
            pre-anisotropy build.  When set, the grid is anisotropic: X/Y step at
            ``grid_spacing_m``, Z at ``vertical_spacing_m`` — a fine Z over a
            coarse X/Y resolves thin geology layers without exploding the X/Y
            voxel count.
        force : bool, default ``False``
            When ``True``, skip the model-level checksum short-circuit and always
            rebuild.  The on-click "Build 3-D model" path passes this so an
            explicit Build always reflects the current builder code.

        Returns
        -------
        LithoSolidsOutcome
            Per-phase counts (``marked_test_ids`` is always empty — the voxel
            path drops no tests).

        Notes
        -----
        Unbuildable inputs (no sections, or a footprint that cannot frame a hull
        — <3 unique non-collinear columns) clear the cache and return a zero
        outcome rather than raising: an empty / degenerate model is a valid
        "nothing to build" state, not an error.

        This use case does NOT run ``ResolveLithoInstances`` — the payload's
        ``body_id`` values already reflect the resolved frontend state.
        """
        self.info(
            f"BuildVoxelLithoModel: model={model_id} sections={len(sections)} "
            f"grid_spacing={grid_spacing_m} vertical_spacing={vertical_spacing_m} force={force}"
        )
        t_total = time.perf_counter()

        if not sections:
            self.warning(f"BuildVoxelLithoModel: model={model_id} — no sections; clearing cache")
            return await self._handle_empty(model_id)

        # --- Phase 1: domain footprint from the section columns ---------------
        try:
            with phase_timer(self, "BuildVoxelLithoModel phase-1 domain"):
                domain = build_domain_from_sections(sections)
        except ValueError as err:
            self.warning(
                f"BuildVoxelLithoModel: model={model_id} domain unbuildable — {err}; "
                "clearing cache (need ≥3 non-collinear columns)"
            )
            return await self._handle_empty(model_id)
        self.debug(
            f"BuildVoxelLithoModel: model={model_id} — domain footprint "
            f"{len(domain.polygon)}-vertex hull"
        )

        # --- Honor each investigation's OWN observed log at its true location --
        # The section blend at a borehole's true (x, y) can disagree with the
        # borehole's own log (it feeds a section at its projected foot, not its
        # true map position).  Load the resolved DB picks and build the per-
        # investigation observed columns so ``label_voxels`` labels those columns
        # from the log itself (within its observed depth range).  ``load_body_picks``
        # already reflects the resolver, so we do NOT run ResolveLithoInstances.
        picks = await LithoLayerRepository(self._session).load_body_picks(model_id)
        investigation_columns = _investigation_columns_from_picks(picks)
        self.info(
            f"BuildVoxelLithoModel: model={model_id} — honoring "
            f"{len(investigation_columns)} investigation column(s) from "
            f"{len(picks)} pick(s)"
        )

        # --- Geo-bound the labelling by the parent geological model's bands ----
        # The litho model is REFINED from a parent geological model; its band
        # surfaces are HARD bounds (a litho body never crosses a geological
        # boundary).  Load them so Task 3's band-scoped labelling can clip to
        # them, and read the snap tolerance the section editor uses.  No parent
        # model / no built surfaces → un-bounded build (the labeller's default).
        parent_geo_model_id = await self._read_parent_geo_model_id(model_id)
        geo_surfaces: tuple[SurfaceBound, ...] = ()
        if parent_geo_model_id is not None:
            geo_surfaces = await load_geo_surfaces(self._session, parent_geo_model_id, logger=self)
        if not geo_surfaces:
            self.warning(
                f"BuildVoxelLithoModel: model={model_id} — no parent geo model / "
                "no built surfaces; building un-bounded"
            )
        snap_tol = await self._read_litho_snap_tolerance_m(model_id)
        self.info(
            f"BuildVoxelLithoModel: model={model_id} — {len(geo_surfaces)} geo "
            f"surface(s), litho_snap_tolerance_m={snap_tol}"
        )

        # --- Early checksum short-circuit (before the expensive Phase 2/3) ----
        # The digest covers the FULL section payload + grid spacing + the honored
        # investigation columns, and the pipeline is deterministic, so a digest
        # match ⟹ identical body set — the same reasoning the strat builder
        # relies on.  Skip labelling + extraction entirely when nothing changed.
        # ``_load_existing`` is cross-method: stale strat rows carry a different
        # (strat) digest, so the ``_digest_matches_all`` set/checksum check is
        # False → no early skip → the build proceeds and orphan-sweeps them in
        # Phase 5.
        new_checksum = _partition_checksum(
            sections,
            grid_spacing_m,
            investigation_columns,
            geo_surfaces,
            vertical_spacing_m=vertical_spacing_m,
        )
        existing_by_body = await self._load_existing(model_id)
        if (
            not force
            and existing_by_body
            and all(
                meta.source_pick_checksum == new_checksum and not meta.is_stale
                for meta in existing_by_body.values()
            )
        ):
            await self._session.commit()
            skipped = len(existing_by_body)
            self.success(
                f"BuildVoxelLithoModel: model={model_id} — checksum unchanged, "
                f"skipped all {skipped} body/bodies (no labelling)"
            )
            return LithoSolidsOutcome(
                bodies_considered=skipped,
                bodies_built=0,
                bodies_skipped_checksum=skipped,
                bodies_flagged=0,
                orphans_deleted=0,
                marked_test_ids=[],
            )

        # --- Phase 2: label the 3-D voxel grid --------------------------------
        try:
            with phase_timer(self, "BuildVoxelLithoModel phase-2 label_voxels"):
                grid = label_voxels(
                    domain,
                    grid_spacing_m,
                    sections,
                    vertical_spacing_m=vertical_spacing_m,
                    investigation_columns=investigation_columns,
                    geo_surfaces=geo_surfaces,
                    litho_snap_tolerance_m=snap_tol,
                )
        except ValueError as err:
            self.warning(
                f"BuildVoxelLithoModel: model={model_id} label_voxels failed — {err}; "
                "clearing cache (no elevation range to grid over)"
            )
            return await self._handle_empty(model_id)
        self.info(
            f"BuildVoxelLithoModel: model={model_id} — labelled "
            f"{len(grid.gx)}x{len(grid.gy)}x{len(grid.gz)} grid, "
            f"{len(grid.body_id_by_index)} body slots"
        )

        # --- Phase 3: extract the greedy-meshed watertight per-body solids ----
        try:
            with phase_timer(self, "BuildVoxelLithoModel phase-3 extract_body_solids"):
                meshes = extract_body_solids(grid)  # greedy=True (production default)
        except Exception as err:
            self.exception(
                f"BuildVoxelLithoModel: model={model_id} extract_body_solids raised "
                f"{type(err).__name__} — {err}"
            )
            raise
        # An empty body slot (no voxel labelled with it) yields no mesh — drop it.
        meshes = [m for m in meshes if m.vertices and m.triangles]
        self.info(f"BuildVoxelLithoModel: model={model_id} — extracted {len(meshes)} body solid(s)")

        if not meshes:
            # The labelling produced no non-empty body (e.g. every voxel void).
            self.warning(
                f"BuildVoxelLithoModel: model={model_id} — labelling produced no body; "
                "clearing cache"
            )
            # Reuse the already-loaded existing rows — ``_handle_empty`` only
            # reads the keys, so no second read is needed for the empty path.
            return await self._handle_empty(model_id, existing_by_body=existing_by_body)

        wanted_storage_ids = {str(storage_body_id(m.body_id)) for m in meshes}
        bodies_considered = len(wanted_storage_ids)

        # --- Phase 4: upsert + orphan-delete + commit -------------------------
        with phase_timer(self, "BuildVoxelLithoModel phase-4 upsert"):
            rows = self._mesh_rows(meshes, model_id, new_checksum)
            bodies_built = len(rows)
            chunks_written = await self._batch_upsert(rows)
            self.info(
                f"BuildVoxelLithoModel: model={model_id} — "
                f"upserted {bodies_built} mesh(es) in {chunks_written} chunk(s)"
            )
            orphans_deleted = await self._delete_orphans(
                model_id, existing_by_body, wanted_storage_ids
            )
            await self._session.commit()

        total_tris = sum(len(m.triangles) for m in meshes)
        total_verts = sum(len(m.vertices) for m in meshes)
        total_elapsed = time.perf_counter() - t_total
        # bodies_flagged is structurally zero on the voxel path: every labelled
        # voxel belongs to a real body (the label grid is a partition by
        # construction), so no empty placeholder rows are written; the field
        # stays for API-shape stability (the retired strat path could flag).
        self.success(
            f"BuildVoxelLithoModel: model={model_id} — "
            f"considered={bodies_considered} built={bodies_built} "
            f"bodies_flagged=0 "
            f"orphans_deleted={orphans_deleted} "
            f"tris={total_tris:,} verts={total_verts:,} "
            f"total=[{total_elapsed:.1f}s]"
        )
        return LithoSolidsOutcome(
            bodies_considered=bodies_considered,
            bodies_built=bodies_built,
            bodies_skipped_checksum=0,
            bodies_flagged=0,
            orphans_deleted=orphans_deleted,
            marked_test_ids=[],
        )

    async def _handle_empty(
        self,
        model_id: UUID,
        existing_by_body: dict[str, _SolidMeta] | None = None,
    ) -> LithoSolidsOutcome:
        """Clear every solid row for the model and return a zero outcome.

        Used when the payload is empty / degenerate (no sections, an unbuildable
        footprint, or a labelling with no body).  An empty model is a valid
        "nothing to build" state, so the cache is emptied (orphan-deleting every
        stored row) rather than raising.

        Parameters
        ----------
        model_id : UUID
            The model whose solids are cleared.
        existing_by_body : dict[str, _SolidMeta] | None
            Already-loaded existing solid rows keyed by body id (the no-mesh
            path has them in hand from the checksum check) — passing them
            skips a second ``_load_existing`` round-trip. ``None`` (default)
            loads them here.

        Returns
        -------
        LithoSolidsOutcome
            All counts zero except ``orphans_deleted``.
        """
        if existing_by_body is None:
            existing_by_body = await self._load_existing(model_id)
        orphans_deleted = await self._delete_orphans(model_id, existing_by_body, set())
        await self._session.commit()
        self.success(
            f"BuildVoxelLithoModel: model={model_id} — empty payload, "
            f"{orphans_deleted} orphan(s) deleted"
        )
        return LithoSolidsOutcome(
            bodies_considered=0,
            bodies_built=0,
            bodies_skipped_checksum=0,
            bodies_flagged=0,
            orphans_deleted=orphans_deleted,
            marked_test_ids=[],
        )

    # ``digest_surfaces`` was promoted to a public shared helper in
    # ``load_geo_surfaces.py`` when the strat-field builder was retired (#236/#237).
    async def _read_parent_geo_model_id(self, model_id: UUID) -> UUID | None:
        """Read the lithostratigraphic model's parent geological model id.

        A single scalar SELECT of the self-FK column.

        Parameters
        ----------
        model_id : UUID
            The lithostratigraphic model id.

        Returns
        -------
        UUID | None
            The parent geological model id, or ``None`` when none is set.
        """
        stmt = select(GeologicalModelOrm.parent_model_id).where(GeologicalModelOrm.id == model_id)
        parent_id = (await self._session.execute(stmt)).scalar_one_or_none()
        return parent_id  # already a UUID | None (mapped column type)

    async def _read_litho_snap_tolerance_m(self, model_id: UUID) -> float:
        """Read the project's ``litho_snap_tolerance_m`` from its view-state.

        The model's project owns the ``litho_segmenter`` view-state bag; the knob
        is the litho↔geology snap tolerance the section editor defaults to (0.20
        m).  Gets the model → its project → reads the JSON knob, guarding bad /
        non-positive values back to the default.

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
        view_state = await load_project_view_state(self._session, model.app_project_id)
        return read_view_state_float(
            view_state,
            "litho_segmenter",
            "litho_snap_tolerance_m",
            _DEFAULT_LITHO_SNAP_TOLERANCE_M,
        )
