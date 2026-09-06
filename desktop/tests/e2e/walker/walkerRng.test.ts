/**
 * Guards for the seeded RNG foundation (explicit vitest imports).
 *
 * The policy's replay contract rests on these: a fixed seed and step must give
 * the same stream, and WALKER_SEED must parse the same way every time.
 */

import { describe, it, expect } from 'vitest'

import { mulberry32, mixSeed, parseSeed, pickIndex, pickWeighted, stepRng } from './walkerRng'

describe('walkerRng -- determinism', () => {
  it('stepRng(seed, step) yields the same stream every call', () => {
    const a = stepRng(7, 3)
    const b = stepRng(7, 3)
    const seqA = [a(), a(), a(), a()]
    const seqB = [b(), b(), b(), b()]
    expect(seqA).toEqual(seqB)
  })

  it('different steps of one seed give different streams', () => {
    const a = stepRng(7, 3)
    const b = stepRng(7, 4)
    expect([a(), a(), a()]).not.toEqual([b(), b(), b()])
  })

  it('mixSeed and mulberry32 stay in uint32 and produce [0,1)', () => {
    const rng = mulberry32(mixSeed(0, 0))
    for (let i = 0; i < 100; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('walkerRng -- parseSeed', () => {
  it('uses a bare integer verbatim', () => {
    expect(parseSeed('42')).toBe(42)
  })

  it('hashes a non-numeric string deterministically', () => {
    expect(parseSeed('abc')).toBe(parseSeed('abc'))
    expect(parseSeed('abc')).not.toBe(parseSeed('abd'))
  })

  it('returns null for empty / missing so the caller draws a fresh seed', () => {
    expect(parseSeed(undefined)).toBeNull()
    expect(parseSeed('')).toBeNull()
    expect(parseSeed('   ')).toBeNull()
  })
})

describe('walkerRng -- pickers', () => {
  it('pickIndex stays in range and returns -1 for empty', () => {
    const rng = mulberry32(1)
    for (let i = 0; i < 50; i++) {
      const idx = pickIndex(rng, 5)
      expect(idx).toBeGreaterThanOrEqual(0)
      expect(idx).toBeLessThan(5)
    }
    expect(pickIndex(mulberry32(1), 0)).toBe(-1)
  })

  it('pickWeighted never picks a zero-weight entry when others exist', () => {
    // weights [0, 5, 0]: only index 1 is eligible.
    for (let s = 0; s < 50; s++) {
      expect(pickWeighted(mulberry32(s), [0, 5, 0])).toBe(1)
    }
  })

  it('pickWeighted falls back to uniform when all weights are zero', () => {
    const idx = pickWeighted(mulberry32(3), [0, 0, 0])
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(idx).toBeLessThan(3)
  })
})
