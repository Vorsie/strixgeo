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
When ``STRIXGEO_DOV_FIXTURE_MODE=1`` is set, this factory returns a client
backed by ``dov_fixture_transport._build_fixture_transport`` instead of
the production network.  All DOV HTTP traffic (WFS + per-permkey XML
downloads) is redirected to on-disk fixture files under
``STRIXGEO_DOV_FIXTURE_ROOT`` (defaults to
``desktop/tests/e2e/fixtures/dov``).

The production client path is byte-identical when the env var is absent or
not ``"1"`` — no production behaviour change.
"""

from __future__ import annotations

import httpx

from groundmodel.infrastructure.parsers.dov.dov_common import is_allowed_dov_url
from groundmodel.infrastructure.parsers.dov.dov_fixture_transport import (
    _build_fixture_transport,
    fixture_root_path,
    is_fixture_mode,
)
from groundmodel.shared.logging.logger_factory import LoggerFactory

_logger = LoggerFactory.get_logger(__name__)


class _HostAllowlistTransport(httpx.AsyncBaseTransport):
    """Refuse any request whose host is not an allow-listed DOV host.

    ``follow_redirects=True`` (needed for the legitimate same-host 302 from a
    ``fiche``.xml URL to the proxy) will otherwise chase a redirect to ANY
    host. Because httpx routes every redirect hop back through the client's
    transport, wrapping the real transport here refuses a cross-host redirect
    target BEFORE the socket is opened — the guard the raw client lacks. The
    initial DOV requests (WFS, and the fiche-derived XML URLs already
    allow-listed at construction in ``dov_client``) pass straight through; only
    an off-host hop — a blind-SSRF steer — is blocked.

    Parameters
    ----------
    inner : httpx.AsyncBaseTransport
        The real transport that performs the network I/O once a request has
        cleared the host allow-list.
    """

    def __init__(self, inner: httpx.AsyncBaseTransport) -> None:
        self._inner = inner

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        """Delegate to the inner transport, or refuse an off-host request.

        Raises
        ------
        httpx.ConnectError
            When the request host is not allow-listed. A ``RequestError``
            subclass so the DOV download helper's existing ``except
            httpx.RequestError`` catches it and fails that one row, not the
            whole import.
        """
        if not is_allowed_dov_url(str(request.url)):
            host = request.url.host
            _logger.warning(
                f"DOV: refusing request to non-DOV host {host!r} (url={request.url}) "
                "— blocked cross-host redirect / SSRF attempt"
            )
            raise httpx.ConnectError(
                f"refusing request to non-allowed host {host!r}", request=request
            )
        return await self._inner.handle_async_request(request)

    async def aclose(self) -> None:
        """Close the wrapped transport."""
        await self._inner.aclose()


def make_dov_async_client() -> httpx.AsyncClient:
    """Return a fresh ``httpx.AsyncClient`` tuned for DOV WFS + XML downloads.

    Use as ``async with make_dov_async_client() as http:`` so the connection
    pool is closed when the orchestrator finishes its phases. Returning the
    raw client (not a context-managed handle) keeps ``async with`` at the
    call site for readability — every existing caller already wraps it.

    In fixture mode (``STRIXGEO_DOV_FIXTURE_MODE=1``), the client is backed by
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

    # Production path. The real transport carries the http2 + pool tuning
    # (when a custom transport is supplied, httpx ignores ``http2=``/``limits=``
    # on the client, so they must live on the inner transport). The
    # host-allowlist wrapper refuses any request — including a redirect hop —
    # aimed at a non-DOV host, so ``follow_redirects=True`` can no longer be
    # steered off-host by a hostile response.
    inner = httpx.AsyncHTTPTransport(
        http2=True,
        limits=httpx.Limits(max_keepalive_connections=100, max_connections=100),
    )
    return httpx.AsyncClient(
        transport=_HostAllowlistTransport(inner),
        timeout=httpx.Timeout(60.0, connect=10.0),
        follow_redirects=True,
    )
