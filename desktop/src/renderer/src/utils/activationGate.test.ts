// Behavioural pins for the packaged activation START-SCREEN gate (owner ruling A,
// CLAUDE.local.md dictated note: "a startscreen with beta key input before the
// actual app opens"). This is the pure decision the App render consults BEFORE it
// shows the workspace.
//
// Rules pinned here (the verdict half — unactivated/expired/clock-rollback →
// blocked — is pinned in activation.test.ts):
//  * dev + the e2e harness NEVER block (dogfeed + smoke suite untouched);
//  * a BETA build NEVER blocks on activation — it runs on its STAMP (audit C3(a));
//  * a packaged non-beta build FAILS CLOSED — a status read failure = the licence
//    screen, never an open workspace (coordinator addition);
//  * otherwise the blocked verdict decides.

import { describe, expect, it } from 'vitest'

import { activationGateDecision, isBetaBuild } from './activationGate'

const BASE = { packaged: true, e2e: false, statusReadFailed: false, blocked: false }

describe('activationGateDecision', () => {
  it('a packaged non-beta build with a blocked verdict shows the start screen', () => {
    expect(activationGateDecision({ ...BASE, blocked: true })).toBe('block')
  })

  it('a packaged build with an active/grace verdict passes straight through', () => {
    expect(activationGateDecision({ ...BASE, blocked: false })).toBe('pass')
  })

  // Owner: keep the DEV app non-blocking so the dogfeed is untouched.
  it('a dev build never blocks, even on a blocked verdict', () => {
    expect(activationGateDecision({ ...BASE, packaged: false, blocked: true })).toBe('pass')
  })

  it('the e2e flag never blocks, even in a packaged build with a blocked verdict', () => {
    expect(activationGateDecision({ ...BASE, e2e: true, blocked: true })).toBe('pass')
  })

  // Owner 2026-09-03, "require Beta-key before API": the beta stamp bounds the
  // build's life (main-process expiry gate); it no longer stands in for a licence.
  it('a beta build with a blocked verdict shows the start screen — the key comes before the app (owner 2026-09-03)', () => {
    expect(activationGateDecision({ packaged: true, e2e: false, statusReadFailed: false, blocked: true })).toBe('block')
  })

  it('a packaged non-beta build fails closed when the status read failed', () => {
    expect(activationGateDecision({ ...BASE, statusReadFailed: true, blocked: false })).toBe('block')
  })

  it('a beta build fails closed like any packaged build when the status read failed', () => {
    expect(activationGateDecision({ packaged: true, e2e: false, statusReadFailed: true, blocked: false })).toBe('block')
  })
})

describe('isBetaBuild', () => {
  it('a stamped build (active/warning) is a beta build', () => {
    expect(isBetaBuild({ state: 'active', blocked: false, daysRemaining: 12, expiresAtMs: 1 })).toBe(true)
    expect(isBetaBuild({ state: 'warning', blocked: false, daysRemaining: 3, expiresAtMs: 1 })).toBe(true)
  })

  it('an unstamped build is NOT a beta build', () => {
    expect(isBetaBuild({ state: 'unstamped', blocked: false, daysRemaining: null, expiresAtMs: null })).toBe(false)
  })

  it('null / a non-object is not a beta build', () => {
    expect(isBetaBuild(null)).toBe(false)
    expect(isBetaBuild(undefined)).toBe(false)
    expect(isBetaBuild('active')).toBe(false)
  })
})
