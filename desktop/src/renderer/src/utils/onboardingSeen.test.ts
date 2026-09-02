// Pins for the first-launch "seen onboarding" flag (prototype, debt #93).
//
// The rule the brief fixes: the onboarding overlay fires the FIRST time a user
// opens StrixGeo, gated on a persisted flag, and never again once dismissed —
// but stays re-openable from the Help menu. This flag is per-device UI chrome,
// so it lives in localStorage (project_decisions_in_bundle.md: localStorage =
// per-user UI chrome only), NOT in the .strix bundle.

import { afterEach, describe, expect, it } from 'vitest'

import {
  ONBOARDING_SEEN_KEY,
  hasSeenOnboarding,
  markOnboardingSeen,
  shouldAutoOpenOnboarding,
} from './onboardingSeen'

afterEach(() => {
  localStorage.clear()
})

describe('onboardingSeen', () => {
  it('a fresh install has NOT seen onboarding', () => {
    expect(hasSeenOnboarding()).toBe(false)
  })

  it('marking it seen persists across reads (survives a "relaunch")', () => {
    markOnboardingSeen()
    expect(hasSeenOnboarding()).toBe(true)
    // A fresh read of the same key — the next launch's first question.
    expect(localStorage.getItem(ONBOARDING_SEEN_KEY)).not.toBeNull()
  })

  it('never throws when localStorage is unavailable', () => {
    // A broken storage must degrade to "not seen" (show onboarding), never crash
    // the boot path.
    const original = globalThis.localStorage
    // Deliberately remove storage for this case (cast makes the delete legal).
    delete (globalThis as { localStorage?: Storage }).localStorage
    try {
      expect(() => hasSeenOnboarding()).not.toThrow()
      expect(hasSeenOnboarding()).toBe(false)
      expect(() => markOnboardingSeen()).not.toThrow()
    } finally {
      ;(globalThis as { localStorage?: Storage }).localStorage = original
    }
  })
})

// The rule the BLOCKER fixes (senior review): the first-launch overlay must NOT
// auto-open under the e2e flag. The harness's userData dir persists across the
// run and nothing seeds the "seen" flag, so an ungated auto-open would raise the
// z-max onboarding modal over ~130 specs and fail them on an intercepted click.
describe('shouldAutoOpenOnboarding', () => {
  it('auto-opens on a fresh install (not seen, not e2e)', () => {
    expect(shouldAutoOpenOnboarding({ seen: false, e2e: false })).toBe(true)
  })

  it('does NOT auto-open under the e2e flag, even on a fresh install', () => {
    expect(shouldAutoOpenOnboarding({ seen: false, e2e: true })).toBe(false)
  })

  it('does NOT auto-open once the overlay has been seen', () => {
    expect(shouldAutoOpenOnboarding({ seen: true, e2e: false })).toBe(false)
  })
})
