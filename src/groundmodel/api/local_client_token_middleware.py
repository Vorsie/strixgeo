"""ASGI middleware requiring the launch token on every Origin-carrying request."""

from __future__ import annotations

import os
import secrets

from starlette.responses import PlainTextResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from groundmodel.api.local_client_token_constants import (
    LOCAL_CLIENT_TOKEN_ENV_VAR,
    LOCAL_CLIENT_TOKEN_HEADER,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class LocalClientTokenMiddleware(GroundModelLogger):
    """Require a per-launch token on every request that carries an ``Origin``.

    Why this exists
    ---------------
    The API binds to loopback and has no auth, so the only identity a request
    can offer is its ``Origin`` header — and a browser origin is trivially
    reproduced by any page on the web.  ``Origin: null`` (a sandboxed iframe, a
    ``data:`` document, a redirect-laundered request) and even a bare
    ``http://localhost:<port>`` (a second local dev server, a malicious local
    app) are all forgeable by a site the engineer happens to have open.  With
    the API unauthenticated, such a page could read
    ``GET /projects/{id}/bundle`` (the complete site investigation), POST a
    plain multipart form to ``/cpt/import``, or issue
    ``DELETE /geology/models/{id}``.

    The token replaces the origin as the identity signal.  The Electron main
    process mints a random value per launch, passes it to its uvicorn child in
    the environment, and injects it as a request header on the renderer's
    calls (in BOTH dev and packaged builds — only ``ENVIRONMENT=production`` is
    packaged-gated, see ``desktop/src/main/index.ts``).  A hostile page cannot
    read a value it was never given, so it can claim any origin but not prove
    it.  The rule is therefore simple: **any request carrying an ``Origin``
    header must present the token.**

    What it deliberately does NOT guard
    -----------------------------------
    * **Requests with no ``Origin`` header** — curl, the integration suite,
      scripts and main's own readiness probe.  The browser-borne attack this
      closes cannot arrive without an origin: a fetch/XHR that can read a
      cross-origin response always carries one, and the requests that omit it
      (``<img>``, ``<script>``) produce responses the page cannot read.  This
      is the ONLY exemption — the packaged renderer (``Origin: null``) and the
      dev renderer (``Origin: http://localhost:<port>``) both carry the token
      and so are admitted by proving it, not by their origin.
    * **CORS preflights** — answered by CORSMiddleware, which is installed
      OUTSIDE this middleware precisely so an ``OPTIONS`` never reaches here.
      Blocking the preflight would stop the real request from ever being sent
      without adding any protection: a preflight response carries no data.
    * **Anything at all when no token is configured** — a backend started by
      hand keeps its pre-token behaviour, so dev, e2e and integration runs
      need no knowledge of this mechanism.

    Parameters
    ----------
    app : ASGIApp
        The downstream application.
    """

    def __init__(self, app: ASGIApp) -> None:
        super().__init__(__name__)
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Refuse any Origin-carrying request that does not present the launch token.

        Parameters
        ----------
        scope : Scope
            ASGI connection scope.
        receive : Receive
            ASGI receive channel.
        send : Send
            ASGI send channel.
        """
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # Read per request, not at construction: the token is set on the
        # process environment before uvicorn imports the app in production,
        # but reading it here also lets a test flip it without rebuilding the
        # whole middleware stack.
        expected = os.environ.get(LOCAL_CLIENT_TOKEN_ENV_VAR)
        if not expected:
            await self.app(scope, receive, send)
            return

        headers = {name.lower(): value for name, value in scope.get("headers", [])}
        # The ONE exemption: a request with no Origin header at all (curl, the
        # readiness probe, the integration suite). Every present Origin — the
        # packaged renderer's "null", the dev renderer's localhost, or a hostile
        # remote page — must prove the token, because a browser origin is
        # forgeable and is therefore no identity at all.
        if b"origin" not in headers:
            await self.app(scope, receive, send)
            return

        presented = headers.get(LOCAL_CLIENT_TOKEN_HEADER.lower().encode(), b"").decode("latin-1")
        # Constant-time: the attacker this guard exists for is a web page that can
        # hammer loopback in a loop, which is exactly the position from which a
        # short-circuiting `==` leaks the token one character at a time.
        if secrets.compare_digest(presented, expected):
            await self.app(scope, receive, send)
            return

        # Loud on purpose: this is either an attack (a page on the web
        # fetching loopback) or the header injection in the main process
        # broke, and the two look identical from the app's side. The engineer
        # reporting "everything says failed to fetch" and the engineer whose
        # project got read both need this line in the backend log.
        origin = headers.get(b"origin", b"").decode("latin-1")
        path = scope.get("path", "?")
        method = scope.get("method", "?")
        self.warning(
            f"refused {method} {path} — Origin: {origin!r} without a valid "
            f"{LOCAL_CLIENT_TOKEN_HEADER} header "
            f"(token {'present but wrong' if presented else 'absent'}). "
            "Either a web page tried to reach the local API, or this app's "
            "renderer is not injecting the launch token."
        )
        await PlainTextResponse(
            "Requests carrying an Origin header require the StrixGeo launch token",
            status_code=403,
        )(scope, receive, send)
