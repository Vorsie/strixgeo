/**
 * Window-close handshake state — the decision half of ``win.on('close')``.
 *
 * Closing the window is not main's call to make on its own: the renderer owns
 * the project's dirty state and runs the save-or-discard prompt. So main
 * intercepts the close, asks over ``app:before-quit`` and waits for
 * ``app:quit-decision``.
 *
 * The failure that made this a module: the renderer's subscriber lives in a
 * ``useEffect`` inside ``App``'s hook tree. When the ErrorBoundary swaps in its
 * fallback, ``App`` unmounts and the subscriber goes with it — the question is
 * asked, nobody answers, and every subsequent close is prevented forever. X,
 * Alt+F4 and File → Quit all silently no-op on the exact screen built for
 * crash recovery.
 *
 * Two escapes, both here rather than in ``index.ts`` so they are unit-testable
 * without Electron:
 *
 *  * A close arriving while an earlier one is still unanswered means the user
 *    pressed X and nothing happened — main offers a native "close anyway"
 *    confirmation. Deliberately user-initiated rather than on a timer: the
 *    renderer's own prompt can legitimately sit open for minutes while the
 *    engineer decides whether to save, and a timed force-close would put a
 *    native modal on top of it (or worse, discard the work).
 *  * A dead renderer process (``render-process-gone``) can neither answer nor
 *    hold unsaved state, so its window closes on the first request.
 *
 * @module main/quitHandshake
 */

/** What ``win.on('close')`` should do with this close request. */
export interface CloseDecision {
  /**
   * ``close`` — let the OS close proceed.
   * ``ask-renderer`` — preventDefault and send ``app:before-quit``.
   * ``confirm-force-close`` — preventDefault and offer the native way out.
   */
  action: 'close' | 'ask-renderer' | 'confirm-force-close'
  /** Human-readable why, logged next to the action. */
  reason: string
}

/**
 * Tracks whether a close may proceed, whether one is awaiting the renderer,
 * and whether the renderer is still alive to be asked.
 *
 * One instance per window. All methods are synchronous and side-effect free —
 * the caller performs the IPC, the dialog and the actual close.
 */
export class QuitHandshake {
  /** A close was intercepted and the renderer has not answered it yet. */
  private awaitingRenderer = false

  /** The quit is decided — the next close must go through untouched. */
  private closeApproved = false

  /** The renderer process died; there is nobody left to ask. */
  private rendererGone = false

  /**
   * Decide what to do with a close request.
   *
   * @returns The action for ``win.on('close')`` plus the reason to log.
   */
  requestClose(): CloseDecision {
    if (this.closeApproved) {
      return { action: 'close', reason: 'quit already approved' }
    }
    if (this.rendererGone) {
      return {
        action: 'close',
        reason: 'renderer process is gone — nothing left to ask or to save',
      }
    }
    if (this.awaitingRenderer) {
      return {
        action: 'confirm-force-close',
        reason: 'closed again while the first request is unanswered',
      }
    }
    this.awaitingRenderer = true
    return { action: 'ask-renderer', reason: 'asking the renderer to confirm' }
  }

  /**
   * Record the renderer's answer to ``app:before-quit``.
   *
   * @param allowed - True when the renderer saved or discarded and the quit
   *   may finish; false when the user cancelled.
   */
  noteRendererDecision(allowed: boolean): void {
    this.awaitingRenderer = false
    if (allowed) this.closeApproved = true
  }

  /**
   * Record that the renderer process died (``render-process-gone``).
   *
   * Its window is then closable on the first request: a dead renderer cannot
   * answer the handshake, and whatever it held in memory is already lost.
   */
  noteRendererGone(): void {
    this.rendererGone = true
  }

  /**
   * Record that a renderer document finished loading in this window.
   *
   * "Gone" must be a state the window can LEAVE. A renderer that died and was
   * reloaded — or the ErrorBoundary's own Reload — gives the window a working
   * app again, holding the project and able to run the save prompt; closing
   * that without asking would discard the engineer's work with no prompt at
   * all. The fresh document also brings a fresh ``app:before-quit``
   * subscriber, so an unanswered close is answerable again.
   *
   * ``closeApproved`` is deliberately NOT cleared: a quit the user already
   * confirmed stays confirmed, otherwise the programmatic close that follows
   * the decision would start the handshake over.
   */
  noteRendererAlive(): void {
    this.rendererGone = false
    this.awaitingRenderer = false
  }

  /** The user picked "Close anyway" on the native confirmation. */
  noteForceCloseConfirmed(): void {
    this.awaitingRenderer = false
    this.closeApproved = true
  }

  /**
   * The user picked "Keep open" on the native confirmation.
   *
   * ``awaitingRenderer`` stays set on purpose: the app is still stuck, so the
   * next close must offer the way out again rather than fall back to a silent
   * no-op. A late renderer answer clears it the normal way.
   */
  noteForceCloseDeclined(): void {
    /* state unchanged — see the docstring */
  }
}
