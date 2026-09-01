import { describe, expect, it } from 'vitest'

import { translate } from '../i18n/translate'
import { sectionDisplayName } from './sectionDisplayName'

/**
 * The section pane must show the section KIND in the active language. The stored
 * name stays the English canonical default (no migration); this helper translates
 * it at the presentation boundary, and leaves a user-renamed section verbatim.
 */
describe('sectionDisplayName', () => {
  const nl = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) =>
    translate('nl', key, params)
  const en = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) =>
    translate('en', key, params)

  it('renders a default cross-section name in Dutch as "Dwarsprofiel N"', () => {
    expect(sectionDisplayName({ name: 'Cross-section 1' }, nl)).toBe('Dwarsprofiel 1')
    expect(sectionDisplayName({ name: 'Cross-section 12' }, nl)).toBe('Dwarsprofiel 12')
  })

  it('renders a default tie-section name in Dutch as "Koppelprofiel N"', () => {
    expect(sectionDisplayName({ name: 'Tie-section 3' }, nl)).toBe('Koppelprofiel 3')
  })

  it('keeps the English text unchanged in English mode', () => {
    expect(sectionDisplayName({ name: 'Cross-section 2' }, en)).toBe('Cross-section 2')
    expect(sectionDisplayName({ name: 'Tie-section 2' }, en)).toBe('Tie-section 2')
  })

  it('returns a user-renamed section verbatim in any language', () => {
    // Not a canonical default → must survive the presentation-boundary untouched.
    expect(sectionDisplayName({ name: 'Kanaalzone A-A' }, nl)).toBe('Kanaalzone A-A')
    expect(sectionDisplayName({ name: 'Cross-section' }, nl)).toBe('Cross-section') // no ordinal
    expect(sectionDisplayName({ name: 'my Cross-section 4' }, nl)).toBe('my Cross-section 4')
  })
})
