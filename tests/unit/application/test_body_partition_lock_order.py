"""BP-3 (unit) — the litho resolver takes its geotech child's lock BEFORE any write.

Companion to the integration pin
``tests/integration/api/test_body_partition_litho_geotech_lock_order.py`` (BP-3):
that reproduces the live ABBA deadlock against Postgres; this pins the
order-of-operations invariant that fixes it, at the unit level with a mocked
session — the two advisory-lock acquisitions (this model's own lock, then each
sibling geotech child's lock) happen BEFORE ``_run_resolver`` issues its first
body write (INSERT / DELETE).

The mechanism the order defends: deleting a litho ``body`` row fires the
``ON DELETE SET NULL`` action of the geotech rows' ``parent_litho_body_id`` FK —
a hidden write that row-locks the geotech ``body`` rows. Taking the geotech lock
only AFTER that (the old step 6) let a concurrent geotech recompute, holding the
geotech advisory lock and deleting those rows, deadlock. Taking the child lock up
front — before the first write — closes it.

No DB or network I/O: ``lock_body_partition`` is patched to record each
acquisition, and a recording fake session raises ``_StopResolver`` on its first
write so the run stops the instant a write is attempted, leaving the event order
to assert on.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch
from uuid import UUID

import pytest
from sqlalchemy.sql.dml import Delete, Update

from groundmodel.application import resolve_litho_instances_use_case as uc

_PROJECT = UUID("00000000-0000-0000-0000-0000000000aa")
_LITHO_MODEL = UUID("00000000-0000-0000-0000-0000000000b1")
_GEOTECH_SIBLING = UUID("00000000-0000-0000-0000-0000000000c1")
_FORMATION = UUID("00000000-0000-0000-0000-0000000000d1")
_LAYER = UUID("00000000-0000-0000-0000-0000000000e1")
_INVESTIGATION = UUID("00000000-0000-0000-0000-0000000000f1")


class _StopResolver(Exception):
    """Raised by the fake session's first write to stop ``_run_resolver`` early.

    The invariant under test is purely the ORDER of the lock acquisitions
    relative to the first body write, so the run only has to reach that first
    write — stopping there keeps the fake free of the whole post-write path
    (stamp UPDATE, stale-marking, step-6 UPDATE).
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
        self._scalar_rows = scalar_rows if scalar_rows is not None else []

    def all(self) -> list:
        """Return the ``.all()`` rows (the ``layer_rows`` / edges / facts shape)."""
        return self._rows

    def scalars(self) -> _Scalars:
        """Return the ``.scalars()`` proxy (the sibling-ids / bodies shape)."""
        return _Scalars(self._scalar_rows)

    def scalar_one(self) -> None:
        """Return ``None`` — no caller in the pre-write path asserts on this."""
        return None

    @property
    def rowcount(self) -> int:
        """Return ``0`` — the pre-write path never reaches a counted write."""
        return 0


class _RecordingSession:
    """Fake ``AsyncSession`` that records lock/write ORDER and stops at write one.

    SELECTs are served from an ordered ``read_queue`` (popped in issue order);
    a Core ``Update`` / ``Delete`` and every ORM ``add`` / ``delete`` are
    recorded as a write, and the first ORM write raises ``_StopResolver`` so the
    resolver halts the moment it tries to touch a body row.
    """

    def __init__(self, model: SimpleNamespace, read_queue: list[_Result], events: list) -> None:
        self._model = model
        self._read_queue = read_queue
        self.events = events

    async def get(self, _cls: object, _ident: object) -> SimpleNamespace:
        """Return the fake model for the ``session.get(GeologicalModelOrm, id)`` call."""
        return self._model

    async def execute(self, stmt: object, *_a: object, **_k: object) -> _Result:
        """Serve a SELECT from the queue; record an UPDATE/DELETE as a write."""
        if isinstance(stmt, (Update, Delete)):
            self.events.append(("write", "EXECUTE"))
            return _Result()
        return self._read_queue.pop(0) if self._read_queue else _Result()

    def add(self, _obj: object) -> None:
        """Record the first body INSERT and stop the resolver."""
        self.events.append(("write", "INSERT"))
        raise _StopResolver

    def delete(self, _obj: object) -> None:
        """Record a body DELETE and stop the resolver."""
        self.events.append(("write", "DELETE"))
        raise _StopResolver

    async def flush(self) -> None:
        """No-op flush — the resolver never reaches it before the first write."""
        return None


