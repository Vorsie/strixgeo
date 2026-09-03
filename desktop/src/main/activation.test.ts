// Behavioural pins for the pure activation evaluator (prototype, debt #3).
//
// Each case paraphrases an owner ruling (CLAUDE.local.md → "Rulings 2026-08-31"
// items 14-16) in the ruling's OWN words, not the implementation's:
//
//  * item 14 — "Offline grace window = 30 days."  A licence a few days past its
//    authoritative end still opens; one past end + 30 days does not.
//  * item 16 — "Trial = a server-issued trial licence, same code path as a paid
//    activation, just time-limited."  A trial licence in date reads as a live
//    trial, never as an unlicensed build.
//  * item 15 — "1 device per Solo seat."  The audit's C3(c): a licence carries the
//    device it was activated on; copied to another machine (a different store
//    device id) it must be blocked with a clear `device_mismatch` reason, so a
//    copied activation.json does not run everywhere.
//  * the beta-expiry monotonic anchor (docs/design/beta-expiry.md) is reused for
//    rollback defence: a clock wound behind the highest instant we ever saw is
//    distrusted before any date arithmetic.
//
// The evaluator is PURE — every input is an argument — so vitest exercises every
// branch with no Electron import (vitest.config.ts includes src/main/**).

import { describe, expect, it } from 'vitest'

import {
  activationBlocksLaunch,
  DEFAULT_OFFLINE_GRACE_WINDOW_MS,
  evaluateActivation,
  type Licence,
} from './activation'

const DAY_MS = 24 * 60 * 60 * 1000

/** The store device id these licences are bound to (matches, unless overridden). */
const THIS_DEVICE = 'device-1'

/** A paid Solo licence issued `issuedDaysAgo` days ago, valid for one year. */
function paidLicence(nowMs: number, overrides: Partial<Licence> = {}): Licence {
  return {
    key: 'STRIX-SOLO-TEST',
    tier: 'solo',
    isTrial: false,
    deviceId: THIS_DEVICE,
    deviceLabel: 'Test workstation',
    issuedAtMs: nowMs - 30 * DAY_MS,
    expiresAtMs: nowMs + 335 * DAY_MS,
    graceWindowMs: DEFAULT_OFFLINE_GRACE_WINDOW_MS,
    ...overrides,
  }
}

