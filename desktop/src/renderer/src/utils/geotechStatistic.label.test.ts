// Owner ruling 2026-09-13: "token of course needs translation in dutch
// version". The four representative-qc statistics used to be shown verbatim
// (median / arithmetic / harmonic / geometric) in every language; in the Dutch
// interface they must read as Dutch words wherever the token is displayed.

import { afterEach, describe, expect, it } from 'vitest'

import { getLanguage, setLanguage } from '../i18n/languageSelect'
import { GEOTECH_STATISTICS, geotechStatisticLabel } from './geotechStatistic'

const initialLanguage = getLanguage()

afterEach(() => {
  setLanguage(initialLanguage)
})

describe('token of course needs translation in the Dutch version', () => {
  it('the statistic reads mediaan in the Dutch version', () => {
    setLanguage('nl')
    expect(geotechStatisticLabel('median')).toBe('mediaan')
  })

  it('every one of the four statistics has a Dutch word', () => {
    setLanguage('nl')
    for (const token of GEOTECH_STATISTICS) {
      const label = geotechStatisticLabel(token)
      expect(label).not.toBe(token)
      expect(label.trim()).not.toBe('')
    }
  })

  it('the English version keeps the plain statistic names', () => {
    setLanguage('en')
    expect(GEOTECH_STATISTICS.map(geotechStatisticLabel)).toEqual([
      'median',
      'arithmetic',
      'harmonic',
      'geometric',
    ])
  })
})
