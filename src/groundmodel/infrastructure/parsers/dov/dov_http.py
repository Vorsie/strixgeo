"""Shared async HTTP client factory for DOV WFS + XML downloads.

Both bbox-import orchestrators (CPT and borehole) open an
``httpx.AsyncClient`` with the same tuning. We extract the construction
here so the timeout, redirect, HTTP/2, and connection-pool defaults stay
in one place.

Tuning rationale (verified live 2026-05-07 onwards)
---------------------------------------------------
* ``timeout=Timeout(60.0, connect=10.0)`` — DOV's per-XML download can run
  several seconds when the proxy is warm; total 60s leaves slack for any
  single slow XML. Connect timeout is short (10s) so a DNS / connectivity
  failure surfaces quickly instead of stalling the whole import.
* ``follow_redirects=True`` — required for the rare proxy-prefix-mismatch
  case where the parser falls back to the public ``fiche`` URL + ``.xml``
  and DOV serves a 302 to the proxy.
* ``http2=True`` — multiplexes the 50–100 concurrent XML fetches over one
  TLS connection, eliminating per-request TLS-handshake cost. Verified
  live: turning HTTP/2 off doubles the wall-clock for a 500-CPT bbox.
* ``max_keepalive_connections=100`` + ``max_connections=100`` — keeps the
  HTTP/2 connection warm for the duration of the import.
"""

from __future__ import annotations

import httpx


def make_dov_async_client() -> httpx.AsyncClient:
    """Return a fresh ``httpx.AsyncClient`` tuned for DOV WFS + XML downloads.

    Use as ``async with make_dov_async_client() as http:`` so the connection
    pool is closed when the orchestrator finishes its phases. Returning the
    raw client (not a context-managed handle) keeps ``async with`` at the
    call site for readability — every existing caller already wraps it.
    """
    return httpx.AsyncClient(
        timeout=httpx.Timeout(60.0, connect=10.0),
        follow_redirects=True,
        http2=True,
        limits=httpx.Limits(max_keepalive_connections=100, max_connections=100),
    )
