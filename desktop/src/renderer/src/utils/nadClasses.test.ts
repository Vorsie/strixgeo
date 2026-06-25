/**
 * Tests for NAD class name + colour map utility (nadClasses.ts).
 *
 * Labels are the ENGLISH translations rendered in the UI (the backend holds the
 * canonical Dutch ``NAD_CLASSES``). The class NUMBER is the stable key; the
 * English text is presentation, refined in nadClasses.ts.
 */

import { describe, expect, it } from 'vitest'
import { NAD_CLASS_NAMES, nadClassColor, nadClassName } from './nadClasses'

const HEX_RE = /^#[0-9a-fA-F]{6}$/

// ---- class name ------------------------------------------------------------

describe('nadClassName', () => {
  it('class 1 — "GRAVEL, medium dense"', () => {
    expect(nadClassName(1)).toBe('GRAVEL, medium dense')
  })

  it('class 6 — "SAND, medium dense"', () => {
    expect(nadClassName(6)).toBe('SAND, medium dense')
  })

  it('class 12 — "SAND, silty/clayey, very dense"', () => {
    expect(nadClassName(12)).toBe('SAND, silty/clayey, very dense')
  })

  it('class 13 — "SILT, slightly firm"', () => {
    expect(nadClassName(13)).toBe('SILT, slightly firm')
  })

  it('class 21 — "CLAY, slightly firm"', () => {
    expect(nadClassName(21)).toBe('CLAY, slightly firm')
  })

  it('class 31 — "PEAT, firm"', () => {
    expect(nadClassName(31)).toBe('PEAT, firm')
  })

  it('null returns empty string (degenerate — no CPTs for the lithology; no label renders)', () => {
    expect(nadClassName(null)).toBe('')
  })

  it('undefined returns empty string (same degenerate path as null)', () => {
    expect(nadClassName(undefined)).toBe('')
  })

  it('out-of-range class returns a safe fallback containing the number', () => {
    const result = nadClassName(99)
    expect(result).toContain('99')
  })
})

// ---- class colour ----------------------------------------------------------

describe('nadClassColor', () => {
  it('class 6 returns a valid hex colour', () => {
    expect(nadClassColor(6)).toMatch(HEX_RE)
  })

  it('class 1 returns a valid hex colour', () => {
    expect(nadClassColor(1)).toMatch(HEX_RE)
  })

  it('class 31 returns a valid hex colour', () => {
    expect(nadClassColor(31)).toMatch(HEX_RE)
  })

  it('null returns a valid neutral hex colour (not amber)', () => {
    const c = nadClassColor(null)
    expect(c).toMatch(HEX_RE)
    // amber family is reserved for unsaved-state markers (#fbbf24 / #f59e0b etc.)
    expect(c.toLowerCase()).not.toMatch(/^#f[5b][9b][e1]/)
  })

  it('undefined returns the same neutral colour as null', () => {
    expect(nadClassColor(undefined)).toBe(nadClassColor(null))
  })

  it('all 31 classes return valid hex colours', () => {
    for (let i = 1; i <= 31; i++) {
      expect(nadClassColor(i)).toMatch(HEX_RE)
    }
  })
})

// ---- NAD_CLASS_NAMES dictionary completeness --------------------------------

describe('NAD_CLASS_NAMES', () => {
  it('covers all 31 classes', () => {
    for (let i = 1; i <= 31; i++) {
      expect(NAD_CLASS_NAMES[i]).toBeTruthy()
    }
  })

  it('has no extra keys outside 1–31', () => {
    const keys = Object.keys(NAD_CLASS_NAMES).map(Number)
    expect(keys.every((k) => k >= 1 && k <= 31)).toBe(true)
    expect(keys.length).toBe(31)
  })
})
