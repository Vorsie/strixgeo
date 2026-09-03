"""Detect PostgreSQL lock/statement-timeout errors surfaced through SQLAlchemy.

When ``lock_timeout`` (set on the session, see ``session.py``) fires while a
statement waits for a lock, PostgreSQL aborts the statement with SQLSTATE
``55P03`` (``lock_not_available`` — "canceling statement due to lock timeout").
The async driver (asyncpg) raises ``LockNotAvailableError`` and SQLAlchemy wraps
it in a ``DBAPIError`` whose ``.orig`` is the asyncpg error.

This module is the single place that recognises that condition — matched on the
SQLSTATE string rather than an ``isinstance`` so it needs neither an asyncpg
import here nor to care whether the error arrived wrapped or bare.
"""

from __future__ import annotations

# SQLSTATE for "lock_not_available" — the code Postgres returns when lock_timeout
# aborts a statement waiting on a lock (including an advisory lock). Also the code
# surfaced when statement_timeout cancels a statement is 57014; this constant is
# specifically the LOCK timeout, which the body-partition path maps to a 409.
LOCK_NOT_AVAILABLE_SQLSTATE = "55P03"


def is_lock_not_available(exc: BaseException) -> bool:
    """Return whether *exc* is (or wraps) a Postgres lock-timeout error (55P03).

    Parameters
    ----------
    exc : BaseException
        The exception to inspect. Either a SQLAlchemy ``DBAPIError`` whose
        ``.orig`` carries the asyncpg error, or the asyncpg error itself.

    Returns
    -------
    bool
        ``True`` when the error's SQLSTATE is
        :data:`LOCK_NOT_AVAILABLE_SQLSTATE`.
    """
    orig = getattr(exc, "orig", None)
    sqlstate = getattr(orig, "sqlstate", None) or getattr(exc, "sqlstate", None)
    return sqlstate == LOCK_NOT_AVAILABLE_SQLSTATE
