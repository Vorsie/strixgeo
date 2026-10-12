// Application boot — waits for the Electron-hosted Python API to become
// reachable before signalling the rest of the app that it is ready to
// render.
//
// The wait starts once per renderer lifetime, but only after the activation
// gate is OPEN (``gateOpen``): a packaged build blocked at the licence page has
// its engine deliberately deferred, and asking the main process for readiness
// then answers "not running" — which is not a crash (installer #7, 2026-09-03).  ``getApiBaseUrl`` injects the dynamic
// port that the Python subprocess reports back to the main process;
// ``waitForApi`` polls until the FastAPI health-check responds or
// times out.

import { useEffect, useRef, useState } from 'react'

import { resolveApiBaseUrl } from '../api/apiBaseUrl'
import { setBaseUrl } from '../api/client'
import { log } from '../utils/log'

export interface UseAppBootResult {
  /** True once the FastAPI backend has confirmed it is accepting connections. */
  ready: boolean
  /**
   * True when the backend could not be reached: the process exited (a startup
   * crash), a foreign process holds the API port, or every readiness window was
   * used without the port binding. NOT set for a slow-but-alive start still
   * inside its budget — that path stays on ``takingLong`` and keeps waiting.
   */
  apiError: boolean
  /** True after a live backend has exceeded its initial boot budget. */
  takingLong: boolean
}

/**
 * React hook that drives the application boot sequence.
 *
 * Parameters
 * ----------
 * gateOpen : boolean
 *     True once the activation gate lets the app proceed (dev / e2e: always;
 *     packaged: after a licence verdict that is not blocked). The API wait
 *     does not start before that.
 *
 * Calls ``window.electron.getApiBaseUrl`` to learn the dynamic port, then
 * ``window.electron.waitForApi`` to poll until the backend is ready.  Both
 * calls are injected by the Electron preload so the renderer never constructs
 * the URL itself.
 *
 * Returns
 * -------
 * ready
 *     ``false`` while the API is starting; ``true`` once it responds.
 * apiError
 *     ``true`` when the backend could not be reached — the process exited, a
 *     foreign process holds the port, or the readiness budget was exhausted.
 *     A timeout that is still WITHIN the budget does not set this (the wait
 *     continues); the App renders an error screen only once it is set and does
 *     not proceed to the welcome flow.
 */
export function useAppBoot(gateOpen: boolean): UseAppBootResult {
  const [ready, setReady] = useState(false)
  const [apiError, setApiError] = useState(false)
  const [takingLong, setTakingLong] = useState(false)
  const startedRef = useRef(false)

  useEffect(() => {
    // Only once, and only after the activation gate is open: a blocked
    // packaged build has its engine deferred, and 'not running' is not a crash.
    if (!gateOpen || startedRef.current) return
    startedRef.current = true
    async function boot(): Promise<void> {
      // The engine port is chosen by main in a packaged build (not always
      // 8765); the dev default is the fallback when the bridge cannot say.
      const base = await resolveApiBaseUrl(window.electron)
      setBaseUrl(base)
      log.info('boot', `API base = ${base}`)
      for (;;) {
        const result = await window.electron.waitForApi()
        if (result === 'still-starting') {
          log.info('boot', 'API is still starting after its initial wait budget')
          setTakingLong(true)
          continue
        }
        if (result) {
          log.info('boot', 'API ready')
          setReady(true)
        } else {
          // ``false`` is cause-agnostic: the main process returns it when the
          // backend child exited (a startup crash), when a FOREIGN process holds
          // the API port (wrong launch token, never a crash), or when the child was
          // alive but used every readiness window without binding the port. Keep
          // the message neutral so support does not hunt a crash traceback that
          // the foreign-port case never produced.
          log.error(
            'boot',
            `API did not become ready: the backend process exited, a foreign process holds the API port (${base}), or it never bound the port within the readiness budget`,
          )
          setApiError(true)
        }
        return
      }
    }
    // A rejected IPC (the main process reloading the window mid-invoke, an
    // unexpected fetch error in the handler) must still land on a terminal
    // state. Without this the hook left ready=false and apiError=false, which
    // renders the loading screen forever.
    void boot().catch(err => {
      log.error('boot', `API readiness check failed: ${String(err)}`)
      setApiError(true)
    })
  }, [gateOpen])

  return { ready, apiError, takingLong }
}
