/**
 * Consent to TRANSMIT diagnostics — default off, and fails closed.
 *
 * Capturing to a local file needs no consent (it is the user's own log, like
 * ``backend.log``). Sending anything anywhere does, and the answer to "may we
 * send this?" must be a deliberate, recorded yes. Every damaged-file case below
 * therefore reads as NO.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  consentFilePath,
  readConsentRecord,
  readTransmissionConsent,
  setTransmissionConsent,
} from './diagnosticsConsent'
import {
  configureDiagnosticsStore,
  diagnosticsDirPath,
  resetDiagnosticsStoreForTests,
} from './diagnosticsStore'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'strix-consent-'))
  configureDiagnosticsStore({ userDataDir: dir, appVersion: '0.1.0', platform: 'win32' })
})

afterEach(() => {
  resetDiagnosticsStoreForTests()
  rmSync(dir, { recursive: true, force: true })
})

describe('the default answer is no', () => {
  it('CN1 — a user who was never asked has not consented', () => {
    expect(readTransmissionConsent()).toBe(false)
    expect(readConsentRecord()).toBeNull()
  })

  it('CN2 — saying yes is remembered', () => {
    setTransmissionConsent(true, '2026-08-26T12:00:00.000Z')

    expect(readTransmissionConsent()).toBe(true)
    expect(readConsentRecord()?.decidedAt).toBe('2026-08-26T12:00:00.000Z')
  })

  it('CN3 — changing the answer back to no is remembered too', () => {
    setTransmissionConsent(true)
    setTransmissionConsent(false)

    expect(readTransmissionConsent()).toBe(false)
  })
})

describe('a damaged consent file is not a yes', () => {
  // These cases hand-write the file the way a curious user would, so the
  // directory has to be there first — the app creates it on the first write.
  beforeEach(() => {
    mkdirSync(diagnosticsDirPath(), { recursive: true })
  })

  it('CN4 — unparseable JSON reads as no', () => {
    writeFileSync(consentFilePath(), '{ not json', 'utf-8')

    expect(readTransmissionConsent()).toBe(false)
  })

  it('CN5 — a flag that is not a real boolean reads as no', () => {
    writeFileSync(
      consentFilePath(),
      JSON.stringify({
        kind: 'strixgeo.diagnostics-consent',
        format_version: 1,
        transmissionOptIn: 'true',
      }),
      'utf-8',
    )

    expect(readTransmissionConsent()).toBe(false)
  })

  it('CN6 — a file from another app reads as no', () => {
    writeFileSync(
      consentFilePath(),
      JSON.stringify({ kind: 'other.app', transmissionOptIn: true }),
      'utf-8',
    )

    expect(readTransmissionConsent()).toBe(false)
  })
})
