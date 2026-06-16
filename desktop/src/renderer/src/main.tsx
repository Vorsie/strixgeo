// MUST be first: sets window.CESIUM_BASE_URL before any cesium module
// evaluates (App's tree imports cesium). See cesiumBaseUrl.ts.
import './cesiumBaseUrl'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import { log } from './utils/log'
import './index.css'

// ---------------------------------------------------------------------------
// Global unhandled error / rejection handlers (#214a)
//
// React's ErrorBoundary catches synchronous render errors thrown inside
// the component tree. These two handlers catch everything else:
//   - ``window.onerror``: uncaught synchronous exceptions thrown outside
//     a component render (e.g. in event listeners, setTimeout callbacks).
//   - ``unhandledrejection``: Promise rejections that no ``.catch`` or
//     try/await absorbed (e.g. a fire-and-forget async fn that throws).
//
// Both log via the existing [ui …] logger so they appear in DevTools
// alongside ordinary log lines, and forward to the main-process log file
// (backend.log) via IPC when the bridge is available.
// ---------------------------------------------------------------------------

window.onerror = (message, source, lineno, colno, error): boolean => {
  const msg = error?.message ?? String(message)
  const location = `${source ?? ''}:${lineno ?? 0}:${colno ?? 0}`
  log.error('globalError', msg, location)
  if (window.electron?.logRendererError) {
    void window.electron.logRendererError(msg, `at ${location}`)
  }
  // Return false so the browser also logs the error to the DevTools console
  // (returning true suppresses the default logging, which we never want).
  return false
}

window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent): void => {
  const reason = event.reason
  const msg = reason instanceof Error ? reason.message : String(reason)
  const stack = reason instanceof Error ? (reason.stack ?? '') : ''
  log.error('unhandledRejection', msg, stack)
  if (window.electron?.logRendererError) {
    void window.electron.logRendererError(msg, stack)
  }
})

// ---------------------------------------------------------------------------
// Root render — wrapped in ErrorBoundary (#214a)
// ---------------------------------------------------------------------------

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
