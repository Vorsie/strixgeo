/**
 * Playwright configuration for the Strix desktop Electron app.
 *
 * The harness launches the packaged dev build via ``_electron.launch``
 * rather than a browser; no ``baseURL`` is needed. The FastAPI backend
 * is a precondition — the harness does NOT start it.
 *
 * Two test suites:
 *   test:e2e:smoke  — flow_boot_open only (~10 s); wired into pre-commit
 *   test:e2e:full   — all 6 flows (~2 min); for manual / nightly use
 */

import { defineConfig } from '@playwright/test'
import path from 'path'

export default defineConfig({
  // All e2e specs live in tests/e2e/.
  testDir: path.join(__dirname, 'tests', 'e2e'),

  // Give each test up to 60 s before Playwright marks it as timed out.
  // The bulk-accept flow (flow 3) is the most expensive — 70 anchors × 1
  // inference pass — but must complete in < 15 s per the acceptance
  // criterion. 60 s is a generous ceiling; the bulk flow uses a timing
  // assertion inside it, so this outer timeout handles true hangs only.
  timeout: 60_000,

  // Expect() timeout — short: DOM interactions should resolve in < 5 s.
  expect: { timeout: 5_000 },

  // No retries; every flaky test must be fixed at root cause.
  retries: 0,

  // Each spec file runs in its own isolated worker so a crashed Electron
  // process from one flow doesn't bleed into the next.
  workers: 1,

  // Capture screenshot + video on failure for post-mortem analysis.
  use: {
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  // Output directory for traces, screenshots, and videos.
  outputDir: path.join(__dirname, 'tests', 'e2e', '_results'),

  // Electron is NOT a browser project — no ``projects`` array needed.
  // Playwright automatically routes _electron.launch calls to the
  // Electron driver it ships.
})
