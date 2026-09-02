/**
 * Modal shown when the Python backend process exits before the API
 * becomes ready — i.e. the backend crashed on startup.
 *
 * Receives the ``app:backend-failed`` IPC signal from the main process
 * via ``window.electron.onAppBackendFailed``. The modal is not
 * dismissible (the app cannot function without the backend) so there is
 * no Esc / backdrop-close / Cancel path. The only offered action is
 * Quit — which closes the Electron window via the standard
 * ``app:quit-decision`` IPC.
 *
 * UX notes (docs/ux.md compliance):
 *   - role="alertdialog" (not generic dialog) because it represents a
 *     fatal condition the user must acknowledge.
 *   - Auto-focus on the primary action button on mount (Quit).
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

interface Props {
  /** Whether the modal is visible. */
  open: boolean
  /** Logs directory path from the main process, or null if unavailable. */
  logsPath: string | null
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
 */
export default function BackendFailedModal({ open, logsPath }: Props): JSX.Element | null {
  const t = useT()
  const quitRef = useRef<HTMLButtonElement>(null)

  // Auto-focus the Quit button when the modal opens.
  useEffect(() => {
    if (open) {
      quitRef.current?.focus()
    }
  }, [open])

  if (!open) return null

  function handleQuit(): void {
    // Notify the main process that the user consented to quit. Re-uses
    // the standard quit-decision IPC so the main-process ``confirmedQuit``
    // guard is exercised and we don't get a recursive close event.
    if (typeof window !== 'undefined' && window.electron?.notifyQuitDecision) {
      void window.electron.notifyQuitDecision(true)
    }
  }

  return createPortal(
    // Same z-index and surface tokens as Modal.tsx so the overlay
    // semantics are consistent.
    <div
      // Not dismissible — intentionally NO click handler on the backdrop.
      className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-black/70 backdrop-blur-sm"
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
          {t('app.backendFailedBody')}
        </p>

        {logsPath && (
          <p className="text-xs text-text-muted font-mono break-all">
            {t('app.logFile')} {logsPath}/backend.log
          </p>
        )}

        <div className="flex justify-end pt-2">
          <button
            ref={quitRef}
            onClick={handleQuit}
            className="px-4 py-2 bg-status-danger text-white rounded text-sm hover:bg-status-danger/90 focus:outline-none focus:ring-2 focus:ring-status-danger"
          >
            {t('app.quit')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
