"""Recompute the cached 3-D solid mesh for every body in a lithostratigraphic model.

This use case is the litho-3D analogue of ``RecomputeFormationSurface`` /
``RebuildModelSurfaces`` in the geological model pipeline.  Since the
implicit-stratigraphic rework (spec
``2026-06-13-implicit-stratigraphic-3d-builder-design.md``) it builds the 3-D
model by fitting a single smooth **stratigraphic potential field** through the
accepted litho picks and assembling one watertight body per litho band — the
bodies tile the domain with no overlaps and no gaps by construction (the loft's
per-section wedge mesher, which produced metre-scale overlaps on interbedded
data, is retired):

1. Runs ``ResolveLithoInstances`` so ``litho_layer.body_id`` is current
   before any input is assembled (correlated layers share one body → one
   stratigraphic instance).
2. Loads ``BodyLayerPick`` tuples (the no-picks short-circuit + the checksum).
3. Assembles the strat builder inputs from the picks via ``AssembleStratInputs``:
   Stage-1 stratigraphic order (topo-sort over the per-investigation unit
   sequences) + Stage-2 control data (one elevation control point per contact)
   + the model domain block (alpha hull / DEM top / deep base).
4. Builds the watertight meshes (pure domain ``build_strat_model``) over a
   regular grid whose spacing comes from ``view_state.litho_segmenter`` (the
   ``strat_grid_spacing_m`` pref, default 1 m).
5. Upserts each mesh into ``litho_body_solid`` via
   ``ON CONFLICT (model_id, body_id) DO UPDATE``.
6. Deletes orphan ``litho_body_solid`` rows whose ``body_id`` is no longer
   among the built bodies.

What changed vs. the loft path (the judgment calls — documented per spec Task 8)
-------------------------------------------------------------------------------
* **Section-presence flagging dropped.**  The loft needed a drawn section to
  loft each body, so it flagged bodies whose tests projected onto NO section.
  The strat field is fit from ALL picks (boreholes constrain it directly;
  sections only add density), so every band becomes a real solid and there is no
  section-less-body limitation.  ``bodies_flagged`` is therefore 0 on the happy
  path; a NON-zero value only appears when the WHOLE model is non-conformable or
  the domain is unbuildable (see below).
* **Geology bounding dropped.**  ``mark_and_truncate_shallow_tests`` /
  ``divide_picks_by_geology`` are GEOLOGY COUPLING, which the spec keeps OUT of
  the litho model (owner directive 2026-06-13 — the litho model is pure litho;
  geological bounding belongs in the not-yet-built geotech model).
  ``marked_test_ids`` is therefore always empty.  ``build_model_domain`` (alpha
  hull / deep base) is KEPT — that is geometric framing, not band coupling.
* **Non-conformable handling.**  A directed cycle in the stratigraphic order
  (a fault / unconformity the v1 builder cannot model) raises
  ``NonConformableError`` from Stage 1.  Rather than crash, the use case logs a
  WARNING and flags EVERY body with an empty row (the UI surfaces the actionable
  "these contacts conflict — needs a fault/unconformity, not yet supported").

Checksum (model-level, not per-body)
-----------------------------------
The strat field is GLOBAL: any pick change moves the whole field, so a per-body
skip is unsound.  The checksum is a single model-wide digest over the sorted
picks + the grid spacing.  When the digest matches every stored row AND ``force``
is False the whole rebuild is skipped (``bodies_skipped_checksum``); otherwise all
rows are rebuilt with the new digest.

On-click Build passes ``force=True`` so an explicit user action always rebuilds,
even if the pick set hasn't changed (a builder-algorithm update would otherwise
be invisible).
"""

from __future__ import annotations

import hashlib
import struct
from dataclasses import dataclass
from typing import Any, cast
from uuid import NAMESPACE_OID, UUID, uuid5

