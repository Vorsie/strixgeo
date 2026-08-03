// `trace` is the level that has to stay quiet to be worth having.
//
// Owner paste 2026-08-02: the shell's per-render line ran at `debug` and fired
// dozens of times a second, so the dev console was useless for anything else.
// Deleting the line would have lost a genuinely useful signal; the fix is a
// level that is silent until asked for.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { log, TRACE_OPT_IN_KEY } from './log'

let debugSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  localStorage.removeItem(TRACE_OPT_IN_KEY)
  debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.removeItem(TRACE_OPT_IN_KEY)
})

describe('log.trace', () => {
  it('LT1 writes nothing without the opt-in — the default is silence', () => {
    log.trace('shell', 'render stage=sections inspectorOpen=true')
    expect(debugSpy).not.toHaveBeenCalled()
  })

  it('LT2 writes once the device opts in', () => {
    localStorage.setItem(TRACE_OPT_IN_KEY, '1')

    log.trace('shell', 'render stage=sections inspectorOpen=true')

    expect(debugSpy).toHaveBeenCalledTimes(1)
    expect(String(debugSpy.mock.calls[0][0])).toContain('TRACE')
  })

  it('LT3 reads the flag per call, so it can be flipped mid-session', () => {
    log.trace('shell', 'before')
    localStorage.setItem(TRACE_OPT_IN_KEY, '1')
    log.trace('shell', 'after')

    expect(debugSpy).toHaveBeenCalledTimes(1)
    expect(debugSpy.mock.calls[0]).toContain('after')
  })

  it('LT4 leaves log.debug alone — demoting one line must not mute the level', () => {
    log.debug('shell', 'a real per-decision line')
    expect(debugSpy).toHaveBeenCalledTimes(1)
  })
})
