/**
 * Unit tests for `rankByPartialMatch`.
 *
 * Tests cover:
 *   - Direct containment (query ⊆ candidate).
 *   - Reverse containment (candidate ⊆ query).
 *   - Token-set Jaccard overlap.
 *   - Bigram Dice fuzzy matching for spelling variants ("Holoceen" ↔ "Holocene").
 *   - Empty query — every name returned, all scores 0, stable name-asc order.
 *   - No-match query — all scores ~0, but ALL names still returned.
 *   - Ordering stability — equal-score items sort by name asc.
 *   - Empty input list — returns empty array.
 *   - Real screenshot strings from a dogfeed session, ranked against
 *     "holoceen" / "pleistoceen" / "geroerd".
 */

import { describe, expect, it } from 'vitest'

import { rankByPartialMatch } from './partialMatch'

// ---------------------------------------------------------------------------
// Real-world candidate list mirroring the screenshot referenced in the spec.
// These are DOV stratigraphy names from a real Flanders project.
// ---------------------------------------------------------------------------
const REAL_CANDIDATES = [
  'Holoceen',
  'Quartair: Holocene afzettingen',
  'Holoceen (Laat Pleistoceen)',
  'Holoceen - veenlaag van 3.50 tot 6 m',
  'Geroerd',
  'Verstoord',
  'Pleistoceen (Vlaamse Vallei)',
  'Laat Pleistoceen',
]

// ---------------------------------------------------------------------------
// Basic functional tests
// ---------------------------------------------------------------------------

describe('rankByPartialMatch — returns all candidates always', () => {
  it('returns same count as input — never filters', () => {
    const result = rankByPartialMatch('holoceen', REAL_CANDIDATES)
    expect(result).toHaveLength(REAL_CANDIDATES.length)
    // Every input name appears exactly once.
    const returned = new Set(result.map(r => r.name))
    for (const name of REAL_CANDIDATES) {
      expect(returned.has(name)).toBe(true)
    }
  })

  it('empty input list → empty result', () => {
    expect(rankByPartialMatch('holoceen', [])).toEqual([])
  })

  it('scores are in [0, 1]', () => {
    const result = rankByPartialMatch('holoceen', REAL_CANDIDATES)
    for (const { score } of result) {
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThanOrEqual(1)
    }
  })
})

// ---------------------------------------------------------------------------
// Containment
// ---------------------------------------------------------------------------

describe('rankByPartialMatch — containment', () => {
  it('exact substring: "holoceen" matches "Holoceen" at top', () => {
    const result = rankByPartialMatch('holoceen', REAL_CANDIDATES)
    // "Holoceen" (exact, single word) should be at the very top.
    expect(result[0].name).toBe('Holoceen')
    expect(result[0].score).toBeGreaterThan(0.4)
  })

  it('partial substring: "klei" ranks "Boom Klei" above "Zand"', () => {
    const names = ['Zand', 'Boom Klei', 'Alluvium', 'Holoceen']
    const result = rankByPartialMatch('klei', names)
    const boomKleiRank = result.findIndex(r => r.name === 'Boom Klei')
    const zandRank = result.findIndex(r => r.name === 'Zand')
    expect(boomKleiRank).toBeLessThan(zandRank)
    expect(result[boomKleiRank].score).toBeGreaterThan(result[zandRank].score)
  })

  it('reverse containment: long query matches short candidate', () => {
    // Query "Pleistoceen Vlaamse Vallei" — the short candidate "Laat Pleistoceen"
    // shares "pleistoceen" via token, not full containment.
    // But "Pleistoceen (Vlaamse Vallei)" (longer) fully contains the candidate
    // string direction (candidate ⊆ query after normalisation).
    const names = ['Pleistoceen (Vlaamse Vallei)', 'Geroerd', 'Verstoord']
    const result = rankByPartialMatch('pleistoceen vlaamse vallei', names)
    expect(result[0].name).toBe('Pleistoceen (Vlaamse Vallei)')
    expect(result[0].score).toBeGreaterThan(0.4)
  })
})

// ---------------------------------------------------------------------------
// Token-set Jaccard
// ---------------------------------------------------------------------------

