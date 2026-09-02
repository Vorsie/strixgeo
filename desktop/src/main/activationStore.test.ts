// A hand-edited or foreign activation.json must not be trusted (senior review
// SHOULD-FIX 2). The local file is plain, UNSIGNED JSON in a directory the user
// owns (the Ed25519 signature is the production TODO), so the shape check is the
// only thing standing between a text editor and a forged licence. These cases
// pin that a licence whose fields are the wrong TYPE or an out-of-set tier is
// rejected — read back as "no licence" — rather than silently trusted.
//
// The store does fs but imports no Electron, so vitest exercises it directly
// (same posture as betaExpiryStore.test.ts).

import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  ACTIVATION_KIND,
  activationStatePath,
  configureActivationStore,
  readActivationState,
  resetActivationStoreForTests,
} from './activationStore'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'strix-activation-'))
  configureActivationStore({ userDataDir: dir })
})

afterEach(() => {
  resetActivationStoreForTests()
  rmSync(dir, { recursive: true, force: true })
})

/** A well-formed licence, one field overridable so a case can spoil exactly one. */
function licence(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: 'STRIX-SOLO-DEMO',
    tier: 'solo',
    isTrial: false,
    deviceId: 'device-1',
    deviceLabel: 'Test workstation',
    issuedAtMs: 1_700_000_000_000,
    expiresAtMs: 1_800_000_000_000,
    graceWindowMs: 30 * 24 * 60 * 60 * 1000,
    ...overrides,
  }
}

/** Write a full activation envelope carrying the given licence object. */
function writeEnvelope(licenceValue: unknown): void {
  writeFileSync(
    activationStatePath(),
    JSON.stringify({
      kind: ACTIVATION_KIND,
      format_version: 1,
      deviceId: 'device-1',
      licence: licenceValue,
      anchor: null,
    }),
    'utf-8',
  )
}

describe('a persisted activation licence is trusted only when its shape is sound', () => {
  it('a well-formed licence round-trips', () => {
    writeEnvelope(licence())

    expect(readActivationState().licence?.tier).toBe('solo')
  })

  // The headline case from the review: a text editor changing the tier to an
  // unknown value must not mint a "gold" seat.
  it('a hand-edited tier outside the known set is rejected', () => {
    writeEnvelope(licence({ tier: 'gold' }))

    expect(readActivationState().licence).toBeNull()
  })

  it('a non-boolean isTrial is rejected', () => {
    writeEnvelope(licence({ isTrial: 'yes' }))

    expect(readActivationState().licence).toBeNull()
  })

  it('a missing / non-string deviceLabel is rejected', () => {
    writeEnvelope(licence({ deviceLabel: 42 }))

    expect(readActivationState().licence).toBeNull()
  })

  it('an unusable issuedAtMs is rejected', () => {
    writeEnvelope(licence({ issuedAtMs: 'soon' }))

    expect(readActivationState().licence).toBeNull()
  })

  it('every valid tier is accepted', () => {
    for (const tier of ['solo', 'pro', 'studio'] as const) {
      writeEnvelope(licence({ tier }))
      expect(readActivationState().licence?.tier).toBe(tier)
    }
  })
})
