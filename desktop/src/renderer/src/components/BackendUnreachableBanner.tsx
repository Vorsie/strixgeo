/**
 * Persistent banner shown while the backend is not answering.
 *
 * Distinct from {@link BackendFailedModal}, which covers the backend dying
 * during BOOT — a fatal state with one honest action (Quit). This covers the
 * backend dying MID-SESSION, observed 2026-08-02: the shell stayed responsive,
 * every click failed, and the app said nothing until the engineer worked it out
 * for themselves.
 *
 * Design decisions:
 *
 * * **A banner, not a toast.** A toast reports an event that already happened
 *   and then leaves. This is a condition that is still true, so it stays on
 *   screen exactly as long as it holds and removes itself the moment a request
 *   gets through.
 * * **It does not block.** The window is not modal: reading what is on screen,
 *   and copying something out of it, are the only useful things left to do and
 *   an overlay would prevent both.
 * * **It says "restart", and does not offer a Retry button.** The renderer
 *   cannot know what the half-finished session wrote; a Retry that appears to
 *   work would be the more dangerous message. Restarting reloads state from
 *   Postgres, which outlived Electron (see docs/design/autosave-recovery.md).
 *
 * @module components/BackendUnreachableBanner
 */

import { useSyncExternalStore } from 'react'

import { isBackendUnreachable, subscribeBackendReachability } from '../api/networkHealth'
import { useT } from '../i18n/translate'

/**
 * Server snapshot for ``useSyncExternalStore``.
 *
 * Hoisted to module scope so the reference is stable across renders — an
 * inline arrow would be a fresh function every time, which is the shape React
 * warns about. The desktop shell never server-renders; this exists so the
 * three-argument form stays safe if a future surface does.
 */
const NEVER_UNREACHABLE_ON_SERVER = (): boolean => false

/**
 * Renders the unreachable-backend banner, or nothing when the backend is fine.
 *
 * Subscribes to the shared reachability store via ``useSyncExternalStore``, so
 * a dead-backend storm re-renders once per transition rather than once per
 * failed request.
 *
 * Returns
 * -------
 * JSX.Element | null
 *     The banner while unreachable; ``null`` otherwise.
 */
export default function BackendUnreachableBanner(): JSX.Element | null {
  const t = useT()
  const unreachable = useSyncExternalStore(
    subscribeBackendReachability,
    isBackendUnreachable,
    NEVER_UNREACHABLE_ON_SERVER,
  )

  if (!unreachable) return null

  return (
    <div
      // Top-centred and above the toast stack: this outranks any individual
      // action's outcome, because none of them are landing.
      className="fixed top-2 left-1/2 -translate-x-1/2 z-[100] max-w-[min(92vw,44rem)]
                 bg-surface-overlay border border-status-danger rounded shadow-lg
                 px-4 py-2 text-xs text-text-primary flex items-start gap-2"
      role="alert"
      data-testid="backend-unreachable-banner"
    >
      <span aria-hidden="true" className="text-status-danger font-semibold">
        ⚠
      </span>
      <span>
        <span className="font-semibold text-status-danger">{t('app.backendUnreachable')}</span>{'. '}
        {t('app.backendUnreachableBody')}
      </span>
    </div>
  )
}
