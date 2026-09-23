/**
 * Main-process HTTP through Chromium's network stack, as a ``fetch``.
 *
 * Why not the global ``fetch``: in the Electron main process the global is
 * Node's (undici). It ignores the Windows proxy settings (PAC, WPAD, a fixed
 * proxy) and trusts only Node's bundled certificate bundle, so behind a company
 * proxy or TLS inspection the activation server is "unreachable" while the same
 * address answers in the browser (owner's work PC and a coworker's,
 * 2026-09-23). Electron's ``net.fetch`` goes through Chromium: the system proxy
 * configuration and the OS certificate store apply, like a browser.
 *
 * The adapter takes the ``net`` module as a parameter and reads ``net.fetch``
 * at call time, so this file imports no Electron (a pure ``src/main`` helper,
 * unit-testable) and the caller can build it before ``app`` is ready: the
 * first request happens when the licence gate asks, after ready.
 */

/** The one member of Electron's ``net`` module this adapter needs. */
export interface ChromiumNet {
  fetch: (input: string, init?: RequestInit) => Promise<Response>
}

/**
 * Build a ``fetch``-shaped function backed by ``net.fetch``.
 *
 * Parameters
 * ----------
 * net : ChromiumNet
 *     Electron's ``net`` module (or a stand-in in tests).
 *
 * Returns
 * -------
 * typeof fetch
 *     Forwards the request URL and init to ``net.fetch`` and returns its
 *     ``Response`` untouched. ``postJson`` only ever passes a string URL, so a
 *     ``Request`` input is reduced to its URL.
 */
export function chromiumFetch(net: ChromiumNet): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    return net.fetch(url, init)
  }) as typeof fetch
}
