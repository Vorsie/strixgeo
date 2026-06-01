"""Shared async HTTP client factory for DOV WFS + XML downloads.

Both bbox-import orchestrators (CPT and borehole) open an
``httpx.AsyncClient`` with the same tuning. We extract the construction
here so the timeout, redirect, and connection-pool defaults stay in one
place.

Tuning rationale (verified live 2026-05-07 onwards)
---------------------------------------------------
* ``timeout=Timeout(60.0, connect=10.0)`` — DOV's per-XML download can run
  several seconds when the proxy is warm; total 60 s leaves slack for any
  single slow XML. Connect timeout is short (10 s) so a DNS / connectivity
  failure surfaces quickly instead of stalling the whole import.
* ``follow_redirects=True`` — required for the rare proxy-prefix-mismatch
  case where the parser falls back to the public ``fiche`` URL + ``.xml``
  and DOV serves a 302 to the proxy.
* ``http2=True`` — configured but **confirmed no-op on the live DOV
  endpoints** (live probe 2026-05-17: both the CPT export proxy and the WFS
  returned ``HTTP/1.1``; DOV's front-end does not negotiate h2 despite ALPN
  being offered). The setting is retained so a future DOV infrastructure
  upgrade would be picked up automatically without a code change.
* ``max_keepalive_connections=100`` + ``max_connections=100`` — keeps the
  connection pool warm for the duration of the import.

Test-mode mock
--------------
When ``STRIX_DOV_FIXTURE_MODE=1`` is set, this factory returns a client
backed by ``dov_fixture_transport._build_fixture_transport`` instead of
the production network.  All DOV HTTP traffic (WFS + per-permkey XML
downloads) is redirected to on-disk fixture files under
``STRIX_DOV_FIXTURE_ROOT`` (defaults to
``desktop/tests/e2e/fixtures/dov``).

The production client path is byte-identical when the env var is absent or
not ``"1"`` — no production behaviour change.
"""

from __future__ import annotations

import httpx

from groundmodel.infrastructure.parsers.dov.dov_fixture_transport import (
    _build_fixture_transport,
    fixture_root_path,
    is_fixture_mode,
)


def make_dov_async_client() -> httpx.AsyncClient:
    """Return a fresh ``httpx.AsyncClient`` tuned for DOV WFS + XML downloads.

    Use as ``async with make_dov_async_client() as http:`` so the connection
    pool is closed when the orchestrator finishes its phases. Returning the
    raw client (not a context-managed handle) keeps ``async with`` at the
    call site for readability — every existing caller already wraps it.

    In fixture mode (``STRIX_DOV_FIXTURE_MODE=1``), the client is backed by
    an in-process ``httpx.MockTransport`` that serves requests from on-disk
    fixture files.  All other settings (timeout, limits, follow_redirects)
    are identical — callers see no behavioural difference.

    Returns
    -------
    httpx.AsyncClient
        A configured client.  In production: real network.
        In fixture mode: fixture transport.
    """
    if is_fixture_mode():
        # Fixture mode: serve all DOV HTTP from on-disk files.
        # Timeout / limits / follow_redirects are still set so the
        # httpx client context-manager lifecycle is identical to production.
        transport = _build_fixture_transport(fixture_root_path())
        return httpx.AsyncClient(
            transport=transport,
            timeout=httpx.Timeout(60.0, connect=10.0),
            follow_redirects=True,
            limits=httpx.Limits(max_keepalive_connections=100, max_connections=100),
        )

    # Production path — unchanged from before this commit.
    return httpx.AsyncClient(
        timeout=httpx.Timeout(60.0, connect=10.0),
        follow_redirects=True,
        http2=True,
        limits=httpx.Limits(max_keepalive_connections=100, max_connections=100),
    )
