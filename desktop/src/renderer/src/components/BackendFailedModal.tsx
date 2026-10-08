/**
 * Modal shown when the Python backend process exits before the API
 * becomes ready — i.e. the backend crashed on startup.
 *
 * Receives the ``app:backend-failed`` IPC signal from the main process
 * via ``window.electron.onAppBackendFailed``. The modal is not
 * dismissible (the app cannot function without the backend) so there is
 * no Esc / backdrop-close / Cancel path. The generic action is Quit, which
 * closes the Electron window via the standard ``app:quit-decision`` IPC.
 *
 * Named cause (owner finding 2026-10-08): when the signal's payload says
 * ``newer-database`` (an older StrixGeo opened a store a newer one wrote), the
 * body names that cause and a "Check for updates" action is offered and
 * default-focused, because installing the update IS the cure. The update card
 * (UpdateNotification) paints above this dialog, so its Download is reachable.
 *
 * UX notes (docs/ux.md compliance):
 *   - role="alertdialog" (not generic dialog) because it represents a
 *     fatal condition the user must acknowledge.
 *   - Auto-focus on the primary action on mount: Check for updates when the
 *     cause is a newer store (the safe action that fixes it), Quit otherwise.
 *   - No focus trap (debt #202 tracks the shared Modal trap gap — this
 *     component does not worsen the situation; it keeps focus on the
 *     single interactive element).
 *   - Dark-mode safe: uses the same CSS-var surface tokens as Modal.tsx.
 *   - Does NOT reuse Modal.tsx because that component supports Esc-to-
 *     close and backdrop-click-to-close, which must both be disabled here.
 */

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

import { useT } from '../i18n/translate'
import { log } from '../utils/log'
import type { BackendFailureReasonDto } from '../utils/backendFailureTypes'

interface Props {
  /** Whether the modal is visible. */
  open: boolean
  /** Logs directory path from the main process, or null if unavailable. */
  logsPath: string | null
  /** The cause the main process recognised, or null / absent when unknown. */
  reason?: BackendFailureReasonDto | null
}

/**
 * Fatal-backend-crash modal.
 *
 * Parameters
 * ----------
 * open : boolean
 *     Whether to render the modal overlay.
 * logsPath : string | null
 *     Absolute path to the logs directory, displayed to guide the user
 *     to the ``backend.log`` file for diagnosis.
 * reason : BackendFailureReasonDto | null, optional
 *     The recognised cause; ``'newer-database'`` switches to the named copy
 *     and the Check for updates action.
 */
export default function BackendFailedModal({ open, logsPath, reason = null }: Props): JSX.Element | null {
  const t = useT()
  const quitRef = useRef<HTMLButtonElement>(null)
  const checkRef = useRef<HTMLButtonElement>(null)
  const newerDatabase = reason === 'newer-database'

  // Auto-focus the safe primary action when the modal opens (or its cause
  // arrives): the update check for a newer store, Quit otherwise.
  useEffect(() => {
    if (!open) return
    if (newerDatabase) checkRef.current?.focus()
    else quitRef.current?.focus()
  }, [open, newerDatabase])

  if (!open) return null

  function handleQuit(): void {
    // Notify the main process that the user consented to quit. Re-uses
    // the standard quit-decision IPC so the main-process ``confirmedQuit``
    // guard is exercised and we don't get a recursive close event.
    if (typeof window !== 'undefined' && window.electron?.notifyQuitDecision) {
      void window.electron.notifyQuitDecision(true)
    }
  }

  function handleCheckForUpdates(): void {
    // Results arrive as updater events on the update card, which paints above
    // this dialog. A missing bridge (older preload) simply does nothing.
    void window.electron?.checkForUpdates?.().catch(err => log.warn('updater', 'check failed', err))
  }

  return createPortal(
    // Same z-index and surface tokens as Modal.tsx so the overlay
    // semantics are consistent. One BELOW int32 max: the update card claims
    // the max, because for a newer store the update is the way out.
    <div
      // Not dismissible — intentionally NO click handler on the backdrop.
      className="fixed inset-0 z-[2147483646] flex items-center justify-center bg-black/70 backdrop-blur-sm"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="backend-failed-title"
        aria-describedby="backend-failed-desc"
        className="bg-surface-overlay border border-border-default text-text-primary rounded-lg shadow-lg w-96 p-6 flex flex-col gap-4"
      >
        <h2
          id="backend-failed-title"
          className="text-status-danger font-semibold text-base"
        >
          {t('app.backendFailedTitle')}
        </h2>

        <p id="backend-failed-desc" className="text-sm text-text-secondary">
          {t(newerDatabase ? 'app.backendFailedNewerDatabaseBody' : 'app.backendFailedBody')}
        </p>

        {logsPath && (
          <p className="text-xs text-text-muted font-mono break-all">
            {t('app.logFile')} {logsPath}/backend.log
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            ref={quitRef}
            onClick={handleQuit}
            className={
              newerDatabase
                ? 'px-4 py-2 border border-border-default text-text-primary rounded text-sm hover:bg-surface-card focus:outline-none focus:ring-2 focus:ring-accent'
                : 'px-4 py-2 bg-status-danger text-white rounded text-sm hover:bg-status-danger/90 focus:outline-none focus:ring-2 focus:ring-status-danger'
            }
          >
            {t('app.quit')}
          </button>
          {newerDatabase && (
            <button
              ref={checkRef}
              onClick={handleCheckForUpdates}
              className="px-4 py-2 bg-accent text-text-on-accent rounded text-sm hover:bg-accent-muted focus:outline-none focus:ring-2 focus:ring-accent"
            >
              {t('app.checkForUpdates')}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
