// What the main process should DO about an uncaught error.
//
// Born from a real incident (2026-08-28): ten "StrixGeo — unexpected error /
// EPIPE: broken pipe, write" modals stacked up on the owner's desktop, one per
// Electron instance whose reader had gone away. A broken output pipe means
// nobody is listening to our console any more — the app itself is fine — so
// killing it and demanding a click is the wrong answer. It is not a
// test-only situation either: a packaged app launched from a terminal the user
// then closes hits exactly the same path.
//
// CP1 — EPIPE on a write is ignorable: the app keeps running.
// CP2 — a destroyed stream is the same situation under a different code.
// CP3 — EIO on a write (the console's terminal died) is ignorable too.
// CP4 — a real programming error stays fatal.
// CP5 — a non-Error value stays fatal (never swallow what we cannot classify).
// CP6 — EPIPE that is NOT about writing output stays fatal (a socket we own).

import { describe, expect, it } from 'vitest'

import { crashActionFor, isBrokenPipe } from './mainCrashPolicy'

/** An errno-style error the way Node raises one. */
function errno(code: string, syscall?: string): NodeJS.ErrnoException {
  const err = new Error(`${code}: broken pipe, write`) as NodeJS.ErrnoException
  err.code = code
  if (syscall !== undefined) err.syscall = syscall
  return err
}

describe('crashActionFor — a dead output pipe is not a crash', () => {
  it('CP1 — EPIPE on a write keeps the app alive', () => {
    expect(crashActionFor(errno('EPIPE', 'write'))).toBe('ignore-broken-pipe')
    expect(isBrokenPipe(errno('EPIPE', 'write'))).toBe(true)
  })

  it('CP2 — a destroyed stream is the same situation', () => {
    expect(crashActionFor(errno('ERR_STREAM_DESTROYED'))).toBe('ignore-broken-pipe')
  })

  it('CP3 — EIO on a write (the terminal died) keeps the app alive', () => {
    expect(crashActionFor(errno('EIO', 'write'))).toBe('ignore-broken-pipe')
  })

  it('CP4 — a real programming error is still fatal', () => {
    expect(crashActionFor(new TypeError('x is not a function'))).toBe('fatal')
    expect(isBrokenPipe(new TypeError('nope'))).toBe(false)
  })

  it('CP5 — anything unclassifiable is fatal, never swallowed', () => {
    expect(crashActionFor('a string')).toBe('fatal')
    expect(crashActionFor(null)).toBe('fatal')
    expect(crashActionFor(undefined)).toBe('fatal')
  })

  it('CP6 — EPIPE on a socket we own is NOT the console dying, so it stays fatal', () => {
    expect(crashActionFor(errno('EPIPE', 'connect'))).toBe('fatal')
  })
})
