"""Build the 3-D litho-solid cache from the validated 2-D voxel partitions.

This use case is the voxel sibling of
:class:`~groundmodel.application.recompute_litho_solids.RecomputeLithoSolids`.
Where ``RecomputeLithoSolids`` fits an implicit stratigraphic field through the
DB picks, this builder takes the frontend's already-validated 2-D section
partitions (``computeSectionFill``) as the SOURCE OF TRUTH and:

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

What this use case deliberately does NOT do
------------------------------------------
* It does NOT run ``ResolveLithoInstances`` (unlike ``RecomputeLithoSolids``):
  the payload's ``body_id`` values ALREADY reflect the resolved frontend state,
  so re-resolving could desync the 3-D model from the 2-D partition the user
  validated.  The frontend is the single source of body identity here.
* It does NOT load picks for the build — the partition payload is the truth.

Domain-layer purity is preserved: the API converts its Pydantic request into the
frozen domain value objects (``SectionPartitionInput``) before calling
``execute``; this use case only sees value objects.
"""

from __future__ import annotations

import hashlib
import struct
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.litho_solid_persistence import (
    LithoSolidPersistenceMixin,
    LithoSolidsOutcome,
    storage_body_id,
)
from groundmodel.domain.services.voxel_litho.build_domain_from_sections import (
    build_domain_from_sections,
)
from groundmodel.domain.services.voxel_litho.extract_body_solids import extract_body_solids
from groundmodel.domain.services.voxel_litho.label_voxels import label_voxels
from groundmodel.domain.services.voxel_litho.voxel_types import SectionPartitionInput


def _partition_checksum(sections: list[SectionPartitionInput], grid_spacing_m: float) -> bytes:
    """Model-wide BLAKE2b-16 digest over the voxel partition payload + grid spacing.

    The voxel build is a single global labelling of the grid, so the digest is
    model-level (not per-body): any change to a region's lithology / body /
    polygon, a column's world position, the section line, or the grid spacing
    moves the labelling and must bust the cache.

    The digest folds in, deterministically (sections in payload order, regions
    and columns in their payload order — both are stable for an unchanged
    payload):

    * the grid spacing,
    * each section's line endpoints,
    * each column's investigation id + world position,
    * each region's formation id + body id (the empty string for ``None``) +
      gap index + every polygon ``(fraction, elevation)`` point.

    Parameters
    ----------
    sections : list of SectionPartitionInput
        The section partitions (the build payload).
    grid_spacing_m : float
        The voxel grid spacing.

    Returns
    -------
    bytes
        16-byte BLAKE2b digest.
    """
    h = hashlib.blake2b(digest_size=16)
    h.update(struct.pack("<d", grid_spacing_m))
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
    return h.digest()


class BuildVoxelLithoModel(LithoSolidPersistenceMixin):
    """Build + persist the litho 3-D solids from the validated 2-D voxel partitions.

    Mirrors the persistence contract of
    :class:`~groundmodel.application.recompute_litho_solids.RecomputeLithoSolids`
    (same ``litho_body_solid`` cache, same upsert / orphan / model-checksum
    semantics, inherited from
    :class:`~groundmodel.application.litho_solid_persistence.LithoSolidPersistenceMixin`),
    but takes the frontend section partitions as its input instead of fitting a
    field through the DB picks.  The ``method`` column is stamped ``"voxel"``.

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
            The voxel edge length in metres (same in x, y, z).  Must be positive.
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
            f"grid_spacing={grid_spacing_m} force={force}"
        )

        if not sections:
            self.warning(f"BuildVoxelLithoModel: model={model_id} — no sections; clearing cache")
            return await self._handle_empty(model_id)

        # --- Phase 1: domain footprint from the section columns ---------------
        try:
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

        # --- Phase 2: label the 3-D voxel grid --------------------------------
        try:
            grid = label_voxels(domain, grid_spacing_m, sections)
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
        meshes = extract_body_solids(grid)  # greedy=True (production default)
        # An empty body slot (no voxel labelled with it) yields no mesh — drop it.
        meshes = [m for m in meshes if m.vertices and m.triangles]
        self.info(f"BuildVoxelLithoModel: model={model_id} — extracted {len(meshes)} body solid(s)")

        new_checksum = _partition_checksum(sections, grid_spacing_m)
        existing_by_body = await self._load_existing(model_id)

        if not meshes:
            # The labelling produced no non-empty body (e.g. every voxel void).
            self.warning(
                f"BuildVoxelLithoModel: model={model_id} — labelling produced no body; "
                "clearing cache"
            )
            return await self._handle_empty(model_id)

        wanted_storage_ids = {str(storage_body_id(m.body_id)) for m in meshes}
        bodies_considered = len(wanted_storage_ids)

        # --- Phase 4: checksum short-circuit ----------------------------------
        if not force and self._digest_matches_all(
            existing_by_body, wanted_storage_ids, new_checksum
        ):
            await self._session.commit()
            self.success(
                f"BuildVoxelLithoModel: model={model_id} — checksum unchanged, "
                f"skipped all {bodies_considered} body/bodies"
            )
            return LithoSolidsOutcome(
                bodies_considered=bodies_considered,
                bodies_built=0,
                bodies_skipped_checksum=bodies_considered,
                bodies_flagged=0,
                orphans_deleted=0,
                marked_test_ids=[],
            )

        # --- Phase 5: upsert + orphan-delete + commit -------------------------
        rows = self._mesh_rows(meshes, model_id, new_checksum)
        bodies_built = len(rows)
        chunks_written = await self._batch_upsert(rows)
        self.info(
            f"BuildVoxelLithoModel: model={model_id} — "
            f"upserted {bodies_built} mesh(es) in {chunks_written} chunk(s)"
        )

        orphans_deleted = await self._delete_orphans(model_id, existing_by_body, wanted_storage_ids)
        await self._session.commit()
        self.success(
            f"BuildVoxelLithoModel: model={model_id} — "
            f"considered={bodies_considered} built={bodies_built} "
            f"orphans_deleted={orphans_deleted}"
        )
        return LithoSolidsOutcome(
            bodies_considered=bodies_considered,
            bodies_built=bodies_built,
            bodies_skipped_checksum=0,
            bodies_flagged=0,
            orphans_deleted=orphans_deleted,
            marked_test_ids=[],
        )

    async def _handle_empty(self, model_id: UUID) -> LithoSolidsOutcome:
        """Clear every solid row for the model and return a zero outcome.

        Used when the payload is empty / degenerate (no sections, an unbuildable
        footprint, or a labelling with no body).  Mirrors
        ``RecomputeLithoSolids._handle_no_picks``: an empty model is a valid
        "nothing to build" state, so the cache is emptied (orphan-deleting every
        stored row) rather than raising.

        Parameters
        ----------
        model_id : UUID
            The model whose solids are cleared.

        Returns
        -------
        LithoSolidsOutcome
            All counts zero except ``orphans_deleted``.
        """
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
