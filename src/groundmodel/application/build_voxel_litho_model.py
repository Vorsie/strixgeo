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

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

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
from groundmodel.domain.services.voxel_litho.merge_bodies_across_sections import (
    apply_body_aliases,
    plan_body_aliases,
)
from groundmodel.domain.services.voxel_litho.true_column_positions import (
    apply_true_column_positions,
)
from groundmodel.domain.services.voxel_litho.voxel_types import (
    InvestigationColumn,
    SectionPartitionInput,
)
from groundmodel.domain.value_objects.litho_body_mesh import LithoBodyMesh
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_build_generation_orm import (
    LithoBuildGenerationOrm,
)
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
    honor_radius_m: float = 0.0,
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
    honor_radius_m : float, optional
        The honored-column radius.  Folded in so widening or narrowing it
        rebuilds — it changes which voxels take an investigation's own log
        instead of the section blend.  Defaults to ``0.0`` (the pre-#249
        nearest-cell-only behaviour), which keeps the digest byte-stable for a
        caller that does not pass one.
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
    # Same shape for the honored radius: folded only when set, after its own
    # domain separator, so a caller that does not pass one keeps the previous
    # digest exactly.
    if honor_radius_m:
        h.update(b"\x04")
        h.update(struct.pack("<d", float(honor_radius_m)))
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
                # Constant per investigation (every pick shares one anchor); the
                # labeller needs it to decide which of two investigations sharing
                # a grid column is honored.
                kind=first.kind,
            )
        )
    return tuple(columns)


def _apply_aliases_to_columns(
    columns: tuple[InvestigationColumn, ...],
    aliases: dict[str, str],
) -> tuple[InvestigationColumn, ...]:
    """Relabel each honored column's interval body ids through ``aliases``.

    The honored intervals carry the resolver-assigned ``body_id`` straight from
    the database, while the section regions carry the frontend partition's. Both
    must pass through the SAME alias map or the labeller registers two identities
    for one physical unit — one in blended space, one at the honored column — and
    the mesher emits them as separate bodies that abut.

    Parameters
    ----------
    columns : tuple of InvestigationColumn
        The per-investigation observed columns.
    aliases : dict of str to str
        The map from :func:`plan_body_aliases`.

    Returns
    -------
    tuple of InvestigationColumn
        New value objects with aliased interval body ids; input untouched.
    """
    out: list[InvestigationColumn] = []
    for column in columns:
        intervals = tuple(
            (aliases.get(body_id, body_id), formation_id, top, base)
            for body_id, formation_id, top, base in column.intervals
        )
        out.append(
            InvestigationColumn(
                investigation_id=column.investigation_id,
                world_x=column.world_x,
                world_y=column.world_y,
                intervals=intervals,
                kind=column.kind,
            )
        )
    return tuple(out)


