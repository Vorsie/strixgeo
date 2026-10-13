/**
 * The pure half of ``closeApp``'s dirty-quit handling: deciding which window
 * shows the unsaved-changes prompt, and writing the report a hung teardown
 * leaves behind.
 *
 * Kept free of Playwright so vitest can pin it (``closeAppProbe.test.ts``);
 * ``electron_launch.ts`` gathers the ``WindowProbe`` rows from the live pages
 * and does the clicking.
 *
 * Why this exists (walker 2026-10-13, twice): after a walk the project was
 * dirty, the quit opened the prompt, and the teardown never got through it —
 * and the log said nothing about what the window was showing at the time.
 */

/** How many characters of a window's body text a hang report keeps. */
export const BODY_EXCERPT_CHARS = 300

/** The test id of the unsaved-changes prompt's card (Modal's ``testid``). */
export const UNSAVED_DIALOG_TESTID = 'unsaved-changes-dialog'

/** The test id the discard BUTTON itself carries (ConfirmDialog ``secondary.testid``). */
export const UNSAVED_DISCARD_TESTID = 'unsaved-discard-and-close'

/** What one window was showing when ``closeApp`` looked at it. */
export interface WindowProbe {
  /** Position in ``app.windows()`` at probe time. */
  index: number
  /** The page URL (``sheet.html`` = the hidden PDF print window). */
  url: string
  /** Playwright already reports the page as closed. */
  closed: boolean
  /** The renderer answered the probe within its bound (false = hung or gone). */
  reachable: boolean
  /** ``document.title`` (carries the project name and the dirty ``*``). */
  title: string | null
  /** The unsaved-changes prompt is in this window's DOM. */
  dialog: boolean
  /** The prompt's discard button: missing, clickable, or disabled (save in flight). */
  discard: 'absent' | 'enabled' | 'disabled'
  /** ``document.body.innerText`` (untrimmed), or null when it could not be read. */
  bodyText: string | null
}

/**
 * The index of the window whose prompt can be discarded, or null.
 *
 * Only a reachable, open window whose prompt carries an ENABLED discard button
 * qualifies: a disabled button (a save in flight) cannot be clicked, and
 * clicking into a closed or hung page only burns the teardown's budget.
 *
 * Parameters
 * ----------
 * probes
 *     One row per window, in ``app.windows()`` order.
 *
 * Returns
 * -------
 * number | null
 *     The ``index`` of the first qualifying window, or null when none does.
 */
export function pickDialogWindow(probes: readonly WindowProbe[]): number | null {
  const hit = probes.find(p => !p.closed && p.reachable && p.dialog && p.discard === 'enabled')
  return hit ? hit.index : null
}

/**
 * The first ``BODY_EXCERPT_CHARS`` characters of a body text, on one line.
 *
 * Parameters
 * ----------
 * text
 *     The raw ``innerText``, or null when the page could not be read.
 *
 * Returns
 * -------
 * string
 *     Whitespace runs collapsed to one space, trimmed, cut to the limit; the
 *     marker ``<unreadable>`` for null.
 */
export function bodyExcerpt(text: string | null): string {
  if (text === null) return '<unreadable>'
  return text.replace(/\s+/g, ' ').trim().slice(0, BODY_EXCERPT_CHARS)
}

/**
 * One log line per window, for the hang report ``closeApp`` prints before it
 * kills a launch that would not quit.
 *
 * Parameters
 * ----------
 * probes
 *     One row per window, in ``app.windows()`` order.
 *
 * Returns
 * -------
 * string[]
 *     ``window[i] <state> url=... title=... prompt=yes|no discard=... body="..."``
 *     per window, or ``['no windows']`` when there are none.
 */
export function formatWindowReport(probes: readonly WindowProbe[]): string[] {
  if (probes.length === 0) return ['no windows']
  return probes.map(p => {
    const state = p.closed ? 'closed' : p.reachable ? 'open' : 'UNREACHABLE'
    return (
      `window[${p.index}] ${state} url=${p.url} title=${JSON.stringify(p.title ?? '')} ` +
      `prompt=${p.dialog ? 'yes' : 'no'} discard=${p.discard} body="${bodyExcerpt(p.bodyText)}"`
    )
  })
}
