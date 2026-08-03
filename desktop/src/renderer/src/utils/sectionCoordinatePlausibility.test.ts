/**
 * A section whose endpoints cannot be map coordinates must never be sampled.
 *
 * Root cause, proven on the dev DB 2026-08-03 (one read-only SELECT):
 *
 *   id                                   | name | start_x | start_y | end_x | end_y | epsg
 *   019ed12a-bdcd-71fb-be16-fd3eeb4cf27a | good |       0 |       0 |     1 |     0 | 31370
 *   019ed12e-e3f8-7a7d-8d0a-eadc99f85c86 | test |       0 |       0 |     1 |     0 | 31370
 *
 * Two hand-typed sections carry section-space coordinates while claiming
 * Lambert-72. Every re-mount of the section panel asked the DEM for
 * X(-2..1002) Y(-2..2), which is the Atlantic Ocean off Ghana — the observed
 * 404 flood. They slip past the old ``dx*dx + dy*dy < 1`` degenerate guard
 * because a 1.0 m section gives exactly 1.
 *
 * The rule these tests encode: refuse to sample when the endpoints lie outside
 * the CRS's own area of use, and say which section is wrong.
 */
import { describe, expect, it } from 'vitest'

import { implausibleSectionCoordinates } from './sectionCoordinatePlausibility'

/** The two junk rows read out of the dev DB, verbatim. */
const DEV_DB_JUNK_SECTION = {
  id: '019ed12a-bdcd-71fb-be16-fd3eeb4cf27a',
  name: 'good',
  start_x: 0,
  start_y: 0,
  end_x: 1,
  end_y: 0,
  epsg: 31370,
}

/** A real section from the same project (x~88000 / y~164500). */
const REAL_SECTION = {
  id: '019e934c-70fd-7d11-a44a-b2073f4063a2',
  name: 'CS1',
  start_x: 88_120.5,
  start_y: 164_480.2,
  end_x: 88_740.1,
  end_y: 165_090.7,
  epsg: 31370,
}

describe('implausibleSectionCoordinates', () => {
  it('refuses the near-origin Lambert-72 section that produced the DEM flood', () => {
    const reason = implausibleSectionCoordinates(DEV_DB_JUNK_SECTION)
    expect(reason).not.toBeNull()
    // The engineer has to be able to find the row: the message names it.
    expect(reason).toContain('good')
    expect(reason).toContain('Lambert 72')
  })

  it('passes a real Flanders section untouched', () => {
    expect(implausibleSectionCoordinates(REAL_SECTION)).toBeNull()
  })

  it('passes a Wallonia section — the guard is the CRS domain, not Flanders only', () => {
    expect(
      implausibleSectionCoordinates({
        ...REAL_SECTION,
        name: 'Wallonia',
        start_x: 210_000,
        start_y: 100_000,
        end_x: 211_000,
        end_y: 100_500,
      }),
    ).toBeNull()
  })

  it('refuses a non-finite endpoint', () => {
    expect(
      implausibleSectionCoordinates({ ...REAL_SECTION, end_x: Number.NaN }),
    ).not.toBeNull()
  })

  it('passes a section in a CRS we hold no domain for — never refuse what we cannot judge', () => {
    expect(
      implausibleSectionCoordinates({ ...DEV_DB_JUNK_SECTION, epsg: 4326 }),
    ).toBeNull()
  })

  it('refuses an RD/Amersfoort section sitting at the origin', () => {
    expect(
      implausibleSectionCoordinates({ ...DEV_DB_JUNK_SECTION, epsg: 28992 }),
    ).not.toBeNull()
  })
})
