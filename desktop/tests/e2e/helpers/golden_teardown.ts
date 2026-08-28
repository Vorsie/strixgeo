/**
 * Teardown plumbing for the Cesium VISUAL-GOLDEN specs.
 *
 * Split out of ``visual_golden.ts`` when that file crossed the 500-line
 * advisory (debt #201): the golden helper owns DETERMINISM (re-seed, network
 * block, window bounds, target resolution), this file owns SHUTDOWN.
 *
 * Both helpers exist because of the same measured failure: a ``finally`` block
 * that hangs burns the whole test budget and is reported as a timeout at
 * whatever line the test body last touched — so the failure looks like a slow
 * assertion when it is really a stuck teardown. Both golden specs consumed
 * their entire budget that way (300 s, then 600 s), each having already
 * REACHED its screenshot.
 */

import { closeApp } from './electron_launch'

/**
 * Run one teardown step under its own budget, logging what it cost.
 *
 * Never throws: a teardown failure must not mask the real assertion failure.
 *
 * Parameters
 * ----------
 * label
 *     Step name for the log line.
 * budgetMs
 *     How long the step may take before it is abandoned.
 * work
 *     The step itself.
 */
export async function timedTeardownStep(
  label: string,
  budgetMs: number,
  work: () => Promise<unknown>,
): Promise<void> {
  const started = Date.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      work(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`exceeded ${budgetMs} ms`)), budgetMs)
      }),
    ])
    console.log(`[teardown] ${label}: ${Date.now() - started} ms`)
  } catch (err) {
    console.log(`[teardown] ${label}: ABANDONED after ${Date.now() - started} ms — ${String(err)}`)
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * Close the app, and KILL it if the quit does not return in time.
 *
 * MEASURED (2026-08-28, via ``timedTeardownStep``): with a built litho model
 * mounted in the Cesium viewer, ``app.close()`` never returns — 90 s and
 * counting — while the same call on a page with no 3-D scene returns in
 * ~0.6 s. A WebGL context under SwiftShader can block the quit, and Playwright
 * then fails the WORKER with its own teardown timeout, turning a run whose
 * assertions all passed into a red one.
 *
 * ``closeApp`` is still tried first, so the graceful path (which answers the
 * unsaved-changes prompt) stays the normal case. The kill is the fallback, and
 * it targets ONLY the Electron process — the backend on :8765 belongs to the
 * harness script, which stops it itself.
 *
 * Parameters
 * ----------
 * The budget is deliberately SHORT. Playwright gives the whole worker 60 s to
 * tear down, and that clock covers this function plus its own fixture
 * teardown: a 45 s wait here consumed the window and failed the worker even
 * after the kill worked. A close that is going to succeed does so in about a
 * second, so waiting longer only ever delays the inevitable.
 *
 * Parameters
 * ----------
 * app
 *     The Playwright Electron application handle.
 * budgetMs
 *     How long the graceful close may take before the process is killed.
 */
export async function closeAppOrKill(
  app: import('@playwright/test').ElectronApplication,
  budgetMs = 10_000,
): Promise<void> {
  const started = Date.now()
  let closed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  // The catch is attached to the close promise ITSELF, not just around the
  // race: when the kill path wins, this promise is still pending, and a late
  // rejection on an unwatched promise surfaces as an unhandled rejection that
  // Playwright reports against whichever test is running next.
  const closing = closeApp(app)
    .then(() => {
      closed = true
    })
    .catch(() => {
      /* a crashed renderer is an already-caught test failure */
    })
  try {
    await Promise.race([
      closing,
      new Promise<void>(resolve => {
        timer = setTimeout(resolve, budgetMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
  if (closed) {
    console.log(`[teardown] closeApp: ${Date.now() - started} ms`)
    return
  }
  console.log(
    `[teardown] closeApp did not return in ${budgetMs} ms — killing Electron ` +
      '(a mounted WebGL scene blocks the quit).',
  )
  try {
    app.process().kill()
  } catch {
    /* already gone */
  }
  // Let the (now doomed) close settle before returning, so Playwright's own
  // fixture teardown does not start while this operation is still pending.
  await Promise.race([
    closing,
    new Promise<void>(resolve => {
      setTimeout(resolve, 5_000)
    }),
  ])
}
