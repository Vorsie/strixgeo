/**
 * Per-stage React ErrorBoundary (audit M5).
 *
 * The shell's single root ``ErrorBoundary`` replaces the WHOLE app on any render
 * throw — a bug in one 4k-line stage canvas blanks the spine, the inspector and
 * every other stage, and the only recovery is a full reload that drops all
 * renderer-only state. This boundary wraps ONE stage slot: a crash there shows a
 * "reset this stage" card inside that slot while the rest of the shell keeps
 * working, and Reset remounts just that stage.
 *
 * It is a class component because only class components can be error boundaries
 * (``getDerivedStateFromError`` / ``componentDidCatch`` have no hook form).
 */

import React from 'react'

import { log } from '../utils/log'
import { captureDiagnostic } from '../utils/diagnostics'
// Class component — cannot use the useT() hook, so the module-level t() reads
// the active language at render time. A crash card is not expected to re-render
// on a live language flip.
import { t } from '../i18n/translate'

interface Props {
  children: React.ReactNode
  /**
   * A value that identifies the wrapped stage (the active stage id). When it
   * changes, a still-standing crash is cleared so navigating to a DIFFERENT
   * stage shows that stage, not the crashed one's card.
   */
  resetKey: string
  /** Optional hook fired when the user presses Reset (e.g. to re-key upstream). */
  onReset?: () => void
}

interface State {
  hasError: boolean
  message: string
  /** Bumped on Reset to force a fresh remount of the children subtree. */
  remountToken: number
}

/**
 * Error boundary scoped to a single stage slot.
 *
 * Parameters
 * ----------
 * children : React.ReactNode
 *     The stage subtree to protect.
 * resetKey : string
 *     The active stage id; a change clears a prior stage's crash.
 * onReset : () => void, optional
 *     Fired when Reset is pressed.
 */
export default class StageErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, message: '', remountToken: 0 }
  }

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : String(error),
    }
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    const message = error instanceof Error ? error.message : String(error)
    const stage = this.props.resetKey
    log.error('stage', `stage '${stage}' crashed — ${message}`, info.componentStack)
    // Same local-diagnostics bridge the root boundary + global handlers use, so
    // "which stage died and why" reaches the support bundle (debt #16).
    captureDiagnostic({
      kind: 'renderer-error',
      scope: 'stage',
      message: `stage '${stage}': ${message}`,
      stack: info.componentStack ?? undefined,
    })
    // Forward to the main-process log file if the IPC bridge is available.
    if (typeof window !== 'undefined' && window.electron?.logRendererError) {
      window.electron.logRendererError(message, info.componentStack ?? '(no component stack)')
    }
  }

  componentDidUpdate(prev: Props): void {
    // Navigating to a different stage clears the prior stage's crash so the new
    // stage renders instead of the stale fallback card. Only acts while an error
    // stands, so a normal re-render never resets anything.
    if (prev.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, message: '' })
    }
  }

  private handleReset = (): void => {
    this.props.onReset?.()
    // Remount the SAME stage fresh. Clearing ``hasError`` alone would re-render
    // the identical (still-crashing) subtree; bumping the token changes the
    // wrapper key so React unmounts and mounts the stage anew.
    this.setState(s => ({ hasError: false, message: '', remountToken: s.remountToken + 1 }))
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          data-testid="stage-error"
          className="flex flex-col items-center justify-center h-full w-full gap-3 p-8 bg-surface-app text-text-primary"
        >
          <div className="text-status-danger text-base font-semibold">
            {t('shell.stageError.title')}
          </div>
          <div className="text-text-secondary text-sm max-w-md text-center">
            {t('shell.stageError.body')}
          </div>
          {this.state.message && (
            <div className="text-text-muted text-xs font-mono max-w-md text-center break-words">
              {this.state.message}
            </div>
          )}
          <button
            autoFocus
            onClick={this.handleReset}
            className="mt-1 px-4 py-2 bg-accent text-text-on-accent rounded text-sm hover:bg-accent/90 focus:outline-none focus:ring-2 focus:ring-accent"
          >
            {t('shell.stageError.reset')}
          </button>
        </div>
      )
    }
    // The key is what forces a clean remount on Reset; on a normal re-render it
    // is unchanged so the stage reconciles as usual.
    return <React.Fragment key={this.state.remountToken}>{this.props.children}</React.Fragment>
  }
}
