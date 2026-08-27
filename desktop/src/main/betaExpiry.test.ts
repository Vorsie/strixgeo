/**
 * Beta-expiry rules, phrased in the owner's own words.
 *
 * The rule being pinned (owner, 2026-08-26 ballot): *"waterproof: beta builds
 * must expire; a beta licence must not be usable for years"*. Every case below
 * is a sentence from that rule, not a restatement of the implementation.
 */

import { describe, expect, it } from 'vitest'

import {
  CLOCK_SKEW_TOLERANCE_MS,
  EXPIRY_WARNING_WINDOW_MS,
  advanceAnchor,
  evaluateBetaExpiry,
  type BetaBuildStamp,
  type ClockAnchor,
} from './betaExpiry'

const DAY_MS = 24 * 60 * 60 * 1000

/** A build made on day 0 that stops working on day 30. */
const STAMP: BetaBuildStamp = {
  buildId: '2026.08.26-beta',
  builtAtMs: Date.UTC(2026, 7, 26),
  expiresAtMs: Date.UTC(2026, 7, 26) + 30 * DAY_MS,
}

function anchorAt(lastSeenMs: number): ClockAnchor {
  return { firstSeenMs: STAMP.builtAtMs, lastSeenMs }
}

describe('a beta build stops working on its expiry date', () => {
  it('BE1 — past the expiry date the build refuses to open', () => {
    const verdict = evaluateBetaExpiry(STAMP, null, STAMP.expiresAtMs + 1)

    expect(verdict.blocked).toBe(true)
    expect(verdict.state).toBe('expired')
  })

  it('BE2 — before the expiry date the build opens normally', () => {
    const verdict = evaluateBetaExpiry(STAMP, null, STAMP.builtAtMs + DAY_MS)

    expect(verdict.blocked).toBe(false)
    expect(verdict.state).toBe('active')
    expect(verdict.daysRemaining).toBe(29)
  })

  it('BE3 — the last day still opens; the day after does not', () => {
    const lastMoment = evaluateBetaExpiry(STAMP, null, STAMP.expiresAtMs - 1)
    const firstMomentAfter = evaluateBetaExpiry(STAMP, null, STAMP.expiresAtMs)

    expect(lastMoment.blocked).toBe(false)
    expect(firstMomentAfter.blocked).toBe(true)
  })

  it('BE4 — inside the final week the build opens but says how long is left', () => {
    const threeDaysLeft = STAMP.expiresAtMs - 3 * DAY_MS
    const verdict = evaluateBetaExpiry(STAMP, anchorAt(threeDaysLeft - DAY_MS), threeDaysLeft)

    expect(verdict.blocked).toBe(false)
    expect(verdict.state).toBe('warning')
    expect(verdict.daysRemaining).toBe(3)
    expect(EXPIRY_WARNING_WINDOW_MS).toBeGreaterThan(0)
  })
})

