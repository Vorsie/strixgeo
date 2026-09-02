// Behavioural pins for the packaged activation START-SCREEN gate (owner ruling A,
// CLAUDE.local.md dictated note: "a startscreen with beta key input before the
// actual app opens"). This is the pure decision the App render consults BEFORE it
// shows the workspace: a blocked verdict in a real (packaged) build stops at the
// licence screen; dev and the e2e harness are NEVER blocked so the owner's
// dogfeed and the smoke suite are untouched.
//
// The verdict half (unactivated / expired / clock-rollback → blocked) is pinned
// in activation.test.ts; this file pins only the dev/e2e overrides on top of it.

import { describe, expect, it } from 'vitest'

import { activationGateDecision } from './activationGate'

describe('activationGateDecision', () => {
  it('a packaged build with a blocked verdict shows the start screen', () => {
    expect(activationGateDecision({ blocked: true, packaged: true, e2e: false })).toBe('block')
  })

  it('a packaged build with an active/grace verdict passes straight through', () => {
    expect(activationGateDecision({ blocked: false, packaged: true, e2e: false })).toBe('pass')
  })

  // Owner: "Keep the existing non-blocking behaviour for the DEV app so the
  // owner's dogfeed is untouched." A dev build NEVER blocks, even when unactivated.
  it('a dev build never blocks, even on a blocked verdict', () => {
    expect(activationGateDecision({ blocked: true, packaged: false, e2e: false })).toBe('pass')
  })

  // The e2e harness sets STRIX_E2E; the gate must not brick ~130 specs.
  it('the e2e flag never blocks, even in a packaged build with a blocked verdict', () => {
    expect(activationGateDecision({ blocked: true, packaged: true, e2e: true })).toBe('pass')
  })
})
