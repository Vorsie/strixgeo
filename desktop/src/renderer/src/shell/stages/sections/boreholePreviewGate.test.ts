/**
 * Behaviour tests for the borehole preview-ghost gate, in the owner's words
 * (dogfeed 2026-08-06): "the boreholes get subdivided when i click subdivide
 * cpt's — this is counterintuitive". Ghosts must WAIT until the tie work is
 * done — they appear only when step 4 is genuinely ready, so the plan they
 * show is the final tie-informed one, never a stale flank-only guess.
 */

import { describe, expect, it } from 'vitest'

import { shouldShowBoreholePreview } from './boreholePreviewGate'

describe('shouldShowBoreholePreview', () => {
  it('right after step 1 (no ties at all) the boreholes stay visibly empty', () => {
    expect(
      shouldShowBoreholePreview({ pending: 0, accepted: 0, flagged: 0, loaded: true }),
    ).toBe(false)
  })

  it('while ties are still pending the preview stays hidden — the plan would change', () => {
    expect(
      shouldShowBoreholePreview({ pending: 3, accepted: 10, flagged: 0, loaded: true }),
    ).toBe(false)
  })

  it('ties exist and all are accepted → the preview appears (step 4 is ready)', () => {
    expect(
      shouldShowBoreholePreview({ pending: 0, accepted: 12, flagged: 0, loaded: true }),
    ).toBe(true)
  })

  it('flagged ties are accepted work awaiting confirmation — they do not hide the preview', () => {
    expect(
      shouldShowBoreholePreview({ pending: 0, accepted: 12, flagged: 2, loaded: true }),
    ).toBe(true)
  })

  it('unknown tie state (fetch failed / not asked) shows nothing — never guess', () => {
    expect(
      shouldShowBoreholePreview({ pending: 0, accepted: 0, flagged: 0, loaded: false }),
    ).toBe(false)
  })
})
