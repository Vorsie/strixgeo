import { describe, expect, it } from 'vitest'

import {
  SUPPORTED_SECTION_HORIZONTAL_EPSGS,
  isSupportedSectionCrs,
  horizontalCrsLabel,
  sectionCrsBlockReason,
} from './horizontalCrs'

// Mirror of the backend test_horizontal_crs.py — debt #31. The two
// allowlists MUST agree; if this drifts, a section the UI lets you
// create gets rejected by the API (or vice versa).

describe('isSupportedSectionCrs', () => {
  it('accepts every allowlisted projected metric CRS', () => {
    for (const epsg of SUPPORTED_SECTION_HORIZONTAL_EPSGS) {
      expect(isSupportedSectionCrs(epsg)).toBe(true)
    }
  })

  it('covers the two debt-#31-named national datums', () => {
    expect(isSupportedSectionCrs(31370)).toBe(true) // Belgian Lambert 72
    expect(isSupportedSectionCrs(28992)).toBe(true) // Amersfoort / RD New
  })

  it('rejects geographic / missing CRS (the failure mode)', () => {
    expect(isSupportedSectionCrs(4326)).toBe(false) // WGS 84 degrees
    expect(isSupportedSectionCrs(4258)).toBe(false) // ETRS89 geographic
    expect(isSupportedSectionCrs(null)).toBe(false)
    expect(isSupportedSectionCrs(undefined)).toBe(false)
    expect(isSupportedSectionCrs(0)).toBe(false)
  })

  it('mirrors the backend allowlist exactly', () => {
    expect([...SUPPORTED_SECTION_HORIZONTAL_EPSGS].sort((a, b) => a - b)).toEqual([
      3812, 25831, 28992, 31370, 32631,
    ])
  })
})

describe('horizontalCrsLabel', () => {
  it('is honest for unknown / missing codes', () => {
    expect(horizontalCrsLabel(31370)).toContain('31370')
    expect(horizontalCrsLabel(99999)).toBe('EPSG:99999')
    expect(horizontalCrsLabel(null)).toBe('no CRS')
  })
})

describe('sectionCrsBlockReason', () => {
  it('returns null when the CRS is a supported metric CRS', () => {
    expect(sectionCrsBlockReason(31370)).toBeNull()
    expect(sectionCrsBlockReason(28992)).toBeNull()
  })

  it('explains the "no CRS resolved" case', () => {
    const reason = sectionCrsBlockReason(null)
    expect(reason).not.toBeNull()
    expect(reason).toContain('No horizontal CRS')
    expect(reason).toContain('Project metadata')
  })

  it('names the offending CRS for a non-metric one', () => {
    const reason = sectionCrsBlockReason(4326)
    expect(reason).not.toBeNull()
    expect(reason).toContain('EPSG:4326')
    expect(reason).toContain('metric')
  })
})
