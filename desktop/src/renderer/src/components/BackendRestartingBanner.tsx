/**
 * Transient banner shown while the main process respawns a backend that died
 * mid-session (H3(a)).
 *
 * Distinct from the two neighbours:
 *
 * * {@link BackendUnreachableBanner} — the backend is not answering and the user
 *   must restart the app. A dead end.
 * * {@link BackendFailedModal} — a fatal boot / give-up state.
 *
 * This one is HOPEFUL: the main process detected the death, is bringing the
 * backend back once, and will clear the banner when it is serving again
 * (``app:backend-ready``) or escalate to the failed modal if the respawn does
 * not come up. It exists so the reconnecting gap reads as "hang on" rather than
 * as a storm of failed requests.
 *
 * Self-subscribing (like BackendUnreachableBanner) so App stays lean, and guarded
 * on the preload channel being present so an older preload / a test harness that
 * does not stub it renders nothing rather than throwing.
 *
 * @module components/BackendRestartingBanner
 */

import { useEffect, useState } from 'react'

import { useT } from '../i18n/translate'

/**
 * Renders the reconnecting banner while a backend respawn is in flight.
 *
 * Returns
 * -------
 * JSX.Element | null
 *     The banner while restarting; ``null`` otherwise.
 */
export default function BackendRestartingBanner(): JSX.Element | null {
  const t = useT()
  const [restarting, setRestarting] = useState(false)

  useEffect(() => {
    const api = window.electron
    // Guard: an older preload (or a test that does not stub these) leaves the
    // banner inert rather than crashing the render.
    if (
      typeof api?.onAppBackendRestarting !== 'function' ||
      typeof api?.onAppBackendReady !== 'function'
    ) {
      return undefined
    }
    const offRestarting = api.onAppBackendRestarting(() => setRestarting(true))
    const offReady = api.onAppBackendReady(() => setRestarting(false))
    // The failed modal takes over on a give-up, so clear the reconnecting state
    // when that fires too.
    const offFailed =
      typeof api.onAppBackendFailed === 'function'
        ? api.onAppBackendFailed(() => setRestarting(false))
        : undefined
    return () => {
      offRestarting()
      offReady()
      offFailed?.()
    }
  }, [])

  if (!restarting) return null

  return (
    <div
      className="fixed top-2 left-1/2 -translate-x-1/2 z-[100] max-w-[min(92vw,44rem)]
                 bg-surface-overlay border border-status-warning rounded shadow-lg
                 px-4 py-2 text-xs text-text-primary flex items-start gap-2"
      role="status"
      data-testid="backend-restarting-banner"
    >
      <span aria-hidden="true" className="text-status-warning font-semibold">
        ↻
      </span>
      <span>
        <span className="font-semibold text-status-warning">{t('app.backendRestarting')}</span>{' '}
        {t('app.backendRestartingBody')}
      </span>
    </div>
  )
}
