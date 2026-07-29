"""Shared persistence for the litho-3D solid cache (``litho_body_solid``).

The voxel builder
(:class:`~groundmodel.application.build_voxel_litho_model.BuildVoxelLithoModel`)
writes watertight
:class:`~groundmodel.domain.value_objects.litho_body_mesh.LithoBodyMesh`
objects into the ``litho_body_solid`` cache table with upsert /
orphan-delete / model-level-checksum semantics.

This module carries:

* :class:`LithoSolidsOutcome` — the per-phase count summary the use case
  returns (the API maps it onto ``RebuildLithoSolidsResponse``).
* :func:`storage_body_id` — maps a mesh ``body_id`` token to the stored UUID
  (real UUIDs pass through; synthetic tokens get a deterministic ``uuid5``).
* :class:`LithoSolidPersistenceMixin` — the upsert / load-existing /
  digest-compare / orphan-delete / mesh-row helpers, parameterised by the
  ``_solid_method`` class attribute (``"voxel"``) the use case sets.  A use
  case mixes it in alongside its build logic.

Pre-extraction history: these helpers lived inline on the retired implicit
strat-field builder (``RecomputeLithoSolids``, method ``"strat"``
hard-coded; deleted with the strat_field package — git history has it).
Promoted to a shared mixin when the voxel builder became a second caller of
the byte-identical upsert path; the mixin stays because it keeps the
persistence contract separable from the build logic.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any, cast
from uuid import NAMESPACE_OID, UUID, uuid5

from sqlalchemy import CursorResult, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.domain.value_objects.litho_body_mesh import LithoBodyMesh
from groundmodel.infrastructure.db.models.litho_body_solid_orm import LithoBodySolidOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

__all__ = ["LithoSolidsOutcome", "storage_body_id", "LithoSolidPersistenceMixin"]


#: Columns an upsert must NEVER overwrite: the primary key, and the two columns
#: that form the conflict target ``(model_id, body_id)`` — the row's identity.
#: Everything else the builder writes is refreshed on rebuild.
_UPSERT_IDENTITY_COLUMNS = frozenset({"id", "model_id", "body_id"})


def _upsert_update_columns(row_keys: Iterable[str]) -> list[str]:
    """Columns the ``ON CONFLICT DO UPDATE`` clause should refresh.

    DERIVED from the row's own keys rather than hand-listed, because a column
    missing from the update set is silently never written on the conflict path —
    and the conflict path is every rebuild, since the row already exists.

    That mistake has been made twice on this table. ``updated_at`` was absent, so
    a rebuilt mesh kept the timestamp of the build that first created it (correct
    content, stale metadata — which led to reporting that a successful build had
    never persisted). ``generation_id`` was absent the moment it was added, so
    the first build after shipping build provenance wrote 81 meshes and left every
    one of them pointing at no generation. Neither was visible to any test.

    Parameters
    ----------
    row_keys : Iterable of str
        The keys of one upsert row dict.

    Returns
    -------
    list of str
        The updatable columns, in the row's own key order so the generated
        statement is deterministic.
    """
    return [key for key in row_keys if key not in _UPSERT_IDENTITY_COLUMNS]


@dataclass(frozen=True)
class _SolidMeta:
    """The three ``litho_body_solid`` columns the cache-validity helpers read.

    ``_load_existing`` returns these instead of full ORM rows so the cache-skip
    / orphan-sweep path never deserialises the large JSONB ``vertices`` /
    ``triangles`` blobs (4.7 M+ verts on ``test.strix``) just to read a
    checksum.  ``_digest_matches_all`` reads ``source_pick_checksum`` +
    ``is_stale``; ``_delete_orphans`` reads only the dict KEY (``body_id``).

    Attributes
    ----------
    body_id : str
        The stored ``body_id`` as a string (the dict key in ``_load_existing``).
    source_pick_checksum : bytes
        The model-level digest stamped on the row.
    is_stale : bool
        Whether the row was marked stale (forces a rebuild).
    """

    body_id: str
    source_pick_checksum: bytes
    is_stale: bool


@dataclass(frozen=True)
class LithoSolidsOutcome:
    """Summary of one litho-solid (re)build pass.

    Shared by both the strat and voxel builders; the API maps it onto
    ``RebuildLithoSolidsResponse`` unchanged.

    Attributes
    ----------
    bodies_considered : int
        Total bodies found across the built meshes (+ any flagged rows).
    bodies_built : int
        Bodies whose solid was freshly (re-)built and upserted.
    bodies_skipped_checksum : int
        Bodies skipped because the model-level digest matched (all or none).
    bodies_flagged : int
        Bodies emitted as flagged empty rows.  ``0`` on the happy path; a
        non-zero value flags an unbuildable / non-conformable model.
    orphans_deleted : int
        ``litho_body_solid`` rows removed because their ``body_id`` was no
        longer among the built bodies.
    marked_test_ids : list[str]
        Investigation ids the build dropped/marked.  Always empty for the
        voxel + strat paths; retained for API-shape parity with the loft
        contract (``RebuildLithoSolidsResponse.marked_test_ids``).
    """

    bodies_considered: int
    bodies_built: int
    bodies_skipped_checksum: int
    bodies_flagged: int
    orphans_deleted: int
    marked_test_ids: list[str]


def storage_body_id(mesh_body_id: str) -> UUID:
    """Map a mesh ``body_id`` string to the UUID stored in ``litho_body_solid``.

    A real UUID string passes through unchanged.  A synthetic builder token
    (the strat ``"strat:…"`` / ``"lens:…"`` band ids, the voxel ``"__none__:…"``
    minority ids) is not a UUID and has no row in the ``body`` table —
    ``body_id`` on ``litho_body_solid`` is intentionally NOT an FK (see the ORM
    docstring), so a deterministic ``uuid5`` over the token is a stable storage
    key that survives rebuilds without churning the cache.

    Parameters
    ----------
    mesh_body_id : str
        The mesh's ``body_id`` — a real UUID string or a synthetic token.

    Returns
    -------
    UUID
        The id to store on the solid row.
    """
    try:
        return UUID(mesh_body_id)
    except ValueError:
        # Synthetic builder token — derive a stable UUID.
        return uuid5(NAMESPACE_OID, mesh_body_id)


class LithoSolidPersistenceMixin(GroundModelLogger):
    """Upsert / orphan / checksum-compare helpers for ``litho_body_solid``.

    Mixed into a use case that owns ``self._session`` (an ``AsyncSession``).
    The concrete use case sets :attr:`_solid_method` to the ``method`` column
    value it writes (``"strat"`` / ``"voxel"``).  The mixin commits nothing —
    the use case owns the transaction boundary.

    Notes
    -----
    Inherits :class:`GroundModelLogger`; a concrete use case calls
    ``super().__init__(__name__)`` so the logger reflects the use case's module.
    """

    # The session the use case owns.  Declared for the type checker; the
    # concrete use case binds it in ``__init__``.
    _session: AsyncSession

    # ``method`` column value written on every row.  Subclasses MUST override
    # (asserted in ``_mesh_rows``); the empty default guards a future subclass
    # that forgets to set it from silently writing a wrong / retired method.
    _solid_method: str = ""

    # Maximum rows per VALUES clause in a batched upsert.  Each row carries
    # JSONB ``vertices`` + ``triangles`` that can be large; keeping the chunk
    # small avoids enormous single statements and bounds PostgreSQL's per-
    # statement memory overhead.  100 rows × ~10 bound parameters = ~1 000
    # parameters well below the 65 535 PostgreSQL limit, while each chunk is
    # still a single network round-trip.
    _UPSERT_CHUNK_SIZE: int = 100

    def _mesh_rows(
        self, meshes: list[LithoBodyMesh], model_id: UUID, checksum: bytes
    ) -> list[dict[str, Any]]:
        """Convert a list of :class:`LithoBodyMesh` objects to upsert-row dicts.

        Parameters
        ----------
        meshes : list[LithoBodyMesh]
            The watertight body solids.
        model_id : UUID
            The model scope.
        checksum : bytes
            The model-level digest to stamp on every row.

        Returns
        -------
        list[dict[str, Any]]
            Value dicts ready for :meth:`_batch_upsert`.
        """
        assert self._solid_method, f"{type(self).__name__} must set _solid_method"
        return [
            dict(
                id=uuid7(),
                model_id=model_id,
                body_id=storage_body_id(mesh.body_id),
                formation_id=UUID(mesh.formation_id),
                method=self._solid_method,
                # Pass the list-of-tuples directly: json.dumps (which asyncpg's
                # JSONB binder uses) serialises Python tuples as JSON arrays —
                # identical output to list-of-lists.  Eliminates the per-vertex
                # tuple→list churn that dominated the real-data build profile.
                vertices=mesh.vertices,
                triangles=mesh.triangles,
                # ``source_pick_count`` is INFORMATIONAL only — cache validity is
                # decided solely by the model-level ``source_pick_checksum`` (the
                # build is global, so a per-row count cannot gate the skip).  Both
                # builders store the mesh vertex count here as a cheap size hint;
                # it is never compared.
                source_pick_count=len(mesh.vertices),
                source_pick_checksum=checksum,
                is_flagged=mesh.is_flagged,
                is_stale=False,
            )
            for mesh in meshes
        ]

    async def _batch_upsert(self, rows: list[dict[str, Any]]) -> int:
        """Upsert a list of solid-row dicts in chunked multi-row statements.

        Each chunk is a single ``INSERT … ON CONFLICT (model_id, body_id) DO
        UPDATE`` statement with up to :attr:`_UPSERT_CHUNK_SIZE` rows in its
        ``VALUES`` clause.  Using ``stmt.excluded.<col>`` in the ``set_``
        clause ensures every row's own proposed values are applied on conflict
        (required for multi-row upserts; a closed-over per-row value would
        apply the last row's values to every conflict).

        PK stability: ``ON CONFLICT DO UPDATE`` on the unique constraint
        ``uq_litho_body_solid_model_body`` leaves the existing row's ``id``
        untouched — PostgreSQL applies the ``set_`` clause (which does NOT
        include ``id``) and the proposed ``id`` from the ``VALUES`` clause is
        discarded.  New rows are inserted with the freshly-minted ``uuid7()``
        ``id`` from the caller.  Both paths produce a stable PK, so there is no
        need to load existing rows' PKs before the upsert.

        Parameters
        ----------
        rows : list[dict[str, Any]]
            Value dicts, each containing all ``LithoBodySolidOrm`` columns.
            Must be non-empty; the caller guards against an empty mesh list.

        Returns
        -------
        int
            Number of chunks executed (for the INFO log).
        """
        from sqlalchemy.dialects.postgresql import insert as pg_insert

        chunk_size = self._UPSERT_CHUNK_SIZE
        chunks = [rows[i : i + chunk_size] for i in range(0, len(rows), chunk_size)]
        for chunk in chunks:
            stmt = pg_insert(LithoBodySolidOrm).values(chunk)
            # Derived, not hand-listed — see ``_upsert_update_columns``. Every
            # row in a chunk comes from one comprehension, so they share keys.
            updates = {
                column: getattr(stmt.excluded, column)
                for column in _upsert_update_columns(chunk[0])
            }
            # The ORM column declares ``onupdate=func.now()``, but that only
            # fires on an ORM-level UPDATE — a Core ``on_conflict_do_update``
            # bypasses it, so the timestamp has to be set explicitly.
            updates["updated_at"] = func.now()
            stmt = stmt.on_conflict_do_update(
                constraint="uq_litho_body_solid_model_body",
                set_=updates,
            )
            await self._session.execute(stmt)
        return len(chunks)

    async def _load_existing(self, model_id: UUID) -> dict[str, _SolidMeta]:
        """Load the model's stored solid metadata keyed by ``str(body_id)``.

        Projects ONLY the three columns the cache-validity helpers read
        (``body_id``, ``source_pick_checksum``, ``is_stale``) into a lightweight
        :class:`_SolidMeta` — it does NOT select the large JSONB ``vertices`` /
        ``triangles`` blobs.  On ``test.strix`` a full-row ``SELECT *`` here
        deserialised ~4.7 M vertices on every build just to compare a checksum;
        the column projection avoids that entirely.

        Loads EVERY row for the model, NOT just rows matching ``_solid_method``.
        This is deliberate: a model has exactly one active builder at a time, and
        switching builders (strat → voxel or back) must SWEEP the previous
        builder's rows — the GET endpoint does not filter by ``method``, so a
        leftover strat row would render alongside the voxel rows.  Combined with
        :meth:`_delete_orphans` (which prunes every stored id not in the current
        build's wanted set), a voxel build correctly clears the old strat solids
        and vice-versa (observed on ``test.strix``: 1082 strat orphans swept).

        ⚠ Do NOT add a ``method == self._solid_method`` filter here to "scope" the
        load: it would leave the other builder's rows orphaned in the table.  If
        concurrent builds ever become possible (an async ``TaskQueue`` replacing
        ``SynchronousQueue``), serialise the two builders per model instead —
        method-scoping the load would silently double-render, not fix the race.

        Parameters
        ----------
        model_id : UUID
            The model scope.

        Returns
        -------
        dict[str, _SolidMeta]
            Stored row metadata keyed by ``str(body_id)``.
        """
        result = await self._session.execute(
            select(
                LithoBodySolidOrm.body_id,
                LithoBodySolidOrm.source_pick_checksum,
                LithoBodySolidOrm.is_stale,
            ).where(LithoBodySolidOrm.model_id == model_id)
        )
        return {
            str(body_id): _SolidMeta(
                body_id=str(body_id),
                source_pick_checksum=source_pick_checksum,
                is_stale=is_stale,
            )
            for body_id, source_pick_checksum, is_stale in result.all()
        }

    def _digest_matches_all(
        self,
        existing_by_body: dict[str, _SolidMeta],
        wanted_storage_ids: set[str],
        new_checksum: bytes,
    ) -> bool:
        """True when every wanted body has a fresh row carrying ``new_checksum``.

        The build digest is model-level, so the skip is all-or-nothing: a single
        stale or missing row (or a digest mismatch) forces a full rebuild.

        Parameters
        ----------
        existing_by_body : dict[str, _SolidMeta]
            Stored row metadata keyed by ``str(body_id)``.
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

    async def _delete_orphans(
        self,
        model_id: UUID,
        existing_by_body: dict[str, _SolidMeta],
        wanted_storage_ids: set[str],
    ) -> int:
        """Delete stored rows whose body is no longer built.

        Only the dict KEYS (``str(body_id)``) are read here, so the lightweight
        :class:`_SolidMeta` values carry everything this method needs.

        Parameters
        ----------
        model_id : UUID
            The model scope.
        existing_by_body : dict[str, _SolidMeta]
            Stored row metadata keyed by ``str(body_id)``.
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
            self.info(f"litho-solids: deleted {deleted} orphan solid(s) for model={model_id}")
        return deleted
