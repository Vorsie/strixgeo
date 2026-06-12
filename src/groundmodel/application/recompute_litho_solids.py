"""Recompute the cached 3-D solid mesh for every body in a lithostratigraphic model.

This use case is the litho-3D analogue of ``RecomputeFormationSurface`` /
``RebuildModelSurfaces`` in the geological model pipeline.  It:

1. Runs ``ResolveLithoInstances`` so ``litho_layer.body_id`` is current
   before any pick is loaded.
2. Loads ``BodyLayerPick`` tuples for every accepted layer that has a
   resolved ``body_id`` and a valid anchor.
3. Calls :func:`build_body_solids` (pure domain, no I/O).
4. Upserts each resulting ``LithoBodyMesh`` into ``litho_body_solid``
   via ``ON CONFLICT (model_id, body_id) DO UPDATE``.
5. Deletes orphan ``litho_body_solid`` rows whose ``body_id`` is no
   longer among the built bodies.
6. Applies a checksum short-circuit: if the existing row's
   ``source_pick_checksum`` matches the recomputed one AND the row is
   not stale, the triangulation is skipped for that body (mirrors the
   ``RecomputeFormationSurface`` no-op path exactly).

The checksum covers every pick's ``(investigation_id, x_m, y_m,
surface_elev_m, top_depth_m, base_depth_m)`` — enough to detect any
geometry change without rerunning Delaunay.

On-click Build passes ``force=True`` so an explicit user action always
re-triangulates, even if the contact set hasn't changed (a TIN-algorithm
update would otherwise be invisible).
"""

from __future__ import annotations

import hashlib
import struct
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.resolve_litho_instances_use_case import ResolveLithoInstances
from groundmodel.domain.services.litho_geo_bounding import (
    divide_picks_by_geology,
    mark_and_truncate_shallow_tests,
)
from groundmodel.domain.services.litho_solid_builder import BodyLayerPick, build_body_solids
from groundmodel.domain.services.tin_surface import evaluate_tin_at
from groundmodel.domain.value_objects.litho_body_mesh import LithoBodyMesh
from groundmodel.domain.value_objects.tin_surface import TinSurface
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_body_solid_orm import LithoBodySolidOrm
from groundmodel.infrastructure.db.repositories.geology_repository import GeologyRepository
from groundmodel.infrastructure.db.repositories.litho_layer_repository import LithoLayerRepository
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


@dataclass(frozen=True)
class RecomputeLithoSolidsOutcome:
    """Summary of one recompute pass.

    Attributes
    ----------
    bodies_considered : int
        Total bodies found in the resolved model.
    bodies_built : int
        Bodies whose solid was freshly (re-)triangulated and upserted.
    bodies_skipped_checksum : int
        Bodies skipped because the pick-set checksum matched the cached row.
    bodies_flagged : int
        Bodies built but emitted as flagged slabs (< 3 non-collinear picks).
    orphans_deleted : int
        ``litho_body_solid`` rows removed because their ``body_id`` was no
        longer among the resolved bodies.
    """

    bodies_considered: int
    bodies_built: int
    bodies_skipped_checksum: int
    bodies_flagged: int
    orphans_deleted: int
    marked_test_ids: list[str]  # investigation IDs truncated as above-geology shallow


def _checksum_picks(picks: list[BodyLayerPick]) -> bytes:
    """Stable BLAKE2b-16 digest over a body's pick set.

    Covers ``investigation_id``, ``(x, y, surface_elev_m)``,
    ``top_depth_m``, and ``base_depth_m`` — the full geometry input for
    one body.  Sorted by ``investigation_id`` so insertion order is not
    significant.  Mirrors the design of ``checksum_contacts`` in
    ``tin_surface.py``.

    Parameters
    ----------
    picks : list[BodyLayerPick]
        All picks for one body.

    Returns
    -------
    bytes
        16-byte BLAKE2b digest.
    """
    h = hashlib.blake2b(digest_size=16)
    for p in sorted(picks, key=lambda x: x.investigation_id):
        h.update(p.investigation_id.encode("utf-8"))
        # "<ddddd" packs exactly the five geometry fields of BodyLayerPick.
        # Any change to this packed layout busts every stored
        # source_pick_checksum → all bodies force-rebuild on next execute
        # (acceptable pre-ship).
        h.update(
            struct.pack("<ddddd", p.x_m, p.y_m, p.surface_elev_m, p.top_depth_m, p.base_depth_m)
        )
    return h.digest()


