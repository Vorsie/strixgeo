/**
 * #266 — one amber answer per column, whichever signal noticed.
 *
 * The engineer's action is the same either way: re-run the subdivision on that
 * column. Two overlapping warnings about the same column would be the
 * alarm-fatigue failure the entry warns about.
 */
import { describe, expect, it } from 'vitest'

import { t } from '../i18n/translate'
import {
  staleGeotechChipLabel,
  staleGeotechChipTitle,
  unionStaleGeotechColumns,
} from './staleGeotechColumns'

const S17 = { investigation_id: 'inv-s17', label: 'GEO-23/125-S17' }
const S9 = { investigation_id: 'inv-s9', label: 'GEO-23/125-S9' }

const NAMES: Record<string, string> = {
  'inv-s17': 'GEO-23/125-S17',
  'inv-s9': 'GEO-23/125-S9',
  'inv-b1': 'GEO-10/117-B1',
}
const labelFor = (id: string): string | undefined => NAMES[id]

describe('unionStaleGeotechColumns', () => {
  it('SGC1 counts a column noticed by both signals once', () => {
    // Fit sees an overhanging band, provenance sees a moved stack — the same
    // column. Counting it twice would tell the engineer to fix two things.
    const merged = unionStaleGeotechColumns([S17], ['inv-s17'], labelFor)

    expect(merged).toEqual([S17])
  })

  it('SGC2 keeps a column only the geometric fit noticed', () => {
    // A model banded before the provenance stamp shipped has no stamp, so
    // only the fit check can speak for it. Dropping it would lose the warning
    // that already worked.
    const merged = unionStaleGeotechColumns([], ['inv-s17'], labelFor)

    expect(merged).toEqual([S17])
  })

  it('SGC3 keeps a column only the provenance answer noticed', () => {
    // The fit check is CPT-only and cannot see a unit that GREW, was
    // re-classified, or was deleted. #266 is exactly those cases.
    const merged = unionStaleGeotechColumns([S9], [], labelFor)

    expect(merged).toEqual([S9])
  })

  it('SGC4 never drops a column for want of a name', () => {
    // An unresolvable id still has to be reported: a silently missing column
    // is the failure, not a cosmetic problem.
    const merged = unionStaleGeotechColumns([], ['inv-unknown'], labelFor)

    expect(merged).toEqual([{ investigation_id: 'inv-unknown', label: 'inv-unknown' }])
  })

  it('SGC5 presents the same order twice running', () => {
    const merged = unionStaleGeotechColumns([S17], ['inv-b1', 'inv-s9'], labelFor)

    expect(merged.map(c => c.label)).toEqual([
      'GEO-10/117-B1',
      'GEO-23/125-S17',
      'GEO-23/125-S9',
    ])
  })
})

describe('the chip wording', () => {
  it('SGC6 names the columns to re-press, not just how many', () => {
    // A count with no name is a warning he cannot act on.
    const title = staleGeotechChipTitle(t, [S17, S9])

    expect(title).toContain('GEO-23/125-S17')
    expect(title).toContain('GEO-23/125-S9')
    expect(title).toContain('before exporting')
  })

  it('SGC7 summarises a long list instead of overflowing the tooltip', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      investigation_id: `inv-${i}`,
      label: `S${i}`,
    }))

    expect(staleGeotechChipTitle(t, many)).toContain('and 3 more')
  })

  it('SGC8 counts the columns on the chip itself', () => {
    expect(staleGeotechChipLabel(t, 3)).toBe('3 on edited litho')
  })
})
