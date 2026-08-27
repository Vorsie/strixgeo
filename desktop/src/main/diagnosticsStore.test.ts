/**
 * The local diagnostics log — one file, bounded, on the user's own machine.
 *
 * The rule these cases encode: capture is LOCAL and always on (it is a log file
 * in the user's own app directory, exactly like ``backend.log``); it is bounded
 * so it can never eat a disk; and nothing that reaches the file has escaped the
 * redaction pass.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  DIAGNOSTICS_DIR_NAME,
  DIAGNOSTICS_FILENAME,
  DIAGNOSTICS_MAX_BYTES,
  captureDiagnostic,
  configureDiagnosticsStore,
  diagnosticsLogPath,
  readDiagnosticEvents,
  resetDiagnosticsStoreForTests,
} from './diagnosticsStore'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'strix-diagnostics-'))
  configureDiagnosticsStore({ userDataDir: dir, appVersion: '0.1.0', platform: 'win32' })
})

afterEach(() => {
  resetDiagnosticsStoreForTests()
  rmSync(dir, { recursive: true, force: true })
})

describe('capturing an error', () => {
  it('DS1 — a captured error becomes one line in the log', () => {
    captureDiagnostic({ kind: 'renderer-error', message: 'boom' }, 'renderer')

    const lines = readFileSync(diagnosticsLogPath(), 'utf-8').trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0]).message).toBe('boom')
  })

  it('DS2 — two captures append rather than overwrite', () => {
    captureDiagnostic({ kind: 'renderer-error', message: 'first' }, 'renderer')
    captureDiagnostic({ kind: 'main-uncaught', message: 'second' }, 'main')

    expect(readDiagnosticEvents()).toHaveLength(2)
  })

  it('DS3 — what lands on disk has been redacted', () => {
    captureDiagnostic(
      { kind: 'renderer-error', message: 'cannot open D:\\Projecten\\ClientX\\site.strix' },
      'renderer',
    )

    const raw = readFileSync(diagnosticsLogPath(), 'utf-8')
    expect(raw).not.toContain('ClientX')
    expect(raw).toContain('<path:.strix>')
  })

  it('DS4 — an empty diagnostic writes nothing at all', () => {
    const captured = captureDiagnostic({ kind: 'renderer-error' }, 'renderer')

    expect(captured).toBeNull()
    expect(existsSync(diagnosticsLogPath())).toBe(false)
  })

  it('DS5 — the log lives in its own directory under user data', () => {
    expect(diagnosticsLogPath()).toBe(join(dir, DIAGNOSTICS_DIR_NAME, DIAGNOSTICS_FILENAME))
  })

  it('DS6 — a user who deleted the directory still gets their next crash captured', () => {
    captureDiagnostic({ kind: 'renderer-error', message: 'first' }, 'renderer')
    rmSync(join(dir, DIAGNOSTICS_DIR_NAME), { recursive: true, force: true })

    captureDiagnostic({ kind: 'renderer-error', message: 'second' }, 'renderer')

    expect(readDiagnosticEvents()).toHaveLength(1)
  })
})

describe('the log cannot grow without bound', () => {
  it('DS7 — an oversized log is rotated before the next line is written', () => {
    captureDiagnostic({ kind: 'renderer-error', message: 'seed' }, 'renderer')
    writeFileSync(diagnosticsLogPath(), 'x'.repeat(DIAGNOSTICS_MAX_BYTES + 1), 'utf-8')

    captureDiagnostic({ kind: 'renderer-error', message: 'after rotation' }, 'renderer')

    expect(existsSync(`${diagnosticsLogPath()}.1`)).toBe(true)
    expect(readDiagnosticEvents()).toHaveLength(1)
    expect(readDiagnosticEvents()[0].message).toBe('after rotation')
  })
})

describe('reading the log back', () => {
  it('DS8 — an unreadable line is skipped rather than failing the read', () => {
    captureDiagnostic({ kind: 'renderer-error', message: 'good' }, 'renderer')
    writeFileSync(diagnosticsLogPath(), `${readFileSync(diagnosticsLogPath(), 'utf-8')}{ not json\n`)

    expect(readDiagnosticEvents()).toHaveLength(1)
  })

  it('DS9 — no log yet reads as no events', () => {
    expect(readDiagnosticEvents()).toEqual([])
  })
})

describe('the store refuses to guess where it lives', () => {
  it('DS10 — capturing before configuration throws rather than writing somewhere random', () => {
    resetDiagnosticsStoreForTests()

    expect(() => diagnosticsLogPath()).toThrow(/configureDiagnosticsStore/)
  })
})