def _layer_row() -> SimpleNamespace:
    """One accepted-layer row shaped like the ``layer_rows`` SELECT projection."""
    return SimpleNamespace(
        id=_LAYER,
        formation_id=_FORMATION,
        depth_top_m=0.0,
        borehole_id=_INVESTIGATION,
        cpt_id=None,
        body_id=None,
        parent_litho_layer_id=None,
        parent_formation_id=None,
        litho_main_soil_code="ZAND",
        nad_class=None,
    )


async def _run_events(*, kind: str, read_queue: list[_Result]) -> list:
    """Run ``_run_resolver`` to its first write and return the ordered event log.

    ``lock_body_partition`` is patched to append ``("lock", operation)`` so the
    two advisory-lock acquisitions are captured in the same log as the writes.
    """
    events: list = []
    model = SimpleNamespace(kind=kind, app_project_id=_PROJECT)
    session = _RecordingSession(model, read_queue, events)

    async def _fake_lock(_session: object, *, model_id: UUID, operation: str) -> None:
        events.append(("lock", operation))

    with patch.object(uc, "lock_body_partition", _fake_lock):
        try:
            await uc._run_resolver(session, _LITHO_MODEL)  # type: ignore[arg-type]
        except _StopResolver:
            pass
    return events


@pytest.mark.asyncio
async def test_bp3_unit_litho_takes_geotech_sibling_lock_before_the_first_write() -> None:
    """A litho resolve with a geotech child takes BOTH locks before any body write.

    Order pinned: this model's own lock (``resolve-litho-instances``), then the
    sibling geotech child's lock (``restamp-parent-litho-body``), then — only
    after both — the first body INSERT. The old code took the geotech lock at
    step 6, AFTER the litho body deletes, which is the ABBA deadlock BP-3 hits.
    """
    read_queue = [
        _Result(scalar_rows=[_GEOTECH_SIBLING]),  # sibling geotech ids (up-front)
        _Result(rows=[_layer_row()]),  # accepted layer rows
        _Result(rows=[]),  # correlation edges
        _Result(rows=[]),  # geometry facts
        _Result(rows=[]),  # separations
        _Result(rows=[]),  # unions
        _Result(scalar_rows=[]),  # existing bodies (none → the instance is INSERTed)
    ]
    events = await _run_events(kind="lithostratigraphic", read_queue=read_queue)

    # Exactly the invariant: both advisory locks, in parent-first order, precede
    # the first write.
    assert events == [
        ("lock", "resolve-litho-instances"),
        ("lock", "restamp-parent-litho-body"),
        ("write", "INSERT"),
    ], events

    write_index = next(i for i, e in enumerate(events) if e[0] == "write")
    lock_indices = [i for i, e in enumerate(events) if e[0] == "lock"]
    assert lock_indices == [0, 1], events
    assert all(i < write_index for i in lock_indices), (
        f"both advisory locks must be acquired before the first body write — got {events}"
    )


@pytest.mark.asyncio
async def test_bp3_unit_geotech_resolve_takes_only_its_own_lock() -> None:
    """A geotech resolve takes ONLY its own lock (no sibling) before the first write.

    The contrast case: the sibling-geotech lock is a LITHO-model concern — a
    geotech model has no geotech children, so it never reaches for a second lock.
    This guards against a future edit taking the sibling lock unconditionally.
    """
    read_queue = [
        _Result(rows=[_layer_row()]),  # accepted layer rows (no sibling SELECT first)
        _Result(rows=[]),  # correlation edges
        _Result(rows=[]),  # geometry facts
        _Result(rows=[]),  # separations
        _Result(rows=[]),  # unions
        _Result(scalar_rows=[]),  # existing bodies
    ]
    events = await _run_events(kind="geotechnical", read_queue=read_queue)

    assert events == [
        ("lock", "resolve-litho-instances"),
        ("write", "INSERT"),
    ], events