from sqlalchemy import CursorResult, delete, select
from sqlalchemy.dialects.postgresql import Insert
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.assemble_strat_inputs import AssembleStratInputs
from groundmodel.application.resolve_litho_instances_use_case import ResolveLithoInstances
from groundmodel.domain.services.litho_body_pick import BodyLayerPick
from groundmodel.domain.services.strat_field.body_assembly import build_shared_grid
from groundmodel.domain.services.strat_field.lens_carving import (
    carve_lenses,
    merge_meshes_by_body_id,
)
from groundmodel.domain.services.strat_field.lens_classification import LensClassificationError
from groundmodel.domain.services.strat_field.strat_builder import build_strat_model
from groundmodel.domain.services.strat_field.stratigraphic_order import NonConformableError
from groundmodel.domain.value_objects.litho_body_mesh import LithoBodyMesh
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_body_solid_orm import LithoBodySolidOrm
from groundmodel.infrastructure.db.repositories.litho_layer_repository import LithoLayerRepository
from groundmodel.infrastructure.db.repositories.project_repository import ProjectRepository
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# Default grid spacing (m) for the strat field sampling + the prism cells, when
# the project's view-state carries no override.  Finer spacing → smoother tapers
# at O(1/h²) grid cost (see the litho-3D solid-builder benchmark).
_DEFAULT_STRAT_GRID_SPACING_M: float = 1.0


@dataclass(frozen=True)
class RecomputeLithoSolidsOutcome:
    """Summary of one recompute pass.

    Attributes
    ----------
    bodies_considered : int
        Total bodies found across the built meshes (+ any flagged rows).
    bodies_built : int
        Bodies whose solid was freshly (re-)built and upserted.
    bodies_skipped_checksum : int
        Bodies skipped because the model-level digest matched (all or none).
    bodies_flagged : int
        Bodies emitted as flagged empty rows.  ALWAYS 0 on the happy strat
        path (the field is fit from all picks — there is no section-less-body
        limitation).  Non-zero only when the whole model is non-conformable
        (a fault / unconformity the v1 builder cannot model).
    orphans_deleted : int
        ``litho_body_solid`` rows removed because their ``body_id`` was no
        longer among the built bodies.
    marked_test_ids : list[str]
        ALWAYS empty on the strat path — geology bounding (which produced the
        marked-too-shallow list) is kept OUT of the litho model.  Retained on
        the outcome for API-shape compatibility with the loft contract.
    """

    bodies_considered: int
    bodies_built: int
    bodies_skipped_checksum: int
    bodies_flagged: int
    orphans_deleted: int
    marked_test_ids: list[str]


def _storage_body_id(mesh_body_id: str) -> UUID:
    """Map a mesh ``body_id`` string to the UUID stored in ``litho_body_solid``.

    The strat builder emits a synthetic ``"strat:{rank_top}-{rank_bot}"`` id
    per band (plus a ``"#<component>"`` suffix when a band splits into
    disconnected regions) — these are real volumes that must render, but the
    token is not a UUID and has no row in the ``body`` table.  ``body_id`` on
    ``litho_body_solid`` is intentionally NOT an FK (see the ORM docstring), so
    a deterministic ``uuid5`` over the token is a stable storage key that
    survives rebuilds without churning the cache.  A real UUID id passes
    through unchanged.

    Parameters
    ----------
    mesh_body_id : str
        The mesh's ``body_id`` — a real UUID string or a ``"strat:…"`` token.

    Returns
    -------
    UUID
        The id to store on the solid row.
    """
    try:
        return UUID(mesh_body_id)
    except ValueError:
        # Synthetic strat band token — derive a stable UUID.
        return uuid5(NAMESPACE_OID, mesh_body_id)


def _model_checksum(
    picks: list[BodyLayerPick],
    grid_spacing_m: float,
) -> bytes:
    """Model-wide BLAKE2b-16 digest over every strat-builder input.

    Covers the sorted pick geometry + the grid-spacing knob.  The strat field is
    global — any pick change moves the whole field — so the digest is model-level
    (not per-body): the build cannot be skipped one body at a time.  The
    stratigraphic order is a pure function of the picks' per-column unit
    sequences, so digesting the picks already captures any order change; the
    order is not separately folded in.  The lens partition
    (``classify_lenses``) and the lens carve surfaces are likewise PURE functions
    of the picks (the matrix/lens split derives from the per-column sequences and
    the lens surfaces from each lens body's picks), so a lens-classification
    change cannot occur without a pick change — the pick digest captures it too,
    and the partition is not separately folded in.

    Parameters
    ----------
    picks : list[BodyLayerPick]
        The model's accepted body-assigned picks.
    grid_spacing_m : float
        The field-sampling / prism-cell grid spacing.

    Returns
    -------
    bytes
        16-byte BLAKE2b digest.
    """
    h = hashlib.blake2b(digest_size=16)
    h.update(struct.pack("<d", grid_spacing_m))
    # Sorted pick geometry (insertion order is not significant).
    for p in sorted(picks, key=lambda x: (x.body_id, x.investigation_id, x.top_depth_m)):
        h.update(p.body_id.encode("utf-8"))
        h.update(p.investigation_id.encode("utf-8"))
        h.update(p.formation_id.encode("utf-8"))
        h.update(
            struct.pack("<ddddd", p.x_m, p.y_m, p.surface_elev_m, p.top_depth_m, p.base_depth_m)
        )
    return h.digest()