describe('winding the clock back does not buy more beta', () => {
  it('BE5 — once the app has run past the expiry, an earlier clock stays blocked', () => {
    // The tester ran the build after it expired, then set the machine clock
    // back a month to keep using it.
    const anchor = anchorAt(STAMP.expiresAtMs + DAY_MS)

    const verdict = evaluateBetaExpiry(STAMP, anchor, STAMP.builtAtMs + DAY_MS)

    expect(verdict.blocked).toBe(true)
    expect(verdict.state).toBe('clock-rollback')
  })

  it('BE6 — a clock set before the build existed is refused', () => {
    // No honest machine can run a build a year before it was compiled.
    const verdict = evaluateBetaExpiry(STAMP, null, STAMP.builtAtMs - 365 * DAY_MS)

    expect(verdict.blocked).toBe(true)
    expect(verdict.state).toBe('clock-rollback')
  })

  it('BE7 — a rollback of days is refused even while the build is still young', () => {
    const anchor = anchorAt(STAMP.builtAtMs + 10 * DAY_MS)

    const verdict = evaluateBetaExpiry(STAMP, anchor, STAMP.builtAtMs + 2 * DAY_MS)

    expect(verdict.blocked).toBe(true)
    expect(verdict.state).toBe('clock-rollback')
  })

  it('BE8 — evidence of activity from elsewhere counts as a seen-at timestamp', () => {
    // The anchor file was deleted, but the recent-projects list still records
    // the tester opening a project after the build expired.
    const corroborating = [STAMP.expiresAtMs + 2 * DAY_MS]

    const verdict = evaluateBetaExpiry(STAMP, null, STAMP.builtAtMs + DAY_MS, corroborating)

    expect(verdict.blocked).toBe(true)
    expect(verdict.state).toBe('clock-rollback')
  })

  it('BE9 — an NTP correction of a few minutes is not tampering', () => {
    const anchor = anchorAt(STAMP.builtAtMs + 10 * DAY_MS)
    const nudgedBack = STAMP.builtAtMs + 10 * DAY_MS - (CLOCK_SKEW_TOLERANCE_MS - 1)

    const verdict = evaluateBetaExpiry(STAMP, anchor, nudgedBack)

    expect(verdict.blocked).toBe(false)
    expect(verdict.state).toBe('active')
  })
})

describe('a missing or damaged anchor never changes the answer in the tester’s favour', () => {
  it('BE10 — no anchor on a fresh install does not block a live build', () => {
    const verdict = evaluateBetaExpiry(STAMP, null, STAMP.builtAtMs + DAY_MS)

    expect(verdict.blocked).toBe(false)
  })

  it('BE11 — no anchor does not rescue a build that is genuinely past its date', () => {
    const verdict = evaluateBetaExpiry(STAMP, null, STAMP.expiresAtMs + 10 * DAY_MS)

    expect(verdict.blocked).toBe(true)
    expect(verdict.state).toBe('expired')
  })
})

describe('an unstamped build is not a beta build', () => {
  it('BE12 — a build with no expiry stamp never blocks', () => {
    // ``npm run dev`` and any build packaged without the stamp env var.
    const verdict = evaluateBetaExpiry(null, null, Date.now())

    expect(verdict.blocked).toBe(false)
    expect(verdict.state).toBe('unstamped')
    expect(verdict.daysRemaining).toBeNull()
  })

  it('BE13 — an unstamped build ignores an anchor from a stamped one', () => {
    const verdict = evaluateBetaExpiry(null, anchorAt(STAMP.expiresAtMs + DAY_MS), Date.now())

    expect(verdict.blocked).toBe(false)
  })
})

describe('the anchor only ever moves forward', () => {
  it('BE14 — a later launch advances the last-seen timestamp', () => {
    const anchor = anchorAt(STAMP.builtAtMs + DAY_MS)

    const next = advanceAnchor(anchor, STAMP.builtAtMs + 5 * DAY_MS)

    expect(next.lastSeenMs).toBe(STAMP.builtAtMs + 5 * DAY_MS)
    expect(next.firstSeenMs).toBe(anchor.firstSeenMs)
  })

  it('BE15 — a launch on a backdated clock does not rewind the last-seen timestamp', () => {
    const anchor = anchorAt(STAMP.builtAtMs + 5 * DAY_MS)

    const next = advanceAnchor(anchor, STAMP.builtAtMs + DAY_MS)

    expect(next.lastSeenMs).toBe(STAMP.builtAtMs + 5 * DAY_MS)
  })

  it('BE16 — the first launch seeds both timestamps from the same instant', () => {
    const next = advanceAnchor(null, STAMP.builtAtMs + DAY_MS)

    expect(next.firstSeenMs).toBe(STAMP.builtAtMs + DAY_MS)
    expect(next.lastSeenMs).toBe(STAMP.builtAtMs + DAY_MS)
  })
})
