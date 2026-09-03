"""The engine must survive a dead pooled connection.

Rule: a pooled connection whose transport died (the embedded Postgres was
restarted, a backend was terminated, a background job's connection went
stale) is replaced transparently on checkout instead of surfacing as
``AttributeError: 'NoneType' object has no attribute 'send'`` on the next
statement — the failure the voxel-job cancel test hit on 2026-09-03.
"""

from groundmodel.infrastructure.db.session import engine


def test_the_engine_pre_pings_pooled_connections() -> None:
    """A stale pooled connection is detected and replaced on checkout."""
    assert engine.pool._pre_ping is True  # noqa: SLF001 — the pool exposes no public getter