# Digest stamped on flagged (could-not-build) rows.  A model with picks always
# digests a non-empty set with a positive grid spacing, so this empty sentinel
# never collides with a healthy row's digest (the no-picks case is handled
# earlier by ``_handle_no_picks``).
_FLAGGED_SENTINEL_CHECKSUM: bytes = _model_checksum([], 0.0)


class RecomputeLithoSolids(GroundModelLogger):
    """Recompute and cache the 3-D solid for every body in a lithostratigraphic model.

    Builds via the implicit-stratigraphic field (spec
    ``2026-06-13-implicit-stratigraphic-3d-builder-design.md``).  The caller owns
    the session; this use case commits once at the end.

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
        model_id: UUID,
        *,
        force: bool = False,
        litho_snap_tolerance_m: float = 0.20,
    ) -> RecomputeLithoSolidsOutcome:
        """Recompute and upsert the solid cache for every body in the model.

        Parameters
        ----------
        model_id : UUID
            The lithostratigraphic model to recompute.
        force : bool, default ``False``
            When ``True``, skip the model-level checksum short-circuit and
            always rebuild.  The on-click "Build 3-D model" path passes this so
            an explicit Build always reflects the current builder code.
        litho_snap_tolerance_m : float, default 0.20
            Accepted for API-shape parity with the loft contract but UNUSED on
            the strat path — it fed the geology-coupling pick division, which is
            kept out of the litho model (owner directive 2026-06-13).

        Returns
        -------
        RecomputeLithoSolidsOutcome
            Per-phase counts; useful for the API response + logs.

        Notes
        -----
        ``ResolveLithoInstances`` runs with ``commit=False`` so the body-stamp
        flush and the solid upsert land in the SAME transaction (one fsync).
        The outer ``commit`` at the end owns the transaction boundary.
        """
        self.info(f"RecomputeLithoSolids(strat): model={model_id} force={force}")

        # Step 1: ensure body_id stamps are current before assembling inputs.
        await ResolveLithoInstances(self._session).execute(model_id=model_id, commit=False)
        self.debug(f"RecomputeLithoSolids: resolver done for model={model_id}")

        # Step 2: load picks (for the no-picks short-circuit + the checksum).
        repo = LithoLayerRepository(self._session)
        picks = await repo.load_body_picks(model_id)
        self.info(f"RecomputeLithoSolids: model={model_id} — {len(picks)} pick(s) loaded")

        if not picks:
            return await self._handle_no_picks(model_id)

        grid_spacing_m = await self._read_strat_grid_spacing_m(model_id)

        # Step 3 + 4: assemble strat inputs and build the watertight meshes.
        #
        # A NonConformableError (a directed cycle in the stratigraphic order — a
        # fault / unconformity the v1 builder cannot model) is NOT a crash: the
        # whole model is flagged so the UI surfaces the conflict.  A None
        # assembly (domain unbuildable: < 3 non-collinear tests, or no
        # deep-reaching test) flags every body the same way.
        formation_by_body = {p.body_id: p.formation_id for p in picks}
        try:
            # Pass the runtime grid spacing so the lens carve inputs are sampled on
            # the SAME grid the matrix build uses below — otherwise the lens prisms
            # would weld to a mismatched grid and the watertight tiling breaks.
            assembly = AssembleStratInputs(self._session).assemble(
                picks, grid_spacing_m=grid_spacing_m
            )
        except (NonConformableError, LensClassificationError) as err:
            # NonConformableError: the matrix backbone cycles (a fault the v1
            # builder cannot model).  LensClassificationError: lenses were found yet
            # the matrix STILL cycles (true residual interfingering the enclosure
            # criterion does not cover).  Both flag every body — the model is
            # unbuildable as a single global iso-order.
            self.warning(
                f"RecomputeLithoSolids: model={model_id} is non-conformable — {err}; "
                "flagging every body (v1 cannot build a faulted/unconformable model)"
            )
            return await self._handle_flag_all(model_id, formation_by_body)

        if assembly is None:
            self.warning(
                f"RecomputeLithoSolids: model={model_id} domain unbuildable — "
                "flagging every body (need ≥3 non-collinear tests reaching depth)"
            )
            return await self._handle_flag_all(model_id, formation_by_body)

        try:
            meshes = build_strat_model(
                assembly.control,
                assembly.domain,
                blocks=[assembly.domain],
                grid_spacing_m=grid_spacing_m,
            )
        except ValueError as err:
            # The field fit needs ≥1 internal contact: a model whose every column
            # is a SINGLE stratigraphic instance (no interbedding → no internal
            # horizon → no control point) has nothing to interpolate.  Flag every
            # body rather than crash — the UI surfaces "add a contact / correlate
            # a second unit to build this model".
            self.warning(
                f"RecomputeLithoSolids: model={model_id} field unfittable — {err}; "
                "flagging every body (no internal contact to interpolate)"
            )
            return await self._handle_flag_all(model_id, formation_by_body)

        # --- Carve enclosed lenses back into the matrix meshes ----------------
        # The matrix order excluded each enclosed lens (a single global iso-order
        # cannot place it); carve_lenses puts it back by splitting its host into
        # host-upper-plus-outer + host-lower around the lens prism, over the SAME
        # grid the matrix was built on (byte-identical: same domain + spacing).  A
        # conformable model with no lenses skips the carve entirely (clean no-op).
        if assembly.lens_carve_inputs:
            self.info(
                f"RecomputeLithoSolids: model={model_id} — carving "
                f"{len(assembly.lens_carve_inputs)} lens(es) into {len(meshes)} matrix mesh(es)"
            )
            gx, gy, node_inside = build_shared_grid(assembly.domain, grid_spacing_m)
            # carve_lenses returns the FULL updated mesh list (untouched matrix +
            # carved host pieces + lens prisms), so it replaces `meshes` wholesale.
            meshes = carve_lenses(assembly.lens_carve_inputs, meshes, gx, gy, node_inside)

        # Merge same-body_id meshes into one row's geometry: the carve emits two
        # host pieces under one body_id, but persistence keys ONE row per body_id,
        # so without this merge the second piece would silently overwrite the first
        # on upsert.  A no-op when no body_id repeats (the conformable / no-lens
        # path), so non-lens models stay byte-identical to before.
        meshes = merge_meshes_by_body_id(meshes)

        mesh_body_ids = {m.body_id for m in meshes}
        self.info(
            f"RecomputeLithoSolids: model={model_id} — strat field produced "
            f"{len(meshes)} mesh(es) after lens carve + body_id merge "
            f"over grid_spacing={grid_spacing_m} m"
        )

        # --- Model-level checksum short-circuit ---
        new_checksum = _model_checksum(picks, grid_spacing_m)
        existing_by_body = await self._load_existing(model_id)

        wanted_storage_ids = {str(_storage_body_id(b)) for b in mesh_body_ids}
        bodies_considered = len(wanted_storage_ids)

        # Skip ALL rows only when the digest matches every stored row AND every
        # wanted body already has a fresh row (the field is global — a partial
        # skip would serve a mismatched field).
        if not force and self._digest_matches_all(
            existing_by_body, wanted_storage_ids, new_checksum
        ):
            await self._session.commit()
            self.success(
                f"RecomputeLithoSolids: model={model_id} — checksum unchanged, "
                f"skipped all {bodies_considered} body/bodies"
            )
            return RecomputeLithoSolidsOutcome(
                bodies_considered=bodies_considered,
                bodies_built=0,
                bodies_skipped_checksum=bodies_considered,
                bodies_flagged=0,
                orphans_deleted=0,
                marked_test_ids=[],
            )

        # Step 5: upsert every mesh.
        bodies_built = 0
        for i, mesh in enumerate(meshes):
            await self._upsert_mesh(model_id, mesh, new_checksum, existing_by_body, i, len(meshes))
            bodies_built += 1

        # Step 6: delete orphan rows for bodies no longer built.
        orphans_deleted = await self._delete_orphans(model_id, existing_by_body, wanted_storage_ids)

        await self._session.commit()

        self.success(
            f"RecomputeLithoSolids: model={model_id} — "
            f"considered={bodies_considered} built={bodies_built} "
            f"orphans_deleted={orphans_deleted}"
        )
        return RecomputeLithoSolidsOutcome(
            bodies_considered=bodies_considered,
            bodies_built=bodies_built,
            bodies_skipped_checksum=0,
            bodies_flagged=0,
            orphans_deleted=orphans_deleted,
            marked_test_ids=[],
        )

    # -----------------------------------------------------------------
    # Persistence helpers
    # -----------------------------------------------------------------

    async def _load_existing(self, model_id: UUID) -> dict[str, LithoBodySolidOrm]:
        """Load the model's stored solid rows keyed by ``str(body_id)``.

        Parameters
        ----------
        model_id : UUID
            The model scope.

        Returns
        -------
        dict[str, LithoBodySolidOrm]
            Stored rows keyed by ``str(body_id)``.
        """
        return {
            str(row.body_id): row
            for row in (
                await self._session.execute(
                    select(LithoBodySolidOrm).where(LithoBodySolidOrm.model_id == model_id)
                )
            )
            .scalars()
            .all()
        }

    def _digest_matches_all(
        self,
        existing_by_body: dict[str, LithoBodySolidOrm],
        wanted_storage_ids: set[str],
        new_checksum: bytes,
    ) -> bool:
        """True when every wanted body has a fresh row carrying ``new_checksum``.

        The field is global, so the skip is all-or-nothing: a single stale or
        missing row (or a digest mismatch) forces a full rebuild.

        Parameters
        ----------
        existing_by_body : dict[str, LithoBodySolidOrm]
            Stored rows keyed by ``str(body_id)``.
        wanted_storage_ids : set[str]
            The storage body ids this build wants to write.
        new_checksum : bytes
            The freshly-computed model digest.

        Returns
        -------
        bool
        """
        if set(existing_by_body) != wanted_storage_ids:
            return False
        return all(
            row.source_pick_checksum == new_checksum and not row.is_stale
            for row in existing_by_body.values()
        )

    async def _upsert_mesh(
        self,
        model_id: UUID,
        mesh: LithoBodyMesh,
        checksum: bytes,
        existing_by_body: dict[str, LithoBodySolidOrm],
        index: int,
        total: int,
    ) -> None:
        """Upsert one strat-built mesh into ``litho_body_solid``.

        Parameters
        ----------
        model_id : UUID
            The model the solid belongs to.
        mesh : LithoBodyMesh
            The watertight mesh to persist.
        checksum : bytes
            The model-level digest stamped on the row.
        existing_by_body : dict[str, LithoBodySolidOrm]
            Stored rows keyed by ``str(body_id)`` (for id reuse).
        index, total : int
            Progress counters for the bulk-loop log prefix.
        """
        storage_id = _storage_body_id(mesh.body_id)
        existing = existing_by_body.get(str(storage_id))
        vertices_payload = [list(v) for v in mesh.vertices]
        triangles_payload = [list(t) for t in mesh.triangles]
        self.debug(
            f"[{index + 1}/{total}] upsert body {mesh.body_id} → {storage_id} — "
            f"{len(vertices_payload)} vertices, {len(triangles_payload)} triangles "
            f"flagged={mesh.is_flagged}"
        )
        await self._session.execute(
            self._upsert_stmt(
                model_id=model_id,
                storage_id=storage_id,
                formation_id=UUID(mesh.formation_id),
                vertices=vertices_payload,
                triangles=triangles_payload,
                source_pick_count=len(vertices_payload),
                checksum=checksum,
                is_flagged=mesh.is_flagged,
                existing=existing,
            )
        )

    async def _upsert_flagged(
        self,
        model_id: UUID,
        body_id: str,
        formation_id: str,
        checksum: bytes,
        existing_by_body: dict[str, LithoBodySolidOrm],
    ) -> None:
        """Upsert a flagged, empty row for a body that could not be built.

        Used only on the whole-model flag path (non-conformable order or an
        unbuildable domain): every body gets a flagged empty row so the UI
        surfaces the actionable conflict.  The row is stored flagged with empty
        geometry.

        Parameters
        ----------
        model_id : UUID
            The model the solid belongs to.
        body_id : str
            The (real UUID) body id.
        formation_id : str
            The body's lithology formation id.
        checksum : bytes
            The model-level digest stamped on the row.
        existing_by_body : dict[str, LithoBodySolidOrm]
            Stored rows keyed by ``str(body_id)`` (for id reuse).
        """
        storage_id = _storage_body_id(body_id)
        existing = existing_by_body.get(str(storage_id))
        self.debug(f"upsert flagged body {body_id} → {storage_id}")
        await self._session.execute(
            self._upsert_stmt(
                model_id=model_id,
                storage_id=storage_id,
                formation_id=UUID(formation_id),
                vertices=[],
                triangles=[],
                source_pick_count=0,
                checksum=checksum,
                is_flagged=True,
                existing=existing,
            )
        )

    def _upsert_stmt(
        self,
        *,
        model_id: UUID,
        storage_id: UUID,
        formation_id: UUID,
        vertices: list[list[float]],
        triangles: list[list[int]],
        source_pick_count: int,
        checksum: bytes,
        is_flagged: bool,
        existing: LithoBodySolidOrm | None,
    ) -> Insert:
        """Build the ``ON CONFLICT (model_id, body_id) DO UPDATE`` upsert.

        Parameters
        ----------
        model_id, storage_id, formation_id : UUID
            Row keys + formation FK.
        vertices, triangles : list
            JSONB geometry payloads.
        source_pick_count : int
            Cheap cache-validity pre-check (vertex count is fine here).
        checksum : bytes
            The model-level digest.
        is_flagged : bool
            Whether the body is a flagged (non-buildable) row.
        existing : LithoBodySolidOrm | None
            The stored row, for primary-key reuse on conflict.

        Returns
        -------
        sqlalchemy insert statement
            The ready-to-execute upsert.
        """
        stmt = pg_insert(LithoBodySolidOrm).values(
            id=uuid7() if existing is None else existing.id,
            model_id=model_id,
            body_id=storage_id,
            formation_id=formation_id,
            method="strat",
            vertices=vertices,
            triangles=triangles,
            source_pick_count=source_pick_count,
            source_pick_checksum=checksum,
            is_flagged=is_flagged,
            is_stale=False,
        )
        return stmt.on_conflict_do_update(
            constraint="uq_litho_body_solid_model_body",
            set_=dict(
                formation_id=formation_id,
                method="strat",
                vertices=vertices,
                triangles=triangles,
                source_pick_count=source_pick_count,
                source_pick_checksum=checksum,
                is_flagged=is_flagged,
                is_stale=False,
            ),
        )

    async def _delete_orphans(
        self,
        model_id: UUID,
        existing_by_body: dict[str, LithoBodySolidOrm],
        wanted_storage_ids: set[str],
    ) -> int:
        """Delete stored rows whose body is no longer built.

        Parameters
        ----------
        model_id : UUID
            The model scope.
        existing_by_body : dict[str, LithoBodySolidOrm]
            Stored rows keyed by ``str(body_id)``.
        wanted_storage_ids : set[str]
            The storage body ids this build wrote.

        Returns
        -------
        int
            Number of orphan rows deleted.
        """
        orphan_ids = {UUID(bid) for bid in existing_by_body if bid not in wanted_storage_ids}
        if not orphan_ids:
            return 0
        del_result = cast(
            "CursorResult[Any]",
            await self._session.execute(
                delete(LithoBodySolidOrm).where(
                    LithoBodySolidOrm.model_id == model_id,
                    LithoBodySolidOrm.body_id.in_(orphan_ids),
                )
            ),
        )
        deleted = del_result.rowcount or 0
        if deleted:
            self.info(
                f"RecomputeLithoSolids: deleted {deleted} orphan solid(s) for model={model_id}"
            )
        return deleted

    async def _handle_flag_all(
        self,
        model_id: UUID,
        formation_by_body: dict[str, str],
    ) -> RecomputeLithoSolidsOutcome:
        """Flag every body with an empty row (non-conformable / unbuildable).

        Used when Stage 1 raises ``NonConformableError`` or the domain cannot be
        framed.  Every resolver body gets a flagged empty row so the UI surfaces
        the actionable conflict; orphans (storage ids no longer wanted) are
        pruned.  Always rebuilds (no checksum skip) — a flagged state must be
        reflected even if the picks are unchanged.

        Parameters
        ----------
        model_id : UUID
            The model whose bodies are flagged.
        formation_by_body : dict[str, str]
            ``body_id → formation_id`` for every resolver body.

        Returns
        -------
        RecomputeLithoSolidsOutcome
            ``bodies_flagged`` == the body count; ``bodies_built`` == 0.
        """
        existing_by_body = await self._load_existing(model_id)
        # Flagged rows carry a sentinel digest.  This can never collide with a
        # healthy row's digest in practice: the empty-picks case is intercepted
        # by ``_handle_no_picks`` before this method is reachable, so a real
        # build always digests a non-empty pick set with a positive grid spacing.
        new_checksum = _FLAGGED_SENTINEL_CHECKSUM

        wanted_storage_ids = {str(_storage_body_id(b)) for b in formation_by_body}
        bodies_flagged = 0
        for bid in sorted(formation_by_body):
            await self._upsert_flagged(
                model_id, bid, formation_by_body[bid], new_checksum, existing_by_body
            )
            bodies_flagged += 1

        orphans_deleted = await self._delete_orphans(model_id, existing_by_body, wanted_storage_ids)
        await self._session.commit()
        self.success(
            f"RecomputeLithoSolids: model={model_id} — flagged {bodies_flagged} body/bodies, "
            f"{orphans_deleted} orphan(s) deleted"
        )
        return RecomputeLithoSolidsOutcome(
            bodies_considered=bodies_flagged,
            bodies_built=0,
            bodies_skipped_checksum=0,
            bodies_flagged=bodies_flagged,
            orphans_deleted=orphans_deleted,
            marked_test_ids=[],
        )

    async def _handle_no_picks(self, model_id: UUID) -> RecomputeLithoSolidsOutcome:
        """Delete every solid row and return a zero outcome (no picks path).

        Parameters
        ----------
        model_id : UUID
            The model whose solids are cleared.

        Returns
        -------
        RecomputeLithoSolidsOutcome
            All counts zero except ``orphans_deleted``.
        """
        del_result = cast(
            "CursorResult[Any]",
            await self._session.execute(
                delete(LithoBodySolidOrm).where(LithoBodySolidOrm.model_id == model_id)
            ),
        )
        orphans = del_result.rowcount or 0
        if orphans:
            self.info(
                f"RecomputeLithoSolids: deleted {orphans} orphan solid(s) "
                f"(no picks) for model={model_id}"
            )
        await self._session.commit()
        self.success(
            f"RecomputeLithoSolids: model={model_id} — no picks, {orphans} orphan(s) deleted"
        )
        return RecomputeLithoSolidsOutcome(
            bodies_considered=0,
            bodies_built=0,
            bodies_skipped_checksum=0,
            bodies_flagged=0,
            orphans_deleted=orphans,
            marked_test_ids=[],
        )

    async def _read_strat_grid_spacing_m(self, model_id: UUID) -> float:
        """Read the project's ``strat_grid_spacing_m`` from its view-state.

        The model's project owns the ``litho_segmenter`` view-state bag; the
        knob sets the strat field's sampling / prism-cell grid spacing (default
        1 m).  Stored in JSON view-state, so no migration is needed.

        Parameters
        ----------
        model_id : UUID
            The lithostratigraphic model (to find its project).

        Returns
        -------
        float
            The configured grid spacing, or the 1 m default.
        """
        model = await self._session.get(GeologicalModelOrm, model_id)
        if model is None:
            return _DEFAULT_STRAT_GRID_SPACING_M
        project = await ProjectRepository(self._session).get_by_id(model.app_project_id)
        view_state = project.view_state if project is not None else None
        seg = (view_state or {}).get("litho_segmenter") or {}
        try:
            spacing = float(seg.get("strat_grid_spacing_m", _DEFAULT_STRAT_GRID_SPACING_M))
            # Guard against a zero/negative pref that would crash the grid linspace.
            return spacing if spacing > 0 else _DEFAULT_STRAT_GRID_SPACING_M
        except (TypeError, ValueError):
            return _DEFAULT_STRAT_GRID_SPACING_M
