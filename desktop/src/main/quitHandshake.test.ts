// Rules for the window-close handshake between main and the renderer.
//
// The behaviour these pin comes from a dogfeed dead end: after a React render
// error the ErrorBoundary fallback replaces App, which takes the renderer's
// ``app:before-quit`` subscriber with it. Main kept preventing every close and
// waiting for an answer that could never arrive, so X, Alt+F4 and File → Quit
// all silently did nothing on the exact screen built for crash recovery.

import { describe, expect, it } from 'vitest'

import { QuitHandshake } from './quitHandshake'

describe('QuitHandshake', () => {
  it('asks the renderer the first time the user closes the window', () => {
    const handshake = new QuitHandshake()
    expect(handshake.requestClose().action).toBe('ask-renderer')
  })

  it('lets the close through once the renderer agreed', () => {
    const handshake = new QuitHandshake()
    handshake.requestClose()
    handshake.noteRendererDecision(true)
    expect(handshake.requestClose().action).toBe('close')
  })

  it('asks again — not force-close — after the user cancelled the quit', () => {
    const handshake = new QuitHandshake()
    handshake.requestClose()
    handshake.noteRendererDecision(false)
    expect(handshake.requestClose().action).toBe('ask-renderer')
  })

  it('offers a way out when the user closes again and the first close was never answered', () => {
    const handshake = new QuitHandshake()
    handshake.requestClose()
    // No app:quit-decision came back — nobody is listening (crash screen).
    expect(handshake.requestClose().action).toBe('confirm-force-close')
  })

  it('closes when the user confirms the force close', () => {
    const handshake = new QuitHandshake()
    handshake.requestClose()
    handshake.requestClose()
    handshake.noteForceCloseConfirmed()
    expect(handshake.requestClose().action).toBe('close')
  })

  it('keeps the window open — and keeps offering the way out — when the user declines', () => {
    const handshake = new QuitHandshake()
    handshake.requestClose()
    handshake.requestClose()
    handshake.noteForceCloseDeclined()
    // Still stuck, so the next close must not drop back to a silent no-op.
    expect(handshake.requestClose().action).toBe('confirm-force-close')
  })

  it('a late renderer answer after a declined force close still decides the quit', () => {
    const handshake = new QuitHandshake()
    handshake.requestClose()
    handshake.requestClose()
    handshake.noteForceCloseDeclined()
    handshake.noteRendererDecision(false)
    expect(handshake.requestClose().action).toBe('ask-renderer')
  })

  it('closes without asking when the renderer process is gone', () => {
    const handshake = new QuitHandshake()
    handshake.noteRendererGone()
    // There is no renderer left to prompt, and nothing it could still save.
    expect(handshake.requestClose().action).toBe('close')
  })

  it('closes a window whose first close is still unanswered once the renderer dies', () => {
    const handshake = new QuitHandshake()
    handshake.requestClose()
    handshake.noteRendererGone()
    expect(handshake.requestClose().action).toBe('close')
  })

  // A window whose renderer died and then came back (a reload after the crash)
  // is a WORKING app again: it holds the project, it runs the save prompt, and
  // closing it without asking would discard whatever the engineer did since the
  // reload with no prompt at all. "Gone" has to be a state the app can leave.
  it('asks again once a renderer is running in the window after a crash', () => {
    const handshake = new QuitHandshake()
    handshake.noteRendererGone()
    handshake.noteRendererAlive()
    expect(handshake.requestClose().action).toBe('ask-renderer')
  })

  it('a reload while a close is unanswered gets a fresh question, not a force prompt', () => {
    const handshake = new QuitHandshake()
    handshake.requestClose()
    // The page reloaded — the new document has its own before-quit subscriber.
    handshake.noteRendererAlive()
    expect(handshake.requestClose().action).toBe('ask-renderer')
  })

  it('a reload does NOT un-approve a quit the user already confirmed', () => {
    const handshake = new QuitHandshake()
    handshake.requestClose()
    handshake.noteRendererDecision(true)
    handshake.noteRendererAlive()
    expect(handshake.requestClose().action).toBe('close')
  })

  it('names the reason on every decision so the close flow is readable in the log', () => {
    const handshake = new QuitHandshake()
    expect(handshake.requestClose().reason).toBeTruthy()
    expect(handshake.requestClose().reason).toBeTruthy()
    handshake.noteRendererGone()
    expect(handshake.requestClose().reason).toBeTruthy()
  })
})
