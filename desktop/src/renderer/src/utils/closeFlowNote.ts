// One close-flow line, written to BOTH consoles.
//
// The close flow (close requested → dirty? → which dialog → which button →
// quit decision) never touches the API, so a report of the shape "it discarded
// my work without asking" has no server log behind it and no reliable repro:
// the user did it once, days ago. The renderer's own INFO lines are the only
// witness — and in a packaged build nobody can see them. DevTools is disabled
// there (debt #200 / autosave design Q6) and the renderer console is forwarded
// nowhere, while dogfeed reports arrive as pasted TERMINAL output, which shows
// the MAIN process only.
//
// So each line goes to ``log.info`` (dev DevTools, unchanged) and, through one
// dedicated IPC channel, to main's stdout next to its own ``[main] close
// intercepted`` / ``[main] quit decision`` lines. One paste, one sequence, both
// halves of the handshake.
//
// Deliberately NOT a general renderer→main log bridge. That would flood
// stdout, and every string it printed would be one more renderer-supplied
// value to bound. This carries the close flow's handful of decision points and
// nothing else; anything wider needs its own design.

import { log } from './log'

/** Whether the "IPC unavailable" warning has already been emitted. */
let bridgeWarned = false

/**
 * Record one close-flow decision point.
 *
 * @param message - What just happened, in the close flow's own vocabulary
 *   ("close requested from menu, dirty=true"). Kept short: main caps the line
 *   it prints, and these are read as a sequence, not as prose.
 */
export function noteCloseFlow(message: string): void {
  log.info('project', message)
  // Fire-and-forget. A close-flow decision must never wait on — or fail
  // because of — its own diagnostics, and the renderer-side line above already
  // landed. The channel is also absent in unit tests and in any older preload,
  // hence the optional call rather than a hard reference.
  try {
    const bridge = window.electron?.closeFlowNote
    if (typeof bridge !== 'function') return
    void bridge(message)?.catch?.(() => {
      // An IPC rejection here means main is going away — which is the normal
      // end of a quit, not a problem worth a line of its own.
    })
  } catch (err) {
    // Once only: if the bridge is missing it is missing for every subsequent
    // line, and a warning per decision point would bury the notes themselves.
    if (!bridgeWarned) {
      bridgeWarned = true
      log.warn('project', 'close-flow notes are not reaching the main process', err)
    }
  }
}
