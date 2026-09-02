/**
 * Top-level React ErrorBoundary.
 *
 * Catches render exceptions that React cannot recover from on its own
 * and shows a fallback UI instead of a blank window. The fallback tells
 * the user where the log file lives (when Electron exposes the path) and
 * offers a Reload button.
 *
 * Note: ``render-process-gone`` does NOT fire for React render errors —
 * it fires for native renderer-process crashes (OOM, GPU fault). A thrown
 * exception inside a React component tree is caught here, not there.
 *
 * Usage
 * -----
 * Wrap the app root:
 *
 *   <ErrorBoundary>
 *     <App />
 *   </ErrorBoundary>
 */

import React from 'react'
import { log } from '../utils/log'
// Class component — cannot use the useT() hook, so the module-level t() reads
// the active language at render time. An error screen is shown after a crash
// and is not expected to re-render on a live language flip.
import { t } from '../i18n/translate'

interface Props {
  children: React.ReactNode
  /** Override for testing — inject the logs path without IPC. */
  logsPath?: string
}

interface State {
  hasError: boolean
  errorMessage: string
  logsPath: string | null
}

/**
 * Top-level React class ErrorBoundary.
 *
 * Parameters
 * ----------
 * children : React.ReactNode
 *     The application subtree to protect.
 * logsPath : string, optional
 *     Injected logs directory path (used in tests). In production the
 *     path is read from the ``app:logs-path`` IPC channel on mount.
 */
export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = {
      hasError: false,
      errorMessage: '',
      logsPath: props.logsPath ?? null,
    }
  }

  static getDerivedStateFromError(error: unknown): Partial<State> {
    const msg = error instanceof Error ? error.message : String(error)
    return { hasError: true, errorMessage: msg }
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    const msg = error instanceof Error ? error.message : String(error)
    log.error(
      'ErrorBoundary',
      'Uncaught render error — component stack below',
      msg,
      info.componentStack,
    )
    // Forward to the main-process log if the IPC bridge is available.
    if (
      typeof window !== 'undefined' &&
      window.electron?.logRendererError
    ) {
      window.electron.logRendererError(
        msg,
        info.componentStack ?? '(no component stack)',
      )
    }
  }

  componentDidMount(): void {
    // Read the logs directory path from the main process so the fallback
    // screen can display it. This is a best-effort call — if the IPC
    // bridge is unavailable (tests, early boot) we skip it silently.
    if (
      !this.state.logsPath &&
      typeof window !== 'undefined' &&
      window.electron?.getLogsPath
    ) {
      void window.electron.getLogsPath().then((p) => {
        this.setState({ logsPath: p })
      })
    }
  }

  render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children
    }

    return (
      <div
        role="alert"
        className="flex flex-col items-center justify-center h-screen bg-surface-app text-text-primary gap-4 p-8"
      >
        <div className="text-status-danger text-lg font-semibold">
          {t('app.crashTitle')}
        </div>
        <div className="text-text-secondary text-sm max-w-md text-center">
          {this.state.errorMessage}
        </div>
        {this.state.logsPath && (
          <div className="text-text-muted text-xs text-center max-w-md">
            {t('app.logFile')}{' '}
            <span className="font-mono">{this.state.logsPath}/backend.log</span>
          </div>
        )}
        <button
          autoFocus
          onClick={() => window.location.reload()}
          className="mt-2 px-4 py-2 bg-accent text-text-on-accent rounded text-sm hover:bg-accent/90 focus:outline-none focus:ring-2 focus:ring-accent"
        >
          {t('app.reload')}
        </button>
      </div>
    )
  }
}
