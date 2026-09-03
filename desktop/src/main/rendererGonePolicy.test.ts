// H3(d) — when the renderer process dies from a real fault, reload the window
// ONCE so the app can recover; a deliberate teardown (killed / clean-exit) is
// left alone, and the reload is guarded so a reload-crash-loop cannot form. The
// crash-recovery offer on the reloaded document takes over from there.

import { describe, expect, it } from 'vitest'

import { shouldReloadRendererAfterGone } from './rendererGonePolicy'

describe('shouldReloadRendererAfterGone', () => {
  it('reloads once on a genuine crash', () => {
    expect(shouldReloadRendererAfterGone('crashed', false)).toBe(true)
    expect(shouldReloadRendererAfterGone('oom', false)).toBe(true)
    expect(shouldReloadRendererAfterGone('launch-failed', false)).toBe(true)
    expect(shouldReloadRendererAfterGone('integrity-failure', false)).toBe(true)
  })

  it('does NOT reload a deliberate teardown', () => {
    // ``killed`` is what Electron reports when the app is quitting (or an e2e
    // harness kills the renderer); ``clean-exit`` is a normal shutdown. Reloading
    // either would fight a teardown that is supposed to happen.
    expect(shouldReloadRendererAfterGone('killed', false)).toBe(false)
    expect(shouldReloadRendererAfterGone('clean-exit', false)).toBe(false)
  })

  it('does NOT reload a second time (anti-loop guard)', () => {
    // A crash that recurs immediately — before the reloaded document finishes
    // loading and clears the guard — must not spin.
    expect(shouldReloadRendererAfterGone('crashed', true)).toBe(false)
  })
})
