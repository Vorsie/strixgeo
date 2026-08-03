"""Constants for the per-launch local-client token.

The token is minted by the Electron main process (one random value per app
launch), handed to the uvicorn child through the environment, and injected on
the renderer's requests as a header.  Both halves of that contract are named
here so the two processes cannot drift apart silently.
"""

# Environment variable the Electron main process sets on the uvicorn child.
# Its PRESENCE is what switches enforcement on: a backend started by hand
# (dev shell, ``scripts/run-e2e.ps1``, integration runs, curl) has no token
# and keeps the pre-token behaviour, so no test harness needs to know about
# this at all.
LOCAL_CLIENT_TOKEN_ENV_VAR = "STRIX_API_TOKEN"

# Request header carrying the token.  Injected in the main process via
# ``session.defaultSession.webRequest.onBeforeSendHeaders`` rather than by the
# renderer's fetch layer: a header added there is invisible to the renderer,
# so an XSS-escalated page inside our own window cannot read it back out, and
# no API-client call site can forget it.
LOCAL_CLIENT_TOKEN_HEADER = "X-StrixGeo-Token"

# The literal origin a ``file://`` page reports — the packaged renderer's
# origin, and equally the origin of any sandboxed iframe or ``data:``
# document on the wider web.  Requests carrying it are the ones that must
# prove they come from our own window.
NULL_ORIGIN = "null"