class RecomputeLithoSolids(GroundModelLogger):
    """Recompute and cache the 3-D solid for every body in a lithostratigraphic model.

    Mirrors ``RecomputeFormationSurface`` / ``RebuildModelSurfaces`` for the
    geological model pipeline.  The caller owns the session; this use case
    commits once at the end.

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
            When ``True``, skip the checksum short-circuit and always
            re-triangulate every body.  The on-click "Build 3-D model"
            path passes this so an explicit Build always reflects the
            current code (e.g. a changed builder algorithm produces
            different solids from the *same* picks — the checksum, which
            hashes only the input picks, would otherwise short-circuit
            and serve stale geometry).  The automatic dedup path leaves
            it ``False`` (picks change there, so the checksum differs
            anyway).
        litho_snap_tolerance_m : float, default 0.20
            Geology↔litho snap tolerance; a boundary within this of a
            litho contact snaps geology to the contact rather than
            cutting.

        Returns
        -------
        RecomputeLithoSolidsOutcome
            Per-phase counts; useful for the API response + logs.

        Notes
        -----
        Step 1 runs ``ResolveLithoInstances`` with ``commit=False`` so
        the body-stamp flush and the solid upsert land in the SAME
        transaction (one fsync instead of two).  The outer ``commit``
        at the end of this method owns the transaction boundary.
        """
        self.info(f"RecomputeLithoSolids: model={model_id} force={force}")

        # Step 1: ensure body_id stamps are current before loading picks.
        await ResolveLithoInstances(self._session).execute(model_id=model_id, commit=False)
        self.debug(f"RecomputeLithoSolids: resolver done for model={model_id}")

        # Step 2: load picks.
        repo = LithoLayerRepository(self._session)
        picks = await repo.load_body_picks(model_id)
        self.info(f"RecomputeLithoSolids: model={model_id} — {len(picks)} pick(s) loaded")

        # --- Geology bounding (build-only; the geological model is untouched) ---
        marked_test_ids: list[str] = []
        model = await self._session.get(GeologicalModelOrm, model_id)
        parent_id = model.parent_geological_model_id if model is not None else None
        if parent_id is not None and picks:
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

            def _boundary_samples(x: float, y: float) -> list[tuple[str, float]]:
                hits = [
                    (fid, e) for fid, tin in tins if (e := evaluate_tin_at(tin, x, y)) is not None
                ]
                hits.sort(key=lambda fe: fe[1], reverse=True)
                return hits

            def _lowest_boundary(x: float, y: float) -> float | None:
                s = _boundary_samples(x, y)
                return s[-1][1] if s else None

            shallow = mark_and_truncate_shallow_tests(picks, _lowest_boundary)
            marked_test_ids = shallow.marked_investigation_ids
            picks = divide_picks_by_geology(
                shallow.picks, _boundary_samples, litho_snap_tolerance_m
            )
            self.info(
                f"RecomputeLithoSolids: geo-bounding model={model_id} — "
                f"{len(marked_test_ids)} marked test(s); {len(picks)} picks after division"
            )
        else:
            self.debug(
                f"RecomputeLithoSolids: model={model_id} has no parent geological "
                "model or no picks — geology bounding skipped"
            )

        if not picks:
            # No accepted body-assigned layers → nothing to build.
            # Delete any orphan solid rows that survived (e.g. from a
            # Clear-litho-model followed by a recompute).
            del_result = await self._session.execute(
                delete(LithoBodySolidOrm).where(LithoBodySolidOrm.model_id == model_id)
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

        # Group picks by body_id for checksum computation.
        picks_by_body: dict[str, list[BodyLayerPick]] = {}
        for p in picks:
            picks_by_body.setdefault(p.body_id, []).append(p)

        bodies_considered = len(picks_by_body)
        self.info(
            f"RecomputeLithoSolids: model={model_id} — {bodies_considered} body/bodies to evaluate"
        )

        # Load existing solid rows for the model so we can checksum-compare.
        existing_by_body: dict[str, LithoBodySolidOrm] = {
            str(row.body_id): row
            for row in (
                await self._session.execute(
                    select(LithoBodySolidOrm).where(LithoBodySolidOrm.model_id == model_id)
                )
            )
            .scalars()
            .all()
        }

        # Step 3: build solids (domain, pure).
        # Only build bodies that need it (checksum mismatch or force).
        # Bodies that pass the checksum short-circuit are still tracked so
        # the orphan-delete below knows which body_ids are "wanted".
        wanted_body_ids: set[str] = set(picks_by_body)
        bodies_to_build: dict[str, list[BodyLayerPick]] = {}
        # Cache checksums keyed by body_id so the upsert loop below reads the
        # pre-computed value instead of hashing each body's picks twice.
        cached_checksums: dict[str, bytes] = {}
        skipped_checksum = 0

        for body_id_str, body_picks in picks_by_body.items():
            new_checksum = _checksum_picks(body_picks)
            cached_checksums[body_id_str] = new_checksum
            existing = existing_by_body.get(body_id_str)

            if (
                not force
                and existing is not None
                and existing.source_pick_checksum == new_checksum
                and not existing.is_stale
            ):
                # Geometry unchanged and row is fresh — no-op.
                self.debug(
                    f"RecomputeLithoSolids: body {body_id_str} checksum unchanged — skipping"
                )
                skipped_checksum += 1
                continue

            if (
                not force
                and existing is not None
                and existing.source_pick_checksum == new_checksum
                and existing.is_stale
            ):
                # Same geometry but stale flag was set (e.g. by a no-op
                # contact edit).  Clear the flag without re-triangulating —
                # mirrors the same branch in RecomputeFormationSurface.
                existing.is_stale = False
                await self._session.flush()
                self.debug(
                    f"RecomputeLithoSolids: body {body_id_str} checksum unchanged "
                    "but was stale — cleared flag only"
                )
                skipped_checksum += 1
                continue

            bodies_to_build[body_id_str] = body_picks

        # M3: shared contact surfaces need neighbour context, so the builder must
        # see EVERY pick in the model — not just the changed subset. We still only
        # WRITE the bodies whose checksum changed (or all, under force), preserving
        # the incremental dedup. (A body whose neighbour changed but whose own picks
        # did not keeps its prior solid until the next force-Build; acceptable
        # pre-ship — the on-click Build passes force=True and rewrites everything.)
        mesh_by_body: dict[str, LithoBodyMesh] = {}
        if bodies_to_build:
            mesh_by_body = {m.body_id: m for m in build_body_solids(picks)}

        bodies_built = 0
        bodies_flagged = 0

        # Step 4: upsert each built mesh into litho_body_solid.
        for i, body_id_str in enumerate(bodies_to_build):
            mesh = mesh_by_body.get(body_id_str)
            if mesh is None:
                self.error(
                    f"build_body_solids produced no mesh for body {body_id_str} "
                    f"— solid NOT updated (picks={len(bodies_to_build[body_id_str])})"
                )
                continue
            bodies_built += 1
            if mesh.is_flagged:
                bodies_flagged += 1
            body_picks = bodies_to_build[body_id_str]
            new_checksum = cached_checksums[body_id_str]
            existing = existing_by_body.get(body_id_str)

            vertices_payload = [list(v) for v in mesh.vertices]
            triangles_payload = [list(t) for t in mesh.triangles]

            self.debug(
                f"[{i + 1}/{len(bodies_to_build)}] upsert body {mesh.body_id} — "
                f"{len(vertices_payload)} vertices, {len(triangles_payload)} triangles "
                f"flagged={mesh.is_flagged}"
            )

            stmt = pg_insert(LithoBodySolidOrm).values(
                id=uuid7() if existing is None else existing.id,
                model_id=model_id,
                body_id=UUID(mesh.body_id),
                formation_id=UUID(mesh.formation_id),
                method="tin",
                vertices=vertices_payload,
                triangles=triangles_payload,
                source_pick_count=len(body_picks),
                source_pick_checksum=new_checksum,
                is_flagged=mesh.is_flagged,
                is_stale=False,
            )
            stmt = stmt.on_conflict_do_update(
                constraint="uq_litho_body_solid_model_body",
                set_=dict(
                    formation_id=UUID(mesh.formation_id),
                    method="tin",
                    vertices=vertices_payload,
                    triangles=triangles_payload,
                    source_pick_count=len(body_picks),
                    source_pick_checksum=new_checksum,
                    is_flagged=mesh.is_flagged,
                    is_stale=False,
                ),
            )
            await self._session.execute(stmt)

        # Step 5: delete orphan solid rows for bodies that no longer exist.
        orphan_body_ids = {UUID(bid) for bid in existing_by_body if bid not in wanted_body_ids}
        orphans_deleted = 0
        if orphan_body_ids:
            del_result = await self._session.execute(
                delete(LithoBodySolidOrm).where(
                    LithoBodySolidOrm.model_id == model_id,
                    LithoBodySolidOrm.body_id.in_(orphan_body_ids),
                )
            )
            orphans_deleted = del_result.rowcount or 0
            self.info(
                f"RecomputeLithoSolids: deleted {orphans_deleted} orphan solid(s) "
                f"for model={model_id}"
            )

        await self._session.commit()

        self.success(
            f"RecomputeLithoSolids: model={model_id} — "
            f"considered={bodies_considered} built={bodies_built} "
            f"skipped_checksum={skipped_checksum} flagged={bodies_flagged} "
            f"orphans_deleted={orphans_deleted}"
        )
        return RecomputeLithoSolidsOutcome(
            bodies_considered=bodies_considered,
            bodies_built=bodies_built,
            bodies_skipped_checksum=skipped_checksum,
            bodies_flagged=bodies_flagged,
            orphans_deleted=orphans_deleted,
            marked_test_ids=marked_test_ids,
        )
