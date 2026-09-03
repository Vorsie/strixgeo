"""Unit tests for the lock-timeout error predicate (M3)."""

from __future__ import annotations

from groundmodel.infrastructure.db.lock_errors import (
    LOCK_NOT_AVAILABLE_SQLSTATE,
    is_lock_not_available,
)


class _Orig:
    def __init__(self, sqlstate: str) -> None:
        self.sqlstate = sqlstate


class _Wrapped(Exception):
    """SQLAlchemy-shaped wrapper carrying the driver error on ``.orig``."""

    def __init__(self, sqlstate: str) -> None:
        super().__init__("db error")
        self.orig = _Orig(sqlstate)


class _Bare(Exception):
    """asyncpg-shaped error carrying ``.sqlstate`` directly."""

    def __init__(self, sqlstate: str) -> None:
        super().__init__("db error")
        self.sqlstate = sqlstate


def test_constant_is_the_lock_not_available_sqlstate() -> None:
    """The SQLSTATE constant is Postgres' lock_not_available code."""
    assert LOCK_NOT_AVAILABLE_SQLSTATE == "55P03"


def test_detects_wrapped_lock_timeout() -> None:
    """A SQLAlchemy-wrapped 55P03 (on ``.orig``) is recognised."""
    assert is_lock_not_available(_Wrapped("55P03")) is True


def test_detects_bare_lock_timeout() -> None:
    """A bare asyncpg 55P03 (``.sqlstate`` on the error itself) is recognised."""
    assert is_lock_not_available(_Bare("55P03")) is True


def test_ignores_other_sqlstates() -> None:
    """A different SQLSTATE (unique violation, statement timeout) is not a lock timeout."""
    assert is_lock_not_available(_Wrapped("23505")) is False  # unique_violation
    assert is_lock_not_available(_Bare("57014")) is False  # statement_timeout


def test_ignores_plain_exceptions() -> None:
    """A plain exception with no SQLSTATE is never a lock timeout."""
    assert is_lock_not_available(RuntimeError("boom")) is False
