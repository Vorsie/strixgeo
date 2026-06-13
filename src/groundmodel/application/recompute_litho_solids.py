"""Recompute the cached 3-D solid mesh for every body in a lithostratigraphic model.

This use case is the litho-3D analogue of ``RecomputeFormationSurface`` /
``RebuildModelSurfaces`` in the geological model pipeline.  Since the
watertight-loft rework (spec ``2026-06-12-watertight-loft-body-builder-design.md``)
it builds the 3-D model by **lofting the 2-D section partitions** rather than
fitting an independent TIN per body:

1. Runs ``ResolveLithoInstances`` so ``litho_layer.body_id`` is current
   before any input is assembled.
2. Loads ``BodyLayerPick`` tuples (still used for the geology-bounding
   transforms + the no-picks short-circuit) and runs
   ``mark_and_truncate_shallow_tests`` / ``divide_picks_by_geology`` —
   these BOUND the picks the resolver produced and feed the model domain's
   deep-base reference.
3. Assembles the loft inputs from the DB via ``AssembleLoftInputs``:
   one ``SectionInput`` per usable cross-section (its line + column
   along-positions + ``compute_section_fill`` regions) plus the participating
   ``DomainTest`` list and the geological ``BandSurface`` set.
4. Builds the model domain (``build_model_domain``) and the loft field
   (``LoftField``), then ``build_loft_meshes`` produces one watertight mesh
   per body — the union tiles the domain by construction.
5. Upserts each mesh into ``litho_body_solid`` via
   ``ON CONFLICT (model_id, body_id) DO UPDATE``; bodies present in the picks
   but on NO section are emitted as a single flagged, empty row ("draw a
   section through these tests").
6. Deletes orphan ``litho_body_solid`` rows whose ``body_id`` is no longer
   among the built bodies.

Checksum (model-level, not per-body)
-----------------------------------
The loft is GLOBAL: any input change moves shared interfaces, so a per-body
skip is unsound — a neighbour's edit reshapes this body's wedge even though
this body's own picks are unchanged.  The checksum is therefore a single
model-wide digest over the sorted picks + the per-section serialised regions +
the domain knobs.  When the digest matches every stored row AND ``force`` is
False the whole rebuild is skipped (``bodies_skipped_checksum``); otherwise all
rows are rebuilt with the new digest.

On-click Build passes ``force=True`` so an explicit user action always
re-lofts, even if the contact set hasn't changed (a builder-algorithm update
would otherwise be invisible).
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

from groundmodel.application.assemble_loft_inputs import AssembleLoftInputs, LoftAssembly
from groundmodel.application.resolve_litho_instances_use_case import ResolveLithoInstances
from groundmodel.domain.services.litho_body_pick import BodyLayerPick
from groundmodel.domain.services.litho_geo_bounding import (
    divide_picks_by_geology,
    mark_and_truncate_shallow_tests,
)
from groundmodel.domain.services.loft_field import LoftField, SectionInput
from groundmodel.domain.services.loft_mesher import build_loft_meshes
from groundmodel.domain.services.model_domain import build_model_domain
from groundmodel.domain.services.section_partition import SectionRegion
from groundmodel.domain.services.tin_surface import evaluate_tin_at
from groundmodel.domain.services.tin_surface_constants import CONCAVE_HULL_ALPHA_FACTOR
from groundmodel.domain.value_objects.litho_body_mesh import LithoBodyMesh
from groundmodel.domain.value_objects.tin_surface import TinSurface
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_body_solid_orm import LithoBodySolidOrm
from groundmodel.infrastructure.db.repositories.geology_repository import GeologyRepository
from groundmodel.infrastructure.db.repositories.litho_layer_repository import LithoLayerRepository
from groundmodel.infrastructure.db.repositories.project_repository import ProjectRepository
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# Default lateral extent (m) past a one-sided section before a pinch/lens region
# ramps to zero thickness, when the project's view-state carries no override.
# Mirrors the frontend ``open_extent_length_m`` default (lithoSegmenterPrefs.ts).
_DEFAULT_OPEN_EXTENT_LENGTH_M: float = 3.0


@dataclass(frozen=True)
class RecomputeLithoSolidsOutcome:
    """Summary of one recompute pass.

    Attributes
    ----------
    bodies_considered : int
        Total bodies found across the built meshes + section-less picks.
    bodies_built : int
        Bodies whose solid was freshly (re-)lofted and upserted.
    bodies_skipped_checksum : int
        Bodies skipped because the model-level digest matched (all or none).
    bodies_flagged : int
        Bodies present in the picks but on no section — stored as a flagged,
        empty row ("draw a section through these tests").
    orphans_deleted : int
        ``litho_body_solid`` rows removed because their ``body_id`` was no
        longer among the built bodies.
    marked_test_ids : list[str]
        Investigation ids truncated as above-geology shallow tests.
    """

    bodies_considered: int
    bodies_built: int
    bodies_skipped_checksum: int
    bodies_flagged: int
    orphans_deleted: int
    marked_test_ids: list[str]


def _storage_body_id(mesh_body_id: str) -> UUID:
    """Map a mesh ``body_id`` string to the UUID stored in ``litho_body_solid``.

    The loft mesher emits a synthetic ``"none:<formation_id>"`` id for a
    never-correlated minority / band-filler body (``StackEntry.body_id is
    None``) — these are real volumes that must render, but the token is not a
    UUID and has no row in the ``body`` table.  ``body_id`` on
    ``litho_body_solid`` is intentionally NOT an FK (see the ORM docstring), so
    a deterministic ``uuid5`` over the token is a stable storage key that
    survives rebuilds without churning the cache.  A real UUID id passes
    through unchanged.

    Parameters
    ----------
    mesh_body_id : str
        The mesh's ``body_id`` — a real UUID string or a ``"none:<fid>"`` token.

    Returns
    -------
    UUID
        The id to store on the solid row.
    """
    try:
        return UUID(mesh_body_id)
    except ValueError:
        # Synthetic non-correlated-minority token — derive a stable UUID.
        return uuid5(NAMESPACE_OID, mesh_body_id)


def _model_checksum(
    picks: list[BodyLayerPick],
    sections: list[SectionInput],
    open_extent_length_m: float,
    alpha_factor: float,
) -> bytes:
    """Model-wide BLAKE2b-16 digest over every loft input.

    Covers the sorted pick geometry, the per-section serialised partition
    regions, and the domain knobs.  Any change moves a shared interface, so the
    digest is model-level (not per-body): the loft cannot be skipped one body
    at a time.

    Parameters
    ----------
    picks : list[BodyLayerPick]
        The geology-bounded pick set feeding the domain + section-less flagging.
    sections : list
        The assembled ``SectionInput`` list (its regions define the loft shape).
    open_extent_length_m : float
        The pinch/lens ramp knob.
    alpha_factor : float
        The alpha-hull / deep-base trim factor.

    Returns
    -------
    bytes
        16-byte BLAKE2b digest.
    """
    h = hashlib.blake2b(digest_size=16)
    # Domain knobs first.
    h.update(struct.pack("<dd", open_extent_length_m, alpha_factor))
    # Sorted pick geometry (insertion order is not significant).
    for p in sorted(picks, key=lambda x: (x.body_id, x.investigation_id, x.top_depth_m)):
        h.update(p.body_id.encode("utf-8"))
        h.update(p.investigation_id.encode("utf-8"))
        h.update(
            struct.pack("<ddddd", p.x_m, p.y_m, p.surface_elev_m, p.top_depth_m, p.base_depth_m)
        )
    # Per-section serialised regions (section order is deterministic from the
    # assembly; sort by id defensively so a reorder does not bust the digest).
    for s in sorted(sections, key=lambda sec: sec.section_id):
        h.update(s.section_id.encode("utf-8"))
        h.update(struct.pack("<dddd", s.ax, s.ay, s.bx, s.by))
        for along in s.column_alongs:
            h.update(struct.pack("<d", along))
        for r in s.regions:
            _hash_region(h, r)
    return h.digest()


def _hash_region(h: hashlib.blake2b, region: SectionRegion) -> None:
    """Fold one partition region into the running model digest.

    Parameters
    ----------
    h : hashlib.blake2b
        The running BLAKE2b state.
    region : SectionRegion
        The region to serialise (formation, body, kind, gap, polygon).
    """
    h.update(region.formation_id.encode("utf-8"))
    h.update((region.body_id or "").encode("utf-8"))
    h.update(region.kind.encode("utf-8"))
    h.update((region.overlay_tier or "").encode("utf-8"))
    h.update(struct.pack("<i", region.gap_index))
    for pt in region.polygon:
        h.update(struct.pack("<dd", pt.fraction, pt.elevation))


class RecomputeLithoSolids(GroundModelLogger):
    """Recompute and cache the 3-D solid for every body in a lithostratigraphic model.

    Builds via the watertight loft pipeline (spec
    ``2026-06-12-watertight-loft-body-builder-design.md``).  The caller owns
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
            always re-loft.  The on-click "Build 3-D model" path passes this so
            an explicit Build always reflects the current builder code.
        litho_snap_tolerance_m : float, default 0.20
            Geology↔litho snap tolerance; a boundary within this of a litho
            contact snaps geology to the contact rather than cutting (feeds the
            pick-division transform).

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
        self.info(f"RecomputeLithoSolids(loft): model={model_id} force={force}")

        # Step 1: ensure body_id stamps are current before assembling inputs.
        await ResolveLithoInstances(self._session).execute(model_id=model_id, commit=False)
        self.debug(f"RecomputeLithoSolids: resolver done for model={model_id}")

        # Step 2: load picks (for geo-bounding + the section-less flag + checksum).
        repo = LithoLayerRepository(self._session)
        picks = await repo.load_body_picks(model_id)
        self.info(f"RecomputeLithoSolids: model={model_id} — {len(picks)} pick(s) loaded")

        # --- Geology bounding (build-only; the geological model is untouched) ---
        alpha_factor = CONCAVE_HULL_ALPHA_FACTOR
        picks, marked_test_ids = await self._apply_geo_bounding(
            model_id, picks, litho_snap_tolerance_m
        )

        if not picks:
            return await self._handle_no_picks(model_id)

        # Step 3: assemble loft inputs from the DB.
        assembly = await AssembleLoftInputs(self._session).execute(model_id)
        open_extent_length_m = await self._read_open_extent_length_m(model_id)
        self.info(
            f"RecomputeLithoSolids: model={model_id} — assembled "
            f"{len(assembly.sections)} section(s), {len(assembly.tests)} test(s), "
            f"{len(assembly.band_surfaces)} band(s); open_extent={open_extent_length_m} m"
        )

        # Step 4: build the loft meshes (pure domain).
        meshes = self._build_meshes(assembly, open_extent_length_m, alpha_factor)
        mesh_body_ids = {m.body_id for m in meshes}
        self.info(f"RecomputeLithoSolids: model={model_id} — loft produced {len(meshes)} mesh(es)")

        # Bodies that produced no volume → flag an empty row ("draw a section
        # through these tests").  Two cases:
        #  * the loft built nothing at all (too few / collinear tests, or no
        #    section — the domain is unbuildable): flag EVERY body; or
        #  * the loft built, but a body has no investigation on any section
        #    corridor (section presence is GEOMETRIC per spec §3 — a body is
        #    present iff a test projects onto a corridor).
        # Mesh-id presence is the WRONG signal: a body that shaped the loft only
        # as a re-keyed (``#b<k>``) or aggregated minority (``none:<fid>``) mesh
        # has lost its resolver id, so an id-difference would flag it spuriously.
        on_section_inv = assembly.on_section_investigation_ids
        pick_body_ids = {p.body_id for p in picks}
        if not meshes:
            sectionless_body_ids = set(pick_body_ids)
        else:
            section_present = {p.body_id for p in picks if p.investigation_id in on_section_inv}
            sectionless_body_ids = pick_body_ids - section_present
        formation_by_body = {p.body_id: p.formation_id for p in picks}
        self.info(
            f"RecomputeLithoSolids: model={model_id} — "
            f"{len(sectionless_body_ids)} body/bodies on no section (flagged)"
        )

        # --- Model-level checksum short-circuit ---
        new_checksum = _model_checksum(picks, assembly.sections, open_extent_length_m, alpha_factor)
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

        wanted_storage_ids = {str(_storage_body_id(b)) for b in mesh_body_ids} | {
            str(_storage_body_id(b)) for b in sectionless_body_ids
        }
        bodies_considered = len(wanted_storage_ids)

        # Skip ALL rows only when the digest matches every stored row AND every
        # wanted body already has a fresh row (the loft is global — a partial
        # skip would serve mismatched shared interfaces).
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
                marked_test_ids=marked_test_ids,
            )

        # Step 5: upsert every mesh + every section-less flagged row.
        bodies_built = 0
        for i, mesh in enumerate(meshes):
            await self._upsert_mesh(model_id, mesh, new_checksum, existing_by_body, i, len(meshes))
            bodies_built += 1

        bodies_flagged = 0
        for bid in sorted(sectionless_body_ids):
            await self._upsert_flagged(
                model_id, bid, formation_by_body[bid], new_checksum, existing_by_body
            )
            bodies_flagged += 1

        # Step 6: delete orphan rows for bodies no longer built.
        orphans_deleted = await self._delete_orphans(model_id, existing_by_body, wanted_storage_ids)

        await self._session.commit()

        self.success(
            f"RecomputeLithoSolids: model={model_id} — "
            f"considered={bodies_considered} built={bodies_built} "
            f"flagged={bodies_flagged} orphans_deleted={orphans_deleted}"
        )
        return RecomputeLithoSolidsOutcome(
            bodies_considered=bodies_considered,
            bodies_built=bodies_built,
            bodies_skipped_checksum=0,
            bodies_flagged=bodies_flagged,
            orphans_deleted=orphans_deleted,
            marked_test_ids=marked_test_ids,
        )

    # -----------------------------------------------------------------
    # Geology bounding
    # -----------------------------------------------------------------

    async def _apply_geo_bounding(
        self,
        model_id: UUID,
        picks: list[BodyLayerPick],
        litho_snap_tolerance_m: float,
    ) -> tuple[list[BodyLayerPick], list[str]]:
        """Truncate shallow tests + divide picks by geology (build-only).

        Bounds the picks the resolver produced so a body never crosses a
        geological band and shallow tests do not floor the model.  Mirrors the
        legacy builder's bounding pass verbatim (the samplers wrap the parent
        model's ``FormationSurfaceOrm`` TINs directly); kept because it produces
        ``marked_test_ids`` and keeps the pick set consistent with the band
        surfaces the loft clips against.  No-ops when the model has no parent
        geological model.

        Parameters
        ----------
        model_id : UUID
            The lithostratigraphic model.
        picks : list[BodyLayerPick]
            The model's body-assigned picks.
        litho_snap_tolerance_m : float
            Snap-or-divide tolerance for ``divide_picks_by_geology``.

        Returns
        -------
        tuple[list[BodyLayerPick], list[str]]
            The bounded picks + the marked (too-shallow) investigation ids.
        """
        model = await self._session.get(GeologicalModelOrm, model_id)
        parent_id = model.parent_geological_model_id if model is not None else None
        if parent_id is None or not picks:
            self.debug(
                f"RecomputeLithoSolids: model={model_id} has no parent geological "
                "model or no picks — geology bounding skipped"
            )
            return picks, []

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
            hits = [(fid, e) for fid, tin in tins if (e := evaluate_tin_at(tin, x, y)) is not None]
            hits.sort(key=lambda fe: fe[1], reverse=True)
            return hits

        def _lowest_boundary(x: float, y: float) -> float | None:
            s = _boundary_samples(x, y)
            return s[-1][1] if s else None

        shallow = mark_and_truncate_shallow_tests(picks, _lowest_boundary)
        bounded = divide_picks_by_geology(shallow.picks, _boundary_samples, litho_snap_tolerance_m)
        self.info(
            f"RecomputeLithoSolids: geo-bounding model={model_id} — "
            f"{len(shallow.marked_investigation_ids)} marked test(s); "
            f"{len(bounded)} picks after division"
        )
        return bounded, shallow.marked_investigation_ids

    # -----------------------------------------------------------------
    # Loft mesh build
    # -----------------------------------------------------------------

    def _build_meshes(
        self,
        assembly: LoftAssembly,
        open_extent_length_m: float,
        alpha_factor: float,
    ) -> list[LithoBodyMesh]:
        """Run the loft pipeline; return the per-body meshes (empty on degeneracy).

        Parameters
        ----------
        assembly : LoftAssembly
            The assembled sections + tests + band surfaces.
        open_extent_length_m : float
            The pinch/lens ramp knob.
        alpha_factor : float
            The alpha-hull / deep-base trim factor.

        Returns
        -------
        list[LithoBodyMesh]
            One watertight mesh per body, or ``[]`` when the domain cannot be
            built (fewer than 3 tests, collinear, or no deep-reaching test).
        """
        if not assembly.sections or len(assembly.tests) < 3:
            self.warning(
                "RecomputeLithoSolids: insufficient loft inputs "
                f"(sections={len(assembly.sections)} tests={len(assembly.tests)}) "
                "— no watertight meshes built"
            )
            return []
        try:
            domain = build_model_domain(
                assembly.tests, lowest_band_elev_at=None, alpha_factor=alpha_factor
            )
        except ValueError as err:
            # Collinear tests / no deep-reaching test — the loft cannot frame a
            # domain; every body falls back to the section-less flagged path.
            self.warning(f"RecomputeLithoSolids: model domain unbuildable — {err}")
            return []
        field = LoftField(
            sections=assembly.sections,
            domain=domain,
            band_surfaces=assembly.band_surfaces or None,
            open_extent_length_m=open_extent_length_m,
        )
        return build_loft_meshes(field)

    # -----------------------------------------------------------------
    # Persistence helpers
    # -----------------------------------------------------------------

    def _digest_matches_all(
        self,
        existing_by_body: dict[str, LithoBodySolidOrm],
        wanted_storage_ids: set[str],
        new_checksum: bytes,
    ) -> bool:
        """True when every wanted body has a fresh row carrying ``new_checksum``.

        The loft is global, so the skip is all-or-nothing: a single stale or
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
        """Upsert one lofted mesh into ``litho_body_solid``.

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
        """Upsert a flagged, empty row for a body that is on no section.

        The body's tests project into no section corridor, so the loft cannot
        shape it.  The row is stored flagged with empty geometry; the UI surfaces
        it as "not on any section — draw a section through these tests".

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
        self.debug(f"upsert flagged (section-less) body {body_id} → {storage_id}")
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
            Whether the body is a section-less flagged row.
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
            method="loft",
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
                method="loft",
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

    async def _read_open_extent_length_m(self, model_id: UUID) -> float:
        """Read the project's ``open_extent_length_m`` from its view-state.

        The model's project owns the ``litho_segmenter`` view-state bag; the
        knob mirrors the frontend's pinch/lens ramp default (3 m).

        Parameters
        ----------
        model_id : UUID
            The lithostratigraphic model (to find its project).

        Returns
        -------
        float
            The configured open-extent length, or the 3 m default.
        """
        model = await self._session.get(GeologicalModelOrm, model_id)
        if model is None:
            return _DEFAULT_OPEN_EXTENT_LENGTH_M
        project = await ProjectRepository(self._session).get_by_id(model.app_project_id)
        view_state = project.view_state if project is not None else None
        seg = (view_state or {}).get("litho_segmenter") or {}
        try:
            return float(seg.get("open_extent_length_m", _DEFAULT_OPEN_EXTENT_LENGTH_M))
        except (TypeError, ValueError):
            return _DEFAULT_OPEN_EXTENT_LENGTH_M
