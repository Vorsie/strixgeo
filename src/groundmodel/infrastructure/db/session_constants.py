"""Server-side timeout settings applied to every DB connection.

These are asyncpg ``server_settings`` (a ``SET`` issued once per new connection),
so they bound how long ANY statement on the app's pool can wait or run. They are
strings because asyncpg requires ``server_settings`` values to be strings.

Why each exists (audit M3 — a request must fail loudly, never hang):

* ``lock_timeout`` — a statement waiting on a lock aborts after this long with
  SQLSTATE 55P03 instead of blocking forever. The body-partition advisory lock
  (``lock_body_partition``) relies on this: a correlate/recompute that cannot get
  the lock within the window fails with a 409 naming the holder rather than
  leaving the request hung. 30 s is far longer than a healthy body-partition
  rewrite (tens of ms) yet short enough that a wedged holder surfaces quickly.

* ``statement_timeout`` — a runaway single statement is cancelled after this
  long. It MUST be larger than ``lock_timeout`` or the statement timeout would
  fire first on a lock wait and the lock-timeout path would never be reached
  (per the Postgres docs). 5 min is generous: individual app statements are
  sub-second, and the heavy import/build work is many small statements, not one
  long one. Owner may retune if a legitimate single statement ever approaches it.

* ``idle_in_transaction_session_timeout`` — a transaction left open and idle
  (a crashed client, an abandoned SSE import) is closed by the server after this
  long, releasing its locks and its connection back to the pool. 5 min.
"""

from __future__ import annotations

# 30 s — a lock wait past this aborts (55P03) rather than hanging.
DB_LOCK_TIMEOUT_MS = "30000"

# 5 min — runaway single-statement guard. Kept > DB_LOCK_TIMEOUT_MS so the lock
# timeout fires first on a lock wait (Postgres: statement_timeout would otherwise
# pre-empt lock_timeout).
DB_STATEMENT_TIMEOUT_MS = "300000"

# 5 min — an idle-in-transaction session is closed by the server, freeing its
# locks and connection.
DB_IDLE_IN_TRANSACTION_TIMEOUT_MS = "300000"

# asyncpg ``server_settings`` block passed to ``create_async_engine`` via
# ``connect_args``. Applied once per connection as it is checked out of the pool.
DB_SERVER_SETTINGS: dict[str, str] = {
    "lock_timeout": DB_LOCK_TIMEOUT_MS,
    "statement_timeout": DB_STATEMENT_TIMEOUT_MS,
    "idle_in_transaction_session_timeout": DB_IDLE_IN_TRANSACTION_TIMEOUT_MS,
}