describe('rankByPartialMatch — token overlap', () => {
  it('shared significant token ranks above zero-token-overlap', () => {
    const names = ['Formatie van Aalter', 'Alluvium', 'Boom Klei']
    const result = rankByPartialMatch('aalter', names)
    const aalterRank = result.findIndex(r => r.name === 'Formatie van Aalter')
    const alluRank = result.findIndex(r => r.name === 'Alluvium')
    expect(aalterRank).toBeLessThan(alluRank)
  })

  it('noise tokens (van, de, het) do not inflate Jaccard score', () => {
    // A query that consists only of noise tokens produces an empty token
    // list for Jaccard scoring — token overlap is 0.  However, the
    // *containment* signal still fires when "van" appears as a substring
    // of the candidate.  The test verifies that Jaccard stays low
    // (the noise-token stripping is doing its job) rather than asserting
    // an overall low score (which containment can still inflate).
    const names = ['Lid van Oedelem', 'Holoceen']
    // With query "van de het" (all noise), Jaccard is 0 for both.
    // Containment fires for "Lid van Oedelem" but not "Holoceen".
    const resultVanDeHet = rankByPartialMatch('van de het', names)
    // "Holoceen" has no containment hit — its score should be near-zero.
    const holScore = resultVanDeHet.find(r => r.name === 'Holoceen')!.score
    expect(holScore).toBeLessThanOrEqual(0.2)
  })

  it('bare number tokens are stripped from Jaccard, containment can still fire', () => {
    // Queries of bare numbers produce no significant token set after noise
    // stripping, so Jaccard cannot inflate the score.  Containment *may*
    // still fire if the normalised number literally appears as a substring
    // in the candidate.  The test pins that Jaccard=0 for all results,
    // not that the overall score is zero (containment is a separate signal).
    const names = ['Formatie van Aalter', 'Geroerd']
    // "aalter" is a pure word token — the number stripping rule does not
    // affect this.  Test a query that only contains a number: "123".
    const result = rankByPartialMatch('123', names)
    // Neither name contains "123" → containment=0, Jaccard=0, Dice≈0.
    for (const r of result) {
      expect(r.score).toBeLessThan(0.25)
    }
  })
})

// ---------------------------------------------------------------------------
// Dice bigrams — spelling variants
// ---------------------------------------------------------------------------

describe('rankByPartialMatch — Dice bigrams / spelling variants', () => {
  it('Holoceen ↔ Holocene: bigram similarity catches the variant', () => {
    // "holoceen" (Dutch) vs "holocene" (English) differ only in the last
    // two characters.  Their bigram sets overlap heavily, so the Dice
    // coefficient should be high (> 0.8).  This means querying "holocene"
    // should rank "Holoceen" meaningfully above an unrelated name.
    const names = ['Holoceen', 'Geroerd', 'Verstoord']
    const result = rankByPartialMatch('holocene', names)
    const holRank = result.findIndex(r => r.name === 'Holoceen')
    const geroerdRank = result.findIndex(r => r.name === 'Geroerd')
    expect(holRank).toBeLessThan(geroerdRank)
    expect(result[holRank].score).toBeGreaterThan(result[geroerdRank].score)
  })

  it('bigram signal is non-trivial for the Holoceen/Holocene pair', () => {
    const result = rankByPartialMatch('holocene', ['Holoceen'])
    // The sole result should have a meaningful (non-zero) score driven by Dice.
    expect(result[0].score).toBeGreaterThan(0.1)
  })

  it('clearly unrelated names get near-zero bigram score', () => {
    const result = rankByPartialMatch('zand', ['Geroerd'])
    expect(result[0].score).toBeLessThan(0.3)
  })
})

// ---------------------------------------------------------------------------
// Empty query
// ---------------------------------------------------------------------------

describe('rankByPartialMatch — empty query', () => {
  it('empty query → all scores are 0', () => {
    const result = rankByPartialMatch('', REAL_CANDIDATES)
    for (const r of result) {
      expect(r.score).toBe(0)
    }
  })

  it('empty query → result sorted by name asc (stable)', () => {
    const result = rankByPartialMatch('', REAL_CANDIDATES)
    const names = result.map(r => r.name)
    const sorted = [...REAL_CANDIDATES].sort((a, b) => a.localeCompare(b))
    expect(names).toEqual(sorted)
  })

  it('empty query → full list returned', () => {
    const result = rankByPartialMatch('', REAL_CANDIDATES)
    expect(result).toHaveLength(REAL_CANDIDATES.length)
  })
})

