import { describe, expect, it } from 'vitest'
import { canConnectPacking } from './geotechPackingConnect'
import type { PackingBandDescriptor } from './geotechPackingConnect'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function band(nadClass: number | null, lithoBodyId: string | null): PackingBandDescriptor {
  return { nadClass, lithoBodyId }
}

// ---------------------------------------------------------------------------
// Happy path: same class + same body → ok
// ---------------------------------------------------------------------------

describe('canConnectPacking', () => {
  describe('when both bands share the same NAD class and same litho body', () => {
    it('returns ok', () => {
      const a = band(15, 'body-abc')
      const b = band(15, 'body-abc')
      const v = canConnectPacking(a, b)
      expect(v.ok).toBe(true)
      expect(v.reason).toBe('ok')
    })

    it('returns ok for class 1 (loosest) and class 31 (densest) — class is the same', () => {
      // Confirm the helper does not special-case extreme classes.
      expect(canConnectPacking(band(1, 'b1'), band(1, 'b1')).ok).toBe(true)
      expect(canConnectPacking(band(31, 'b2'), band(31, 'b2')).ok).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // Rule 1: null NAD class → null-class
  // ---------------------------------------------------------------------------

  describe('when at least one band has a null NAD class', () => {
    it('rejects when source class is null (borehole carry-through)', () => {
      const v = canConnectPacking(band(null, 'body-abc'), band(10, 'body-abc'))
      expect(v.ok).toBe(false)
      expect(v.reason).toBe('null-class')
    })

    it('rejects when target class is null', () => {
      const v = canConnectPacking(band(10, 'body-abc'), band(null, 'body-abc'))
      expect(v.ok).toBe(false)
      expect(v.reason).toBe('null-class')
    })

    it('rejects when both classes are null', () => {
      const v = canConnectPacking(band(null, 'body-abc'), band(null, 'body-abc'))
      expect(v.ok).toBe(false)
      expect(v.reason).toBe('null-class')
    })

    it('checks null-class before different-litho-body (precedence)', () => {
      // Even though the bodies are different, null-class fires first.
      const v = canConnectPacking(band(null, 'body-x'), band(10, 'body-y'))
      expect(v.reason).toBe('null-class')
    })
  })

  // ---------------------------------------------------------------------------
  // Rule 2: same object reference → same-band
  // ---------------------------------------------------------------------------

  describe('when the same descriptor object is passed as both A and B', () => {
    it('rejects with same-band', () => {
      const a = band(15, 'body-abc')
      const v = canConnectPacking(a, a)
      expect(v.ok).toBe(false)
      expect(v.reason).toBe('same-band')
    })

    it('allows two independently-constructed descriptors with equal class + body (rule is reference-only)', () => {
      // The same-band guard is reference equality (a === b), NOT value equality.
      // Two descriptors built separately with the same nadClass + lithoBodyId
      // are DIFFERENT physical bands (different columns) and must connect — the
      // real self-correlate guard is the handler's id-equality short-circuit,
      // not this value match.
      const a = band(15, 'body-abc')
      const b = band(15, 'body-abc')
      expect(a).not.toBe(b) // distinct references, equal values
      const v = canConnectPacking(a, b)
      expect(v.ok).toBe(true)
      expect(v.reason).toBe('ok')
    })
  })

  // ---------------------------------------------------------------------------
  // Rule 3: different litho body → different-litho-body
  // ---------------------------------------------------------------------------

  describe('when bands belong to different litho bodies', () => {
    it('rejects cross-body connection even when NAD classes match', () => {
      // Same class 20 but different body ids — a dense-sand on body A must not
      // connect to a dense-sand on body B (the clay lens between them is the
      // structural break).
      const v = canConnectPacking(band(20, 'body-a'), band(20, 'body-b'))
      expect(v.ok).toBe(false)
      expect(v.reason).toBe('different-litho-body')
    })

    it('rejects when source body id is null (resolver not yet run)', () => {
      const v = canConnectPacking(band(10, null), band(10, 'body-abc'))
      expect(v.ok).toBe(false)
      expect(v.reason).toBe('different-litho-body')
    })

    it('rejects when target body id is null', () => {
      const v = canConnectPacking(band(10, 'body-abc'), band(10, null))
      expect(v.ok).toBe(false)
      expect(v.reason).toBe('different-litho-body')
    })

    it('rejects when both body ids are null', () => {
      const v = canConnectPacking(band(10, null), band(10, null))
      expect(v.ok).toBe(false)
      expect(v.reason).toBe('different-litho-body')
    })

    it('checks different-litho-body before different-class (precedence)', () => {
      // Both checks would fire; body check comes first.
      const v = canConnectPacking(band(5, 'body-x'), band(10, 'body-y'))
      expect(v.reason).toBe('different-litho-body')
    })
  })

  // ---------------------------------------------------------------------------
  // Rule 4: different NAD class → different-class
  // ---------------------------------------------------------------------------

  describe('when bands share a litho body but have different NAD classes', () => {
    it('rejects connection between adjacent packing classes', () => {
      // A "loose" (class 10) and "medium" (class 15) sub-band of the SAME
      // litho body must NOT be connected — they are distinct packing units.
      const v = canConnectPacking(band(10, 'body-shared'), band(15, 'body-shared'))
      expect(v.ok).toBe(false)
      expect(v.reason).toBe('different-class')
    })

    it('rejects connection between class 1 and class 31', () => {
      const v = canConnectPacking(band(1, 'body-shared'), band(31, 'body-shared'))
      expect(v.ok).toBe(false)
      expect(v.reason).toBe('different-class')
    })
  })

  // ---------------------------------------------------------------------------
  // Near-miss: identical class + body but distinct objects → ok
  // ---------------------------------------------------------------------------

  describe('near-miss: two distinct objects with identical values', () => {
    it('connects when class and body match (distinct object references)', () => {
      // The two bands are on DIFFERENT investigations (different CPT columns) but
      // both belong to the same litho body and have the same NAD class — this is
      // exactly the intended "correlate packing" case.
      const a = band(18, 'body-xyz')
      const b = band(18, 'body-xyz')
      expect(a).not.toBe(b) // distinct references
      const v = canConnectPacking(a, b)
      expect(v.ok).toBe(true)
    })
  })
})