def _investigation_columns_checksum(
    h: hashlib.blake2b, columns: tuple[InvestigationColumn, ...]
) -> None:
    """Fold the honored investigation columns into an open BLAKE2b digest.

    A pick change (a moved contact, a re-assigned body, an added / removed
    layer) must bust the model cache so the on-open / force=false path rebuilds.
    Columns arrive already sorted by ``investigation_id`` (deterministic order);
    each interval is folded in its top → bottom order.

    The investigation ``kind`` is folded in too, because it decides which
    investigation is honored when two of them share a voxel column — so a
    re-typed anchor changes the labelling.  This is a ONE-TIME cache bust for
    every existing model: an unchanged model's digest moves once, the next build
    rewrites it, and it is stable thereafter.  Backwards compatibility is
    suspended pre-ship (CLAUDE.md), and the on-click Build passes ``force=True``
    regardless.

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
        h.update(c.kind.encode("utf-8"))
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

        # --- Honor each investigation's OWN observed log at its true location --
        # The section blend at a borehole's true (x, y) can disagree with the
        # borehole's own log (it feeds a section at its projected foot, not its
        # true map position).  Load the resolved DB picks and build the per-
        # investigation observed columns so ``label_voxels`` labels those columns
        # from the log itself (within its observed depth range).  ``load_body_picks``
        # already reflects the resolver, so we do NOT run ResolveLithoInstances.
        #
        # Loaded BEFORE the footprint because the drilled positions are a hull
        # input: the footprint must reach every investigation the build honors.
        picks = await LithoLayerRepository(self._session).load_body_picks(model_id)
        investigation_columns = _investigation_columns_from_picks(picks)
        self.info(
            f"BuildVoxelLithoModel: model={model_id} — honoring "
            f"{len(investigation_columns)} investigation column(s) from "
            f"{len(picks)} pick(s)"
        )
        self._warn_sub_voxel_investigations(model_id, investigation_columns, grid_spacing_m)

        # --- Stage 2: one body identity across the whole fence -----------------
        # The frontend's per-section merge picks its representative PER SECTION,
        # so the same physical unit arrives under a different body_id on every
        # section it appears on.  ``_blend_stacks`` matches sections BY body_id
        # and pinches an unmatched body to ~nothing at the midline, which invents
        # lithology between columns (docs/debt.md #244).
        #
        # The map is planned ONCE here and applied to BOTH the section regions
        # AND the honored investigation intervals.  Applying it to only one of
        # them — as the first, frontend-only version of this did — gives the same
        # material two identities: the merged one in blended space and the
        # original resolver one at every honored column.
        #
        # This creates no correlation edge and writes nothing: the user's ties
        # stay exactly the user's ties, only the ids are aliased.
        # The payload AS RECEIVED, before any transform.  The generation row
        # stores THIS, not an intermediate: the alias map and the true-position
        # re-seat are both derived from it, whereas the projected-foot column
        # positions it carries are NOT recoverable afterwards — and the footprint
        # hull needs them (it unions the columns as-drawn with the true
        # positions, so it can only grow).  Storing the re-seated payload instead
        # made a reproduction come back 21 grid cells narrower.
        sections_received = sections

        aliases = plan_body_aliases(sections)
        merged_away = sum(1 for src, dst in aliases.items() if src != dst)
        if merged_away:
            sections = apply_body_aliases(sections, aliases)
            investigation_columns = _apply_aliases_to_columns(investigation_columns, aliases)
            self.info(
                f"BuildVoxelLithoModel: model={model_id} — cross-section body merge "
                f"aliased {merged_away} of {len(aliases)} body id(s) "
                f"({len(aliases) - merged_away} component(s) remain)"
            )
        else:
            self.debug(
                f"BuildVoxelLithoModel: model={model_id} — cross-section body merge "
                f"found nothing to alias across {len(aliases)} body id(s)"
            )

        # --- Rank the blend in TRUE map space, not projected-foot space --------
        # The payload's column world positions are the frontend's CANONICAL ones
        # ("the projected position on the densest section"), which on the dev
        # model sit a MEDIAN OF 11 m — max 65 m — from where the investigation
        # actually is.  Everything else here works in true space: the grid, the
        # footprint, the honored columns.  So the labeller was choosing which
        # sections are nearest a voxel in one coordinate space and placing the
        # material in another (docs/debt.md #247 — the twin of the footprint bug
        # fixed in d3b6c1fd0..99c6e023f).  Owner ruling 2026-07-29: rank by true
        # positions.  This re-measures only; along_m, the section line and every
        # region polygon are untouched.
        sections_as_drawn = sections
        sections, columns_moved, max_shift_m = apply_true_column_positions(
            sections, investigation_columns
        )
        if columns_moved:
            self.info(
                f"BuildVoxelLithoModel: model={model_id} — re-seated {columns_moved} section "
                f"column(s) onto their true map positions (max shift {max_shift_m:.2f} m)"
            )

        # --- Phase 1: domain footprint from the feet + the drilled positions ---
        # Built from the columns AS DRAWN plus the investigations' TRUE map
        # positions, so the hull is the union of both and can only be larger than
        # either.  The footprint is a coverage gate, not geometry: being generous
        # is safe (the labeller still voids any column no section reaches), while
        # shrinking it would re-open the uncovered-column bug the footprint fix
        # closed.
        try:
            with phase_timer(self, "BuildVoxelLithoModel phase-1 domain"):
                domain = build_domain_from_sections(
                    sections_as_drawn,
                    investigation_positions=tuple(
                        (c.investigation_id, c.world_x, c.world_y) for c in investigation_columns
                    ),
                )
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
        honor_radius_m = await self._read_honor_radius_m(model_id, grid_spacing_m)
        self.info(
            f"BuildVoxelLithoModel: model={model_id} — {len(geo_surfaces)} geo "
            f"surface(s), litho_snap_tolerance_m={snap_tol}, honor_radius_m={honor_radius_m}"
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
            honor_radius_m=honor_radius_m,
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
                    honor_radius_m=honor_radius_m,
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

        # --- Phase 4: provenance + upsert + orphan-delete + commit ------------
        # The generation row is written FIRST so every mesh can point at it in
        # the same transaction.  It records what the build was made from and
        # with, which nothing else does: the payload lived only in the frontend,
        # the settings only in the project's view-state at the moment the build
        # ran, and the derived body identity only in memory.  Without it no
        # diagnostic can reproduce a build after the fact (docs/debt.md #252).
        generation_id = uuid7()
        with phase_timer(self, "BuildVoxelLithoModel phase-4 upsert"):
            await self._write_generation(
                generation_id=generation_id,
                model_id=model_id,
                sections=sections_received,
                grid=grid,
                aliases=aliases,
                checksum=new_checksum,
                geo_surfaces=geo_surfaces,
                horizontal_spacing_m=grid_spacing_m,
                vertical_spacing_m=vertical_spacing_m,
                honor_radius_m=honor_radius_m,
                litho_snap_tolerance_m=snap_tol,
                meshes=meshes,
                started_at=t_total,
            )
            rows = self._mesh_rows(meshes, model_id, new_checksum)
            for row in rows:
                row["generation_id"] = generation_id
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

    def _warn_sub_voxel_investigations(
        self,
        model_id: UUID,
        investigation_columns: tuple[InvestigationColumn, ...],
        grid_spacing_m: float,
    ) -> None:
        """Warn about investigation pairs too close to both be honored.

        ``label_voxels`` honors at most ONE investigation per grid column, so two
        investigations less than one horizontal voxel apart contend for the same
        column and only one of their logs survives — the other's drilled log is
        silently replaced by its neighbour's at its own map position.  That is a
        real fidelity loss and must never pass unlogged, so every contending pair
        is named at WARNING with its separation.

        The test is grid-PHASE independent (a pair closer than one voxel may or
        may not land in the same cell depending on where the grid origin falls),
        so this over-reports rather than under-reports: a flagged pair is at risk,
        a pair farther apart than one voxel never is.

        Parameters
        ----------
        model_id : UUID
            The model being built (for the log line).
        investigation_columns : tuple of InvestigationColumn
            The honored per-investigation observed columns.
        grid_spacing_m : float
            The HORIZONTAL voxel edge length; the contention radius.
        """
        # Spatial hash at the contention radius: two investigations within one
        # voxel of each other necessarily fall in the same or an adjacent bucket,
        # so each investigation only compares against its 3x3 bucket
        # neighbourhood.  A project with thousands of investigations would make
        # the all-pairs walk quadratic for a check that finds a handful of pairs.
        buckets: dict[tuple[int, int], list[InvestigationColumn]] = defaultdict(list)
        for col in investigation_columns:
            buckets[
                (int(col.world_x // grid_spacing_m), int(col.world_y // grid_spacing_m))
            ].append(col)

        contending: list[tuple[str, str, float]] = []
        for (bi, bj), members in buckets.items():
            for col in members:
                for di in (0, 1):
                    for dj in (-1, 0, 1):
                        if di == 0 and dj < 0:
                            continue  # the mirrored half of the neighbourhood
                        for other in buckets.get((bi + di, bj + dj), ()):
                            # Within one bucket, compare each pair once only.
                            if (
                                di == 0
                                and dj == 0
                                and other.investigation_id <= col.investigation_id
                            ):
                                continue
                            dx = col.world_x - other.world_x
                            dy = col.world_y - other.world_y
                            separation = (dx * dx + dy * dy) ** 0.5
                            if separation < grid_spacing_m:
                                contending.append(
                                    (col.investigation_id, other.investigation_id, separation)
                                )
        contending.sort()
        if not contending:
            return
        self.warning(
            f"BuildVoxelLithoModel: model={model_id} — {len(contending)} investigation pair(s) "
            f"closer than the {grid_spacing_m} m horizontal voxel; only ONE of each pair can be "
            f"honored, the other takes its neighbour's log at its own position"
        )
        for inv_a, inv_b, separation in contending:
            self.warning(
                f"BuildVoxelLithoModel: model={model_id} — sub-voxel pair "
                f"{inv_a} / {inv_b} separated by {separation:.2f} m"
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

    #: Identifies the builder behind a stored generation.  Bump when a change
    #: alters the labelling, so a mesh built by an older builder is recognisable
    #: after the algorithm moves on.
    _BUILDER_VERSION = "voxel-2026.07.29"

    #: How many generations to keep per model.  Each row carries the full
    #: section payload (hundreds of kB), so an unbounded history would grow by
    #: that much on every dogfeed click.  Enough to A/B a change against the
    #: builds either side of it.
    _KEEP_GENERATIONS = 10

    async def _write_generation(
        self,
        *,
        generation_id: UUID,
        model_id: UUID,
        sections: list[SectionPartitionInput],
        grid: object,
        aliases: dict[str, str],
        checksum: bytes,
        geo_surfaces: tuple[SurfaceBound, ...],
        horizontal_spacing_m: float,
        vertical_spacing_m: float | None,
        honor_radius_m: float,
        litho_snap_tolerance_m: float,
        meshes: list[LithoBodyMesh],
        started_at: float,
    ) -> None:
        """Record what this build was made from and with.

        Writes one :class:`LithoBuildGenerationOrm` row carrying the exact
        section payload, every setting that changes the output, the grid geometry
        (the ORIGIN matters as much as the spacing — which cell an investigation
        lands in depends on grid phase), the parent geo digest, and the derived
        body-alias map.

        The alias map is DERIVED build data with provenance.  It records which
        source bodies were merged into one component and must never be read back
        as a user correlation.

        Older generations beyond :attr:`_KEEP_GENERATIONS` are pruned in the same
        transaction so the payload history stays bounded.

        Parameters
        ----------
        generation_id : UUID
            Pre-allocated id, so the mesh rows can reference it in one transaction.
        model_id : UUID
            The model built.
        sections : list of SectionPartitionInput
            The payload as labelled (post-alias, post-re-seat).
        grid : LabelGrid
            The labelled grid, for its axes.
        aliases : dict of str to str
            ``source_body_id -> derived component id``.
        checksum : bytes
            The model-level digest stamped on every solid row.
        geo_surfaces : tuple of SurfaceBound
            The parent geological model's band surfaces.
        horizontal_spacing_m, vertical_spacing_m, honor_radius_m, litho_snap_tolerance_m : float
            The settings the build ran with.
        meshes : list of LithoBodyMesh
            The built meshes, for the outcome counts.
        started_at : float
            ``time.perf_counter()`` at the start of the build.
        """
        gx, gy, gz = grid.gx, grid.gy, grid.gz  # type: ignore[attr-defined]
        payload = {
            "sections": [
                {
                    "start_x": sec.start_x,
                    "start_y": sec.start_y,
                    "end_x": sec.end_x,
                    "end_y": sec.end_y,
                    "columns": [
                        {
                            "investigation_id": c.investigation_id,
                            "along_m": c.along_m,
                            "world_x": c.world_x,
                            "world_y": c.world_y,
                        }
                        for c in sec.columns
                    ],
                    "regions": [
                        {
                            "formation_id": r.formation_id,
                            "body_id": r.body_id,
                            "gap_index": r.gap_index,
                            "polygon": [[f, e] for f, e in r.polygon],
                        }
                        for r in sec.regions
                    ],
                }
                for sec in sections
            ]
        }
        self._session.add(
            LithoBuildGenerationOrm(
                id=generation_id,
                model_id=model_id,
                builder_version=self._BUILDER_VERSION,
                horizontal_spacing_m=float(horizontal_spacing_m),
                vertical_spacing_m=float(
                    vertical_spacing_m if vertical_spacing_m is not None else horizontal_spacing_m
                ),
                honor_radius_m=float(honor_radius_m),
                litho_snap_tolerance_m=float(litho_snap_tolerance_m),
                grid_nx=len(gx),
                grid_ny=len(gy),
                grid_nz=len(gz),
                grid_origin_x=float(gx[0]),
                grid_origin_y=float(gy[0]),
                grid_origin_z=float(gz[0]),
                payload=payload,
                payload_checksum=checksum,
                geo_surface_digest=digest_surfaces(list(geo_surfaces)) if geo_surfaces else None,
                body_aliases=dict(aliases),
                sections_count=len(sections),
                bodies_built=len(meshes),
                triangles=sum(len(m.triangles) for m in meshes),
                duration_s=time.perf_counter() - started_at,
            )
        )
        await self._session.flush()

        keep = (
            select(LithoBuildGenerationOrm.id)
            .where(LithoBuildGenerationOrm.model_id == model_id)
            .order_by(LithoBuildGenerationOrm.created_at.desc())
            .limit(self._KEEP_GENERATIONS)
        )
        keep_ids = [row[0] for row in (await self._session.execute(keep)).all()]
        if keep_ids:
            await self._session.execute(
                delete(LithoBuildGenerationOrm).where(
                    LithoBuildGenerationOrm.model_id == model_id,
                    LithoBuildGenerationOrm.id.not_in(keep_ids),
                )
            )
        self.info(
            f"BuildVoxelLithoModel: model={model_id} — generation {generation_id} recorded "
            f"({len(sections)} section(s), {len(aliases)} alias(es), "
            f"{self._BUILDER_VERSION})"
        )

    async def _read_honor_radius_m(self, model_id: UUID, grid_spacing_m: float) -> float:
        """Read the honored-column radius, defaulting to one horizontal voxel.

        Owner directive 2026-07-29: *"widen honor to the drawn column width"*.  The
        drawn width is screen-space (``BARE_COLUMN_WIDTH_PX = 14``, scaled by
        zoom), so there is no metre value to copy; the honored footprint is a real
        radius instead, defaulting to one horizontal voxel so an investigation owns
        its own cell and the four orthogonal neighbours rather than a single cell
        chosen by grid phase (docs/debt.md #249).

        ``0`` is a legitimate setting — it restores nearest-cell-only honoring — so
        the guard admits it, unlike the snap-tolerance reader which rejects
        non-positive values.

        Parameters
        ----------
        model_id : UUID
            The lithostratigraphic model (to find its project).
        grid_spacing_m : float
            The horizontal voxel spacing, used as the default radius.

        Returns
        -------
        float
            The configured radius in metres, or ``grid_spacing_m``.
        """
        model = await self._session.get(GeologicalModelOrm, model_id)
        if model is None:
            return grid_spacing_m
        view_state = await load_project_view_state(self._session, model.app_project_id)
        radius = read_view_state_float(
            view_state,
            "litho_segmenter",
            "voxel_honor_radius_m",
            grid_spacing_m,
        )
        return radius if radius >= 0.0 else grid_spacing_m

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
