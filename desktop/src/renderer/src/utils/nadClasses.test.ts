/**
 * Tests for NAD class name + colour map utility (nadClasses.ts).
 *
 * Labels are verified verbatim against the backend source of truth:
 * ``src/groundmodel/shared/constants/litho_constants.py`` NAD_CLASSES.
 * Run grep on the backend file alone (never this file) to confirm a label.
 */

import { describe, expect, it } from 'vitest'
import { NAD_CLASS_NAMES, nadClassColor, nadClassName } from './nadClasses'

const HEX_RE = /^#[0-9a-fA-F]{6}$/

// Sentinel returned when no class is assigned.
const NO_QC_SENTINEL = 'No qc — manual class'

// ---- class name ------------------------------------------------------------

describe('nadClassName', () => {
  it('class 1 — "GRIND, matig gp" (verbatim backend label)', () => {
    expect(nadClassName(1)).toBe('GRIND, matig gp')
  })

  it('class 6 — "ZAND, matig gp" (verbatim backend label)', () => {
    expect(nadClassName(6)).toBe('ZAND, matig gp')
  })

  it('class 12 — "ZAND, silt-/kleihoudend, zeer dicht gp" (verbatim backend label)', () => {
    expect(nadClassName(12)).toBe('ZAND, silt-/kleihoudend, zeer dicht gp')
  })

  it('class 13 — "SILT, weinig vast" (verbatim backend label)', () => {
    expect(nadClassName(13)).toBe('SILT, weinig vast')
  })

  it('class 21 — "KLEI, weinig vast" (verbatim backend label)', () => {
    expect(nadClassName(21)).toBe('KLEI, weinig vast')
  })

  it('class 31 — "VEEN, vast" (verbatim backend label)', () => {
    expect(nadClassName(31)).toBe('VEEN, vast')
  })

  it('null returns the no-qc sentinel', () => {
    expect(nadClassName(null)).toBe(NO_QC_SENTINEL)
  })

  it('undefined returns the no-qc sentinel', () => {
    expect(nadClassName(undefined)).toBe(NO_QC_SENTINEL)
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
