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

import { setBaseUrl } from '../api/client'
import { log } from '../utils/log'

export interface UseAppBootResult {
  /** True once the FastAPI backend has confirmed it is accepting connections. */
  ready: boolean
  /** True when the API failed to start within its timeout budget. */
  apiError: boolean
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
 *     ``true`` when the startup timed out.  The App renders an error
 *     screen and does not proceed to the welcome flow.
 */
export function useAppBoot(gateOpen: boolean): UseAppBootResult {
  const [ready, setReady] = useState(false)
  const [apiError, setApiError] = useState(false)
  const startedRef = useRef(false)

  useEffect(() => {
    // Only once, and only after the activation gate is open: a blocked
    // packaged build has its engine deferred, and 'not running' is not a crash.
    if (!gateOpen || startedRef.current) return
    startedRef.current = true
    async function boot(): Promise<void> {
      const base = await window.electron.getApiBaseUrl()
      setBaseUrl(base)
      log.info('boot', `API base = ${base}`)
      const ok = await window.electron.waitForApi()
      if (ok) {
        log.info('boot', 'API ready')
        setReady(true)
      } else {
        log.error('boot', 'API failed to come up within timeout')
        setApiError(true)
      }
    }
    void boot()
  }, [gateOpen])

  return { ready, apiError }
}
