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

  // Playwright runs ONLY *.spec.ts. The walker's pure modules ship their own
  // *.test.ts beside the spec (run by Vitest, not Playwright); the default
  // testMatch also grabs *.test.ts, which would make Playwright try to run those
  // vitest files and fail on their vitest import. Every existing e2e file is a
  // .spec.ts, so this narrowing changes nothing for them.
  testMatch: '**/*.spec.ts',

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
    // Cap every action (click/fill/etc.) so a stuck-actionability click fails
    // fast with its exact locator instead of retrying until the whole test
    // timeout (which made a single un-actionable button read as a dead hang).
    actionTimeout: 20_000,
  },

  // Output directory for traces, screenshots, and videos.
  outputDir: path.join(__dirname, 'tests', 'e2e', '_results'),

  // Electron is NOT a browser project — no ``projects`` array needed.
  // Playwright automatically routes _electron.launch calls to the
  // Electron driver it ships.
})
