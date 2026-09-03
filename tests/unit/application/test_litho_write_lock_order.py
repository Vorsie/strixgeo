"""BP-4 (unit) — every litho_layer writer takes the partition lock before its first write.

Companion to the integration pin
``tests/integration/api/test_body_partition_litho_write_recompute_race.py`` (BP-2/BP-4)
and a sibling of ``test_body_partition_lock_order.py`` (BP-3): those reproduce the
live deadlock against Postgres, this pins the order-of-operations invariant that
fixes it at the unit level with a mocked session.

THE RULE PINNED (in the ruling's own words): *every use case that writes
litho_layer rows takes the litho model's partition lock before its first write, in
the same canonical order as the resolver — own litho lock, then the sibling
geotech locks — so it serialises with bodies/recompute instead of deadlocking.*

The mechanism it defends: inserting or updating a ``litho_layer`` row whose
``body_id`` references a ``body`` row takes a FOR-KEY-SHARE lock on that body row,
so a litho-row writer holds body-row locks while ``bodies/recompute`` holds the
per-model advisory lock and waits on those same rows — an ABBA deadlock, because
the writer never took the advisory lock. Taking the advisory lock (own + sibling
geotech) BEFORE the first write closes it: everyone reaches for the rows only
after they hold the shared lock, so the two serialise.

The five writers pinned here are the ones a grep showed were missing the lock:
``accept_litho_suggestions``, ``batch_accept_litho_suggestions``,
``move_litho_layer_boundary``, ``update_litho_layer`` and
``bulk_create_litho_layers``. Batch-accept delegates to accept per anchor; the
lock is taken ONCE at the outermost use case and the inner one takes none while a
batch context is set (pinned by the batch-mode contrast test) — advisory xact
locks are re-entrant, so taking it once only keeps the contention log clean.

No DB or network I/O: the two lock helpers are patched to record each acquisition
(``create=True`` so the pin fails cleanly on the UNMODIFIED code, where the writers
do not import them yet), and a recording fake session raises ``_StopWrite`` on its
first INSERT / UPDATE / flush so the run stops the instant a write is attempted,
leaving the event order to assert on.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch
from uuid import UUID

import pytest
from sqlalchemy.sql.dml import Delete, Update
from uuid6 import uuid7

from groundmodel.application import accept_litho_suggestions as acc
from groundmodel.application import batch_accept_litho_suggestions as bal
from groundmodel.application import bulk_create_litho_layers as bcl
from groundmodel.application import move_litho_layer_boundary as mlb
from groundmodel.application import update_litho_layer as ull
from groundmodel.application.accept_litho_suggestions import (
    AcceptLithoSuggestions,
    BatchAcceptContext,
)
from groundmodel.application.batch_accept_litho_suggestions import (
    BatchAcceptAnchorInput,
    BatchAcceptLithoSuggestions,
)
from groundmodel.application.bulk_create_litho_layers import (
    BulkCreateLithoLayers,
    LithoLayerCreateRequest,
)
from groundmodel.application.move_litho_layer_boundary import MoveLithoLayerBoundary
from groundmodel.application.update_litho_layer import UpdateLithoLayer
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm

_PROJECT = UUID("00000000-0000-0000-0000-0000000000aa")
_LITHO_MODEL = UUID("00000000-0000-0000-0000-0000000000b1")
_LAYER_A = UUID("00000000-0000-0000-0000-0000000000e1")
_LAYER_B = UUID("00000000-0000-0000-0000-0000000000e2")
_BOREHOLE = UUID("00000000-0000-0000-0000-0000000000f1")


class _StopWrite(Exception):
    """Raised by the fake session's first write to stop the use case early.

    The invariant under test is purely the ORDER of the two lock acquisitions
    relative to the first body/layer write, so the run only has to reach that
    first write — stopping there keeps the fake free of the whole post-write path
    (flush, commit, refresh, seeding).
    """


class _Scalars:
    """Mimics ``result.scalars()`` — only ``.all()`` is exercised."""

    def __init__(self, rows: list) -> None:
        self._rows = rows

    def all(self) -> list:
        """Return the pre-programmed scalar rows."""
        return self._rows


class _Result:
    """A pre-programmed ``session.execute`` result for one SELECT."""

    def __init__(self, rows: list | None = None, scalar_rows: list | None = None) -> None:
        self._rows = rows or []
        self._scalar_rows = scalar_rows or []

    def all(self) -> list:
        """Return the ``.all()`` rows (the geo-contacts / existing-layers shape)."""
        return self._rows

    def scalars(self) -> _Scalars:
        """Return the ``.scalars()`` proxy (the formation-list / layers shape)."""
        return _Scalars(self._scalar_rows)

    def scalar_one_or_none(self) -> object | None:
        """Return the single scalar row, or ``None`` — used by the layer dedup SELECT."""
        return self._scalar_rows[0] if self._scalar_rows else None


class _RecordingSession:
    """Fake ``AsyncSession`` that records write ORDER and stops at write one.

    SELECTs are served from ``read_result`` (the same empty/preloaded result for
    every read — the writers under test issue at most one meaningful SELECT before
    their first write); ``session.get`` is served from ``get_returns`` keyed by ORM
    class; and the first ORM ``add`` / ``delete``, the first Core ``Update`` /
    ``Delete`` execute, or the first ``flush`` records a write and raises
    ``_StopWrite`` so the use case halts the moment it tries to touch a row.
    """

    def __init__(
        self,
        events: list,
        *,
        get_returns: dict[type, object] | None = None,
        read_result: _Result | None = None,
    ) -> None:
        self.events = events
        self._get_returns = get_returns or {}
        self._read_result = read_result if read_result is not None else _Result()

    async def get(self, cls: type, _ident: object) -> object | None:
        """Return the fake row pre-programmed for ``cls`` (or None)."""
        return self._get_returns.get(cls)

    async def execute(self, stmt: object, *_a: object, **_k: object) -> _Result:
        """Serve a SELECT from the read result; record an UPDATE/DELETE as a write."""
        if isinstance(stmt, (Update, Delete)):
            self.events.append(("write", "EXECUTE"))
            raise _StopWrite
        return self._read_result

    def add(self, _obj: object) -> None:
        """Record the first INSERT and stop the use case."""
        self.events.append(("write", "INSERT"))
        raise _StopWrite

    def add_all(self, _objs: object) -> None:
        """Record a bulk INSERT and stop the use case."""
        self.events.append(("write", "INSERT"))
        raise _StopWrite

    async def delete(self, _obj: object) -> None:
        """Record a DELETE and stop the use case."""
        self.events.append(("write", "DELETE"))
        raise _StopWrite

    async def flush(self) -> None:
        """Record a flush (the first DB write for the update path) and stop."""
        self.events.append(("write", "FLUSH"))
        raise _StopWrite

    async def commit(self) -> None:
        """Not reached — a write raises first."""
        self.events.append(("write", "COMMIT"))
        raise _StopWrite


def _record_locks(events: list) -> tuple:
    """Return ``(own_lock, sibling_lock)`` recorders appending to ``events``.

    Both are patched over the two module-level helpers with ``create=True`` so the
    pin also runs against the UNMODIFIED writers (which do not import them yet) —
    there the recorders are simply never called, the first write lands with no
    preceding lock, and the order assertion fails RED.
    """

    async def _own(_s: object, *, model_id: UUID, operation: str) -> None:
        events.append(("own-lock", operation))

    async def _sibling(_s: object, *, litho_model_id: UUID, operation: str) -> list[UUID]:
        events.append(("sibling-lock", operation))
        return []

    return _own, _sibling


def _assert_locks_precede_first_write(events: list, operation: str) -> None:
    """Assert both advisory locks were taken, in canonical order, before write one."""
    assert ("own-lock", operation) in events, (
        f"own litho lock ({operation}) never taken — first write reached unguarded: {events}"
    )
    assert ("sibling-lock", operation) in events, (
        f"sibling geotech lock ({operation}) never taken: {events}"
    )
    write_indices = [i for i, e in enumerate(events) if e[0] == "write"]
    assert write_indices, f"the run never reached a write: {events}"
    first_write = write_indices[0]
    own_idx = next(i for i, e in enumerate(events) if e == ("own-lock", operation))
    sibling_idx = next(i for i, e in enumerate(events) if e == ("sibling-lock", operation))
    assert own_idx < sibling_idx < first_write, (
        f"canonical order broken — expected own-lock then sibling-lock then the first "
        f"write, got {events}"
    )


def _suggestion() -> SimpleNamespace:
    """One segmenter suggestion shaped like ``LithoLayerSuggestion`` for the accept loop.

    Only the fields the accept path touches BEFORE its first write are populated:
    ``suggested_lithology`` + ``suggested_admixtures`` (find-or-create key) and the
    two depths (the loop's debug log). The run stops at the first formation INSERT,
    so ``confidence`` / ``source`` are never read.
    """
    return SimpleNamespace(
        suggested_lithology="ZAND",
        suggested_admixtures=(),
        depth_top_m=0.0,
        depth_base_m=2.0,
    )


@pytest.mark.asyncio
async def test_move_litho_layer_boundary_locks_before_the_first_write() -> None:
    """``MoveLithoLayerBoundary`` takes both partition locks before the first UPDATE.

    It UPDATEs two accepted ``litho_layer`` rows (and stales the solid cache); the
    row UPDATE takes a FOR-KEY-SHARE lock on the referenced ``body`` row that
    ``bodies/recompute`` re-stamps. The advisory lock must precede that write.
    """
    events: list = []
    upper = SimpleNamespace(
        id=_LAYER_A,
        cpt_id=None,
        borehole_id=_BOREHOLE,
        depth_top_m=2.0,
        depth_base_m=5.0,
        parent_geo_contact_id=None,
        model_id=_LITHO_MODEL,
    )
    lower = SimpleNamespace(
        id=_LAYER_B,
        cpt_id=None,
        borehole_id=_BOREHOLE,
        depth_top_m=5.0,
        depth_base_m=8.0,
        parent_geo_contact_id=None,
        model_id=_LITHO_MODEL,
    )
    session = _RecordingSession(events, read_result=_Result(scalar_rows=[upper, lower]))
    own, sibling = _record_locks(events)

    with (
        patch.object(mlb, "lock_body_partition", own, create=True),
        patch.object(mlb, "lock_sibling_geotech_partitions", sibling, create=True),
    ):
        with pytest.raises(_StopWrite):
            await MoveLithoLayerBoundary(session).execute(  # type: ignore[arg-type]
                _LAYER_A, _LAYER_B, 4.5, model_id=_LITHO_MODEL
            )

    _assert_locks_precede_first_write(events, "move-litho-layer-boundary")


@pytest.mark.asyncio
async def test_update_litho_layer_locks_before_the_first_write() -> None:
    """``UpdateLithoLayer`` takes both partition locks before the flush that writes."""
    events: list = []
    layer = SimpleNamespace(id=_LAYER_A, model_id=_LITHO_MODEL, notes=None)
    session = _RecordingSession(events, get_returns={LithoLayerOrm: layer})
    own, sibling = _record_locks(events)

    with (
        patch.object(ull, "lock_body_partition", own, create=True),
        patch.object(ull, "lock_sibling_geotech_partitions", sibling, create=True),
    ):
        with pytest.raises(_StopWrite):
            await UpdateLithoLayer(session).execute(  # type: ignore[arg-type]
                _LAYER_A, {"notes": "edited"}, model_id=_LITHO_MODEL
            )

    _assert_locks_precede_first_write(events, "update-litho-layer")


@pytest.mark.asyncio
async def test_bulk_create_litho_layers_locks_before_the_first_write() -> None:
    """``BulkCreateLithoLayers`` takes both partition locks before the first INSERT."""
    events: list = []
    session = _RecordingSession(events)
    own, sibling = _record_locks(events)
    layers = [
        LithoLayerCreateRequest(formation_id=uuid7(), depth_top_m=0.0, depth_base_m=1.0),
    ]

    with (
        patch.object(bcl, "lock_body_partition", own, create=True),
        patch.object(bcl, "lock_sibling_geotech_partitions", sibling, create=True),
    ):
        with pytest.raises(_StopWrite):
            # project_id=None skips the formation scope guard so the first write is
            # the row INSERT; the lock-before-write invariant is unchanged.
            await BulkCreateLithoLayers(session).execute(_LITHO_MODEL, layers)  # type: ignore[arg-type]

    _assert_locks_precede_first_write(events, "bulk-create-litho-layers")


@pytest.mark.asyncio
async def test_accept_litho_suggestions_locks_before_the_first_write() -> None:
    """Single-accept takes both partition locks before the first formation INSERT."""
    events: list = []
    session = _RecordingSession(
        events,
        get_returns={
            BoreholeOrm: SimpleNamespace(app_project_id=_PROJECT),
            # parent_model_id=None → the litho↔geo coupling read is skipped, so the
            # first write is the formation INSERT inside the suggestion loop.
            GeologicalModelOrm: SimpleNamespace(app_project_id=_PROJECT, parent_model_id=None),
        },
    )
    own, sibling = _record_locks(events)

    with (
        patch.object(acc, "lock_body_partition", own, create=True),
        patch.object(acc, "lock_sibling_geotech_partitions", sibling, create=True),
    ):
        with pytest.raises(_StopWrite):
            await AcceptLithoSuggestions(session).execute(  # type: ignore[arg-type]
                project_id=_PROJECT,
                litho_model_id=_LITHO_MODEL,
                suggestions=[_suggestion()],
                borehole_id=_BOREHOLE,
            )

    _assert_locks_precede_first_write(events, "accept-litho-suggestions")


@pytest.mark.asyncio
async def test_accept_litho_suggestions_in_batch_mode_takes_no_lock() -> None:
    """Inner accept takes NO lock when a batch context is set — the batch holds it once.

    The contrast case for the "take the lock ONCE at the outermost use case" rule:
    with ``batch_ctx`` supplied, the inner accept must reach its first write without
    acquiring the partition lock (the batch use case took it before the loop).
    Guards against a future edit that locks per anchor and muddies the contention
    log with N re-entrant takes.
    """
    events: list = []
    session = _RecordingSession(
        events,
        get_returns={BoreholeOrm: SimpleNamespace(app_project_id=_PROJECT)},
    )
    own, sibling = _record_locks(events)
    batch_ctx = BatchAcceptContext(geology_model_id=None, litho_formations={}, existing_layers={})

    with (
        patch.object(acc, "lock_body_partition", own, create=True),
        patch.object(acc, "lock_sibling_geotech_partitions", sibling, create=True),
    ):
        with pytest.raises(_StopWrite):
            await AcceptLithoSuggestions(session).execute(  # type: ignore[arg-type]
                project_id=_PROJECT,
                litho_model_id=_LITHO_MODEL,
                suggestions=[_suggestion()],
                borehole_id=_BOREHOLE,
                batch_ctx=batch_ctx,
                commit=False,
            )

    assert events == [("write", "INSERT")], (
        f"the inner accept must not take the partition lock in batch mode — got {events}"
    )


@pytest.mark.asyncio
async def test_batch_accept_litho_suggestions_locks_once_before_the_first_write() -> None:
    """``BatchAcceptLithoSuggestions`` takes both partition locks once, before any anchor writes.

    The lock is taken after ``build_batch_context`` (read-only scope + lookups) and
    before the per-anchor accept loop, so the whole batch's writes serialise with
    ``bodies/recompute`` under one advisory-lock take — and the inner accept, in
    batch mode, adds no second take.
    """
    events: list = []
    session = _RecordingSession(
        events,
        get_returns={
            BoreholeOrm: SimpleNamespace(app_project_id=_PROJECT),
            GeologicalModelOrm: SimpleNamespace(app_project_id=_PROJECT, parent_model_id=None),
        },
    )
    own, sibling = _record_locks(events)
    anchors = [BatchAcceptAnchorInput(suggestions=[_suggestion()], borehole_id=_BOREHOLE)]

    with (
        patch.object(bal, "lock_body_partition", own, create=True),
        patch.object(bal, "lock_sibling_geotech_partitions", sibling, create=True),
        # The inner accept's own module names are also patched so that, if the inner
        # accept DID try to take the lock in batch mode, it would show up in events
        # (it must not — the assertion below counts exactly one own-lock).
        patch.object(acc, "lock_body_partition", own, create=True),
        patch.object(acc, "lock_sibling_geotech_partitions", sibling, create=True),
    ):
        with pytest.raises(_StopWrite):
            await BatchAcceptLithoSuggestions(session).execute(  # type: ignore[arg-type]
                project_id=_PROJECT,
                litho_model_id=_LITHO_MODEL,
                anchors=anchors,
            )

    _assert_locks_precede_first_write(events, "batch-accept-litho-suggestions")
    # Exactly one own-lock across the whole batch — the inner accept took none.
    assert [e for e in events if e[0] == "own-lock"] == [
        ("own-lock", "batch-accept-litho-suggestions")
    ], f"the lock must be taken ONCE at the batch level, not per anchor — got {events}"