describe('evaluateActivation', () => {
  const now = Date.parse('2026-09-01T12:00:00.000Z')

  it('an in-date paid licence is active and not blocked', () => {
    const verdict = evaluateActivation(paidLicence(now), THIS_DEVICE, now, now)
    expect(verdict.state).toBe('active')
    expect(verdict.blocked).toBe(false)
    expect(verdict.tier).toBe('solo')
    expect(verdict.daysRemaining).toBe(335)
  })

  // item 16 — a trial IS a licence, on the same code path, just time-limited.
  it('an in-date trial licence reads as a live trial, not as unlicensed', () => {
    const licence = paidLicence(now, {
      isTrial: true,
      expiresAtMs: now + 30 * DAY_MS,
    })
    const verdict = evaluateActivation(licence, THIS_DEVICE, now, now)
    expect(verdict.state).toBe('trial')
    expect(verdict.isTrial).toBe(true)
    expect(verdict.blocked).toBe(false)
    expect(verdict.daysRemaining).toBe(30)
  })

  it('no licence at all is unactivated and blocked', () => {
    const verdict = evaluateActivation(null, THIS_DEVICE, now, now)
    expect(verdict.state).toBe('unactivated')
    expect(verdict.blocked).toBe(true)
    expect(verdict.tier).toBeNull()
  })

  // item 15 / audit C3(c) — a licence activated on device A is blocked on device
  // B, so a copied activation.json does not run on any machine.
  it('a licence carrying a different device id than this machine is blocked (device_mismatch)', () => {
    // A perfectly in-date paid licence — the ONLY thing wrong is the machine.
    const copied = paidLicence(now, { deviceId: 'device-A' })
    const verdict = evaluateActivation(copied, 'device-B', now, now)
    expect(verdict.state).toBe('device-mismatch')
    expect(verdict.blocked).toBe(true)
    // The reason names the machine-readable code so a support line can read it.
    expect(verdict.reason).toContain('device_mismatch')
  })

  it('the same device id passes the device check (the normal case)', () => {
    const verdict = evaluateActivation(paidLicence(now, { deviceId: 'device-A' }), 'device-A', now, now)
    expect(verdict.state).toBe('active')
    expect(verdict.blocked).toBe(false)
  })

  // item 14 — "Offline grace window = 30 days."
  it('a licence 5 days past its end still opens, inside the 30-day grace', () => {
    const licence = paidLicence(now, { expiresAtMs: now - 5 * DAY_MS })
    const verdict = evaluateActivation(licence, THIS_DEVICE, now, now)
    expect(verdict.state).toBe('grace')
    expect(verdict.blocked).toBe(false)
    // 30-day window opened 5 days ago → about 25 left, rounded up.
    expect(verdict.graceDaysRemaining).toBe(25)
  })

  it('a licence past its end AND past the 30-day grace is expired and blocked', () => {
    const licence = paidLicence(now, { expiresAtMs: now - 31 * DAY_MS })
    const verdict = evaluateActivation(licence, THIS_DEVICE, now, now)
    expect(verdict.state).toBe('expired')
    expect(verdict.blocked).toBe(true)
  })

  // The exact 30-day boundary (senior review): grace runs to expiresAtMs + the
  // 30-day window, EXCLUSIVE. A moment before the window closes still opens; the
  // instant it closes (and after) is expired.
  it('one second before the 30-day grace closes still opens', () => {
    // graceEnds = expiresAtMs + 30 days; put it 1 s in the future.
    const licence = paidLicence(now, { expiresAtMs: now - 30 * DAY_MS + 1000 })
    const verdict = evaluateActivation(licence, THIS_DEVICE, now, now)
    expect(verdict.state).toBe('grace')
    expect(verdict.blocked).toBe(false)
  })

  it('the instant the 30-day grace closes is expired and blocked', () => {
    // graceEnds = expiresAtMs + 30 days === now exactly.
    const licence = paidLicence(now, { expiresAtMs: now - 30 * DAY_MS })
    const verdict = evaluateActivation(licence, THIS_DEVICE, now, now)
    expect(verdict.state).toBe('expired')
    expect(verdict.blocked).toBe(true)
  })

  // Monotonic anchor: the clock is wound behind the highest instant ever seen.
  it('a clock wound behind the installation high-water mark is distrusted', () => {
    const licence = paidLicence(now)
    // The app has observed a moment 10 days in the "future" relative to now.
    const highWater = now + 10 * DAY_MS
    const verdict = evaluateActivation(licence, THIS_DEVICE, highWater, now)
    expect(verdict.state).toBe('clock-rollback')
    expect(verdict.blocked).toBe(true)
  })

  it('a small clock skew under tolerance is not called a rollback', () => {
    const licence = paidLicence(now)
    // Five minutes behind — an NTP step, not tampering.
    const highWater = now + 5 * 60 * 1000
    const verdict = evaluateActivation(licence, THIS_DEVICE, highWater, now)
    expect(verdict.state).toBe('active')
    expect(verdict.blocked).toBe(false)
  })
})

// The main-side launch gate (audit C3(d)): whether a PACKAGED build should refuse
// to open before the backend is even spawned. The rule the owner's beta ruling
// implies, in its own words — "a beta build runs on its stamp; a non-beta packaged
// build with no issuer cannot activate":
//
//  * dev NEVER blocks (the owner's daily dogfeed is untouched);
//  * the e2e harness NEVER blocks;
//  * a BETA build (a beta stamp is present) NEVER blocks on activation — the beta
//    stamp is its authority, enforced by the separate beta-expiry gate;
//  * only a non-beta, packaged, non-e2e build with a blocked verdict is stopped.
describe('activationBlocksLaunch', () => {
  const blocked = { blocked: true }
  const open = { blocked: false }

  it('a dev build never blocks, even on a blocked verdict', () => {
    expect(
      activationBlocksLaunch({ packaged: false, e2e: false, verdict: blocked }),
    ).toBe(false)
  })

  it('the e2e harness never blocks, even packaged with a blocked verdict', () => {
    expect(
      activationBlocksLaunch({ packaged: true, e2e: true, verdict: blocked }),
    ).toBe(false)
  })

  it('a beta build with a blocked verdict is stopped — the key comes before the engine (owner 2026-09-03)', () => {
    // "require Beta-key before API": the stamp still bounds the build's life
    // (the beta-expiry gate runs first), but it no longer stands in for a
    // licence. A tester who has not entered a key never reaches the workspace.
    expect(activationBlocksLaunch({ packaged: true, e2e: false, verdict: blocked })).toBe(true)
  })

  it('a non-beta packaged build with a blocked verdict is stopped', () => {
    expect(
      activationBlocksLaunch({ packaged: true, e2e: false, verdict: blocked }),
    ).toBe(true)
  })

  it('a non-beta packaged build with an active/grace verdict opens', () => {
    expect(
      activationBlocksLaunch({ packaged: true, e2e: false, verdict: open }),
    ).toBe(false)
  })
})
