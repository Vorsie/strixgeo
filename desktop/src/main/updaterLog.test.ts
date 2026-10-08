// Owner finding 2026-10-08: no update prompt appeared and the packaged app left
// no trace of why. The updater's only failure line was a ``console.warn``, which a
// packaged app loses. The updater must write to the main log (backend.log) with
// an ``[updater]`` prefix: electron-updater's own messages, each phase it emits,
// and a failed check.

import { describe, expect, it } from 'vitest'

import {
  createUpdaterLogger,
  describeCheckFailure,
  describeUpdaterEvent,
  shouldLogUpdaterEvent,
} from './updaterLog'

/** A fake main-log writer that records every line. */
function fakeWriter(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = []
  return { lines, write: (line: string) => lines.push(line) }
}

describe('createUpdaterLogger — electron-updater writes to the main log', () => {
  it('UL1 - every level reaches the writer with the [updater] prefix and its level', () => {
    const { lines, write } = fakeWriter()
    const logger = createUpdaterLogger(write)
    logger.info('Checking for update')
    logger.warn('slow feed')
    logger.error('boom')
    logger.debug('detail')
    expect(lines).toEqual([
      '[updater] info Checking for update',
      '[updater] warn slow feed',
      '[updater] error boom',
      '[updater] debug detail',
    ])
  })

  it('UL2 - an Error object is written with its message, never "[object Object]"', () => {
    const { lines, write } = fakeWriter()
    createUpdaterLogger(write).error(new Error('net::ERR_INTERNET_DISCONNECTED'))
    expect(lines).toEqual(['[updater] error net::ERR_INTERNET_DISCONNECTED'])
  })

  it('UL3 - a writer that throws never takes the updater down', () => {
    const logger = createUpdaterLogger(() => {
      throw new Error('disk full')
    })
    expect(() => logger.info('x')).not.toThrow()
  })
})

describe('describeUpdaterEvent — each emitted phase is one log line', () => {
  it('UL4 - an available update names the version', () => {
    // The service passes its full UpdateAvailableNotice; only the version is read.
    const notice = { version: '0.1.5', releaseName: null, releaseNotes: null }
    expect(describeUpdaterEvent({ phase: 'available', notice })).toBe('[updater] phase available (version 0.1.5)')
  })

  it('UL5 - an error names its reason and message', () => {
    expect(
      describeUpdaterEvent({ phase: 'error', errorReason: 'blocked', message: '403 Forbidden' }),
    ).toBe('[updater] phase error (reason blocked: 403 Forbidden)')
  })

  it('UL6 - a calm phase is just the phase', () => {
    expect(describeUpdaterEvent({ phase: 'not-available' })).toBe('[updater] phase not-available')
  })

  it('UL7 - download progress names the percent', () => {
    expect(describeUpdaterEvent({ phase: 'downloading', progressPercent: 50 })).toBe(
      '[updater] phase downloading (50%)',
    )
  })
})

describe('shouldLogUpdaterEvent — progress does not flood the log', () => {
  it('UL8 - a phase change is always logged', () => {
    expect(shouldLogUpdaterEvent({ phase: 'available' }, null)).toBe(true)
    expect(shouldLogUpdaterEvent({ phase: 'downloading', progressPercent: 3 }, { phase: 'available' })).toBe(true)
  })

  it('UL9 - progress is logged once per quarter, not per tick', () => {
    const at = (p: number) => ({ phase: 'downloading' as const, progressPercent: p })
    expect(shouldLogUpdaterEvent(at(10), at(3))).toBe(false)
    expect(shouldLogUpdaterEvent(at(26), at(24))).toBe(true)
    expect(shouldLogUpdaterEvent(at(100), at(99))).toBe(true)
  })
})

describe('describeCheckFailure — the rejected check reaches the log', () => {
  it('UL10 - names the error message', () => {
    expect(describeCheckFailure(new Error('HttpError: 404'))).toBe('[updater] check failed: HttpError: 404')
    expect(describeCheckFailure('plain')).toBe('[updater] check failed: plain')
  })
})
