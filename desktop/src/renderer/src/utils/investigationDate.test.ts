import { describe, expect, it } from 'vitest'

import { parseInvestigationDate } from './investigationDate'

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
