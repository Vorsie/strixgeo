/**
 * Per-launch token that proves a request to the local API came from our window.
 *
 * The API binds to loopback and has no auth, and the packaged renderer runs
 * from ``file://`` — so ``Origin: null`` has to stay in the backend's CORS
 * allowlist. That origin is not ours alone: a sandboxed iframe or a ``data:``
 * document on any site the engineer visits while StrixGeo runs sends it too,
 * and the backend would happily hand that page ``GET /projects/{id}/bundle``
 * or honour ``DELETE /geology/models/{id}``.
 *
 * So identity stops being the origin and becomes a secret: main mints a random
 * token at launch, gives it to the uvicorn child through the environment, and
 * injects it as a request header on everything the renderer sends to the API.
 * A page on the web cannot read a value it was never given.
 *
 * The header is attached in the MAIN process (via
 * ``webRequest.onBeforeSendHeaders``) rather than by the renderer's API client
 * on purpose: the renderer never holds the token, so an XSS-escalated page
 * inside our own window cannot exfiltrate it, and no call site can forget it.
 * Headers added there are invisible to the renderer's fetch, so they do not
 * change the request's CORS preflight behaviour either.
 *
 * The names here MUST match
 * ``src/groundmodel/api/local_client_token_constants.py``.
 *
 * @module main/localClientToken
 */

import { randomBytes } from 'crypto'

/** Environment variable the uvicorn child reads the expected token from. */
export const LOCAL_CLIENT_TOKEN_ENV_VAR = 'STRIX_API_TOKEN'

/** Request header the token travels in. */
export const LOCAL_CLIENT_TOKEN_HEADER = 'X-StrixGeo-Token'

/**
 * Mint a fresh token for this launch.
 *
 * 32 bytes of CSPRNG output, hex-encoded — unguessable within a session, and
 * never reused across launches so a token that leaked into a log is dead as
 * soon as the app restarts.
 *
 * @returns A 64-character lowercase hex string.
 */
export function mintLocalClientToken(): string {
  return randomBytes(32).toString('hex')
}

/**
 * The ``webRequest`` URL filter that decides which requests get the header.
 *
 * Scoped to the local API host so the token is never attached to anything else
 * the renderer loads (map tiles, Cesium assets, an external link).
 *
 * TWO patterns on purpose. Electron matches these with Chromium's
 * ``URLPattern``, and Chrome's extension match-pattern grammar — the same
 * grammar, historically — does NOT allow a port in the host part. A filter of
 * ``http://127.0.0.1:8765/*`` that silently matches nothing would strip the
 * token from every request and leave the packaged app unable to talk to its own
 * backend, with no error anywhere on the main side. The port-less pattern is
 * the belt: it matches the API whichever way the port is treated. The cost is
 * that the token would also ride along to another service on the same loopback
 * host — there is none today, and the API is the only thing the renderer is
 * allowed to reach over http (see the CSP + navigation guards in index.ts).
 *
 * @param apiBase - Base URL of the local API, e.g. ``http://127.0.0.1:8765``.
 * @returns Filter object for ``webRequest.onBeforeSendHeaders``.
 */
export function localApiRequestFilter(apiBase: string): { urls: string[] } {
  const { protocol, hostname } = new URL(apiBase)
  return { urls: [`${apiBase}/*`, `${protocol}//${hostname}/*`] }
}

/**
 * How long an observed API request gets to acquire its header before the
 * audit alarms. ``onBeforeRequest`` (the observation point) fires moments
 * before ``onBeforeSendHeaders`` (the injection point) for the same request,
 * so the check must not race the injection it is auditing.
 */
export const TOKEN_OBSERVATION_GRACE_MS = 5_000

/** What :func:`createTokenInjectionAudit` returns — see its doc comment. */
export interface TokenInjectionAudit {
  /** Record that the header was attached to a request (call on every injection). */
  noteInjection(url: string): void
  /**
   * Record that a request to the local API was seen LEAVING the session
   * (from an unfiltered observation point). Arms a one-shot check: if no
   * injection has been recorded by the end of the grace period, the filter
   * demonstrably matched a request it should have caught — alarm.
   */
  noteApiRequestObserved(url: string): void
}

/**
 * Turn "the token was never attached" from an absence into a signal.
 *
 * The injection path has no failure mode the engineer can see. If the
 * ``webRequest`` URL filter matches nothing — the Chromium match-pattern
 * grammar is the known trap, see {@link localApiRequestFilter} — the header is
 * silently absent, the backend 403s every call, and the UI says "failed to
 * fetch". The only explanation lives in the backend's own log, which a packaged
 * build never shows anybody. A success line is no help either: its absence is
 * exactly what nobody notices.
 *
 * The first version armed on a wall-clock grace after ``did-finish-load`` and
 * CRIED WOLF on any session that never left the start screen (owner dogfeed
 * 2026-08-03: no project opened → zero API requests → "the filter matched
 * nothing" over a filter that was never asked to match anything). The audit
 * therefore arms only on an OBSERVED API request — reported by an unfiltered
 * ``onBeforeRequest`` listener, so the observation cannot share the filter's
 * failure mode — and alarms only when that request's grace period ends with no
 * injection recorded.
 *
 * @param filterUrls - The patterns the filter was built from; named in the error
 *   so the reader can see WHICH patterns matched nothing.
 * @param log - Error sink (``console`` in production, a spy in tests).
 * @param scheduleCheck - Timer seam for tests; defaults to ``setTimeout`` with
 *   {@link TOKEN_OBSERVATION_GRACE_MS}.
 * @returns The audit handle.
 */
export function createTokenInjectionAudit(
  filterUrls: readonly string[],
  log: { error: (message: string) => void },
  scheduleCheck: (check: () => void) => void = check =>
    setTimeout(check, TOKEN_OBSERVATION_GRACE_MS),
): TokenInjectionAudit {
  let injected = false
  let armed = false
  let reported = false
  return {
    noteInjection(): void {
      injected = true
    },
    noteApiRequestObserved(url: string): void {
      // Once only: the renderer reloads (dev HMR, the ErrorBoundary's Reload
      // button), and an alarm repeated per reload trains the reader to ignore it.
      if (injected || armed || reported) return
      armed = true
      scheduleCheck(() => {
        if (injected || reported) return
        reported = true
        log.error(
          '[main] a request to the local API left WITHOUT the launch token — the ' +
            `API will refuse it. Observed: ${url}. The webRequest filter matched ` +
            `nothing: ${filterUrls.join(', ')}`,
        )
      })
    },
  }
}
