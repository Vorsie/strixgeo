// The review-flag sentence is the only place a token becomes something an engineer
// can act on, and a missing case degrades SILENTLY: an unmapped token falls through
// to "This tie needs checking", which is true of every flag and tells them nothing.
// So each token is pinned, and the fallback is pinned as a fallback rather than as
// an answer.

import { describe, expect, it } from 'vitest'

import { reviewFlagLabel } from './edgeReviewFlag'

describe('reviewFlagLabel', () => {
  it('ERF1 — class_changed says the class moved under the tie', () => {
    expect(reviewFlagLabel('class_changed')).toContain('packing class')
  })

  it('ERF2 — ambiguous_band says the re-anchor had to choose', () => {
    expect(reviewFlagLabel('ambiguous_band')).toContain('Several bands')
  })

  it('ERF3 — band_absorbed says the band the tie was drawn on is gone', () => {
    // The two questions are different: ambiguous means several bands were candidates,
    // absorbed means the anchor no longer exists as its own row. The owner chose this
    // wording over reusing ambiguous_band for both.
    expect(reviewFlagLabel('band_absorbed')).toContain('absorbed')
    expect(reviewFlagLabel('band_absorbed')).not.toEqual(reviewFlagLabel('ambiguous_band'))
  })

  it('ERF5 — frame_mismatch says the litho model will not band these', () => {
    // Owner order 2026-08-21, after deleting a silt↔clay tie that rendered as
    // an onlap: "flag a tie like that when it doesn't conform to the litho
    // model!" The badge has to say WHY, or it reads like the re-anchor flags.
    expect(reviewFlagLabel('frame_mismatch')).toContain('litho')
  })

  it('ERF4 — every token has its own sentence, and none of them is the fallback', () => {
    const fallback = reviewFlagLabel(null)
    const sentences = ['class_changed', 'ambiguous_band', 'band_absorbed', 'frame_mismatch'].map(
      reviewFlagLabel,
    )
    expect(new Set(sentences).size).toBe(sentences.length)
    for (const sentence of sentences) expect(sentence).not.toEqual(fallback)
  })
})
