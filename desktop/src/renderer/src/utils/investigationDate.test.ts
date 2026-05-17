import { describe, expect, it } from 'vitest'

import { isWithinDateRange, parseInvestigationDate } from './investigationDate'

// Helper: assert the parsed Date is a specific UTC calendar day.
function utcDate(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d))
}

describe('parseInvestigationDate', () => {
  // -------------------------------------------------------------------------
  // Null / empty → null
  // -------------------------------------------------------------------------
  it('returns null for null', () => {
    expect(parseInvestigationDate(null)).toBeNull()
  })

  it('returns null for undefined', () => {
    expect(parseInvestigationDate(undefined)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseInvestigationDate('')).toBeNull()
  })

  it('returns null for whitespace-only string', () => {
    expect(parseInvestigationDate('   ')).toBeNull()
  })

  // -------------------------------------------------------------------------
  // ISO YYYY-MM-DD
  // -------------------------------------------------------------------------
  it('parses a well-formed ISO date', () => {
    expect(parseInvestigationDate('2019-03-14')).toEqual(utcDate(2019, 3, 14))
  })

  it('parses a DOV-style ISO date at the start of the year', () => {
    expect(parseInvestigationDate('2000-01-01')).toEqual(utcDate(2000, 1, 1))
  })

  it('parses a DOV-style ISO date at the end of the year', () => {
    expect(parseInvestigationDate('1997-12-31')).toEqual(utcDate(1997, 12, 31))
  })

  // -------------------------------------------------------------------------
  // Slash-separated YYYY/MM/DD (GEF variant)
  // -------------------------------------------------------------------------
  it('parses a slash-separated date', () => {
    expect(parseInvestigationDate('2005/07/22')).toEqual(utcDate(2005, 7, 22))
  })

  // -------------------------------------------------------------------------
  // Year-only YYYY → Jan 1
  // -------------------------------------------------------------------------
  it('parses a year-only string to Jan 1 of that year', () => {
    expect(parseInvestigationDate('2010')).toEqual(utcDate(2010, 1, 1))
  })

  it('parses the year 1950 (old archival CPTs)', () => {
    expect(parseInvestigationDate('1950')).toEqual(utcDate(1950, 1, 1))
  })

  // -------------------------------------------------------------------------
  // Garbage / unparseable → null
  // -------------------------------------------------------------------------
  it('returns null for garbage text', () => {
    expect(parseInvestigationDate('not a date')).toBeNull()
  })

  it('returns null for a partial string that is not an ISO or year', () => {
    // e.g. "03/2019" — not supported; too ambiguous to guess DD/MM vs MM/YYYY
    expect(parseInvestigationDate('03/2019')).toBeNull()
  })

  it('returns null for an out-of-range year-only string', () => {
    // Year < 1800 or > 2100 is treated as garbage.
    expect(parseInvestigationDate('0001')).toBeNull()
    expect(parseInvestigationDate('9999')).toBeNull()
  })

  it('returns null for an ISO string with an out-of-range month', () => {
    expect(parseInvestigationDate('2020-13-01')).toBeNull()
  })

  it('returns null for an ISO string with an out-of-range day', () => {
    // Feb 30 does not exist; Date would roll over → our guard catches it.
    expect(parseInvestigationDate('2021-02-30')).toBeNull()
  })

  // -------------------------------------------------------------------------
  // Boundary: inclusive comparison helpers (the filter uses >= / <=)
  // -------------------------------------------------------------------------
  it('the same parsed date equals itself (inclusive boundary)', () => {
    const d = parseInvestigationDate('2020-06-15')!
    const bound = parseInvestigationDate('2020-06-15')!
    expect(d.getTime()).toBe(bound.getTime())
  })

  it('a date one day before the bound is strictly earlier', () => {
    const d = parseInvestigationDate('2020-06-14')!
    const bound = parseInvestigationDate('2020-06-15')!
    expect(d.getTime()).toBeLessThan(bound.getTime())
  })

  it('a date one day after the bound is strictly later', () => {
    const d = parseInvestigationDate('2020-06-16')!
    const bound = parseInvestigationDate('2020-06-15')!
    expect(d.getTime()).toBeGreaterThan(bound.getTime())
  })
})

describe('isWithinDateRange', () => {
  it('no bound set → every item passes (including a dateless item)', () => {
    expect(isWithinDateRange('2020-06-15', '', '')).toBe(true)
    expect(isWithinDateRange('2020-06-15', null, null)).toBe(true)
    expect(isWithinDateRange(null, '', '')).toBe(true)
    expect(isWithinDateRange('not a date', null, null)).toBe(true)
  })

  it('a bound IS set → dateless / unparseable item is excluded', () => {
    expect(isWithinDateRange(null, '2020-01-01', '')).toBe(false)
    expect(isWithinDateRange('garbage', '', '2020-12-31')).toBe(false)
    expect(isWithinDateRange(null, '2020-01-01', '2020-12-31')).toBe(false)
  })

  it('open-ended lower bound: includes anything on/after From', () => {
    expect(isWithinDateRange('2020-01-01', '2020-01-01', '')).toBe(true) // inclusive
    expect(isWithinDateRange('2025-07-09', '2020-01-01', '')).toBe(true)
    expect(isWithinDateRange('2019-12-31', '2020-01-01', '')).toBe(false)
  })

  it('open-ended upper bound: includes anything on/before To', () => {
    expect(isWithinDateRange('2020-12-31', '', '2020-12-31')).toBe(true) // inclusive
    expect(isWithinDateRange('1998-04-02', '', '2020-12-31')).toBe(true)
    expect(isWithinDateRange('2021-01-01', '', '2020-12-31')).toBe(false)
  })

  it('both bounds: inclusive on both ends, excludes outside', () => {
    expect(isWithinDateRange('2020-01-01', '2020-01-01', '2020-12-31')).toBe(true)
    expect(isWithinDateRange('2020-12-31', '2020-01-01', '2020-12-31')).toBe(true)
    expect(isWithinDateRange('2020-06-15', '2020-01-01', '2020-12-31')).toBe(true)
    expect(isWithinDateRange('2019-12-31', '2020-01-01', '2020-12-31')).toBe(false)
    expect(isWithinDateRange('2021-01-01', '2020-01-01', '2020-12-31')).toBe(false)
  })

  it('year-only item date is floored to Jan 1 for the comparison', () => {
    // "2020" → 2020-01-01: inside a 2020 range, on the lower inclusive edge.
    expect(isWithinDateRange('2020', '2020-01-01', '2020-12-31')).toBe(true)
    // "2020" → 2020-01-01 is BEFORE a Feb-2020 lower bound.
    expect(isWithinDateRange('2020', '2020-02-01', '')).toBe(false)
  })
})