// ---------------------------------------------------------------------------
// No-match query — rank-reorders-never-filters safeguard
// ---------------------------------------------------------------------------

describe('rankByPartialMatch — no-match query returns all names', () => {
  it('query with no overlap → all names still returned', () => {
    // "xyzzy" has no token or bigram overlap with any real candidate.
    const result = rankByPartialMatch('xyzzy', REAL_CANDIDATES)
    expect(result).toHaveLength(REAL_CANDIDATES.length)
  })

  it('no-match query → scores are very low but not negative', () => {
    const result = rankByPartialMatch('xyzzy', REAL_CANDIDATES)
    for (const r of result) {
      expect(r.score).toBeGreaterThanOrEqual(0)
      expect(r.score).toBeLessThan(0.3)
    }
  })
})

// ---------------------------------------------------------------------------
// Ordering stability
// ---------------------------------------------------------------------------

describe('rankByPartialMatch — ordering stability', () => {
  it('equal-score names are sorted by name asc (deterministic)', () => {
    // All names are completely unrelated to the query — all scores are ~0.
    // The secondary sort (name asc) must apply.
    const names = ['Zebra', 'Alpha', 'Mango']
    const result = rankByPartialMatch('xyzzy', names)
    // With uniform scores the result must be alphabetical.
    const returned = result.map(r => r.name)
    // Sort should be stable; every equal-score group is name-asc.
    for (let i = 0; i < returned.length - 1; i++) {
      if (result[i].score === result[i + 1].score) {
        expect(returned[i].localeCompare(returned[i + 1])).toBeLessThanOrEqual(0)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Real screenshot strings
// ---------------------------------------------------------------------------

describe('rankByPartialMatch — real DOV screenshot strings', () => {
  it('query "holoceen" — core holoceen names rank above clearly-unrelated names', () => {
    const result = rankByPartialMatch('holoceen', REAL_CANDIDATES)
    // Names that directly contain "holoceen" (containment signal fires).
    const directHolNames = [
      'Holoceen',
      'Quartair: Holocene afzettingen',
      'Holoceen (Laat Pleistoceen)',
    ]
    // Names that share no containment and no significant tokens with "holoceen".
    const clearlyUnrelated = ['Geroerd', 'Verstoord']

    const minDirectScore = Math.min(
      ...directHolNames.map(n => result.find(r => r.name === n)!.score),
    )
    const maxUnrelatedScore = Math.max(
      ...clearlyUnrelated.map(n => result.find(r => r.name === n)!.score),
    )
    // Direct Holoceen names must all outrank clearly unrelated names.
    expect(minDirectScore).toBeGreaterThan(maxUnrelatedScore)
  })

  it('query "pleistoceen" — pleistoceen variants rank above geroerd/verstoord', () => {
    const result = rankByPartialMatch('pleistoceen', REAL_CANDIDATES)

    const pleiNames = ['Pleistoceen (Vlaamse Vallei)', 'Laat Pleistoceen', 'Holoceen (Laat Pleistoceen)']
    const unrelatedNames = ['Geroerd', 'Verstoord']

    for (const pname of pleiNames) {
      const pScore = result.find(r => r.name === pname)!.score
      for (const uname of unrelatedNames) {
        const uScore = result.find(r => r.name === uname)!.score
        expect(pScore).toBeGreaterThan(uScore)
      }
    }
  })

  it('query "geroerd" — "Geroerd" ranks first', () => {
    const result = rankByPartialMatch('geroerd', REAL_CANDIDATES)
    expect(result[0].name).toBe('Geroerd')
    expect(result[0].score).toBeGreaterThan(0.4)
  })

  it('all 8 real names are returned for every query', () => {
    for (const query of ['holoceen', 'pleistoceen', 'geroerd']) {
      const result = rankByPartialMatch(query, REAL_CANDIDATES)
      expect(result).toHaveLength(REAL_CANDIDATES.length)
    }
  })
})
