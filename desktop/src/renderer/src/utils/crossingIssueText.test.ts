// The crossing warning, in the owner's words (dogfeed 2026-09-22): the panel
// said "Younger formation 'Fluviatiel Holoceen' sits below older 'Fluviatiel
// Pleistoceen' by up to 0.29 m" in English inside a Dutch app, and named no
// test, so he could not tell where to draw the section it asked for.
import { describe, expect, it } from 'vitest'

import type { Translator } from '../i18n/translate'
import { setLanguage } from '../i18n/languageSelect'
import { t as appT } from '../i18n/translate'
import { crossingIssueTests, describeCrossingIssue } from './crossingIssueText'

const FORMATIONS = [
  { id: 'f-pleist', name: 'Fluviatiel Pleistoceen' },
  { id: 'f-holo', name: 'Fluviatiel Holoceen' },
]
// The validator's order: (older, younger).
const ISSUE = {
  kind: 'formation_crossing',
  detail: "Younger formation 'Fluviatiel Holoceen' sits below older 'Fluviatiel Pleistoceen' by up to 0.29 m — violates stratigraphic superposition.",
  depth_m: 0.29,
  formation_ids: ['f-pleist', 'f-holo'],
  contact_ids: ['c-1', 'c-2'],
}
const CONTACTS = [
  { id: 'c-1', borehole_id: null, cpt_id: 'cpt-7' },
  { id: 'c-2', borehole_id: 'bh-3', cpt_id: null },
]
const BOREHOLES = [{ id: 'bh-3', name: 'GEO-94/034-B3', location_x: 153500, location_y: 195700 }]
const CPTS = [{ id: 'cpt-7', name: 'GEO-94/034-SVII', location_x: 153600, location_y: 195650 }]

// A translator that echoes the key and its params, so the test reads what the
// sentence is built FROM rather than one language's wording.
const echo: Translator = (key, params) => `${key}${params ? JSON.stringify(params) : ''}`

describe('crossingIssueTests — the tests an issue points at', () => {
  it('C1 — resolves the offending contacts to their tests, with location, in contact order', () => {
    const tests = crossingIssueTests(ISSUE, CONTACTS, BOREHOLES, CPTS)
    expect(tests.map(x => [x.kind, x.name, x.x, x.y])).toEqual([
      ['cpt', 'GEO-94/034-SVII', 153600, 195650],
      ['borehole', 'GEO-94/034-B3', 153500, 195700],
    ])
  })

  it('C2 — a contact whose test is unknown or unlocated is skipped, duplicates once', () => {
    const tests = crossingIssueTests(
      { contact_ids: ['c-1', 'c-1', 'c-x'] },
      [...CONTACTS, { id: 'c-x', borehole_id: 'bh-gone', cpt_id: null }],
      BOREHOLES,
      CPTS,
    )
    expect(tests.map(x => x.id)).toEqual(['cpt-7'])
  })
})

describe('describeCrossingIssue — the sentence the engineer reads', () => {
  it('C3 — names the younger and older formation, the gap and the tests', () => {
    const tests = crossingIssueTests(ISSUE, CONTACTS, BOREHOLES, CPTS)
    expect(describeCrossingIssue(ISSUE, FORMATIONS, tests, echo)).toBe(
      'geology.crossing.text{"younger":"Fluviatiel Holoceen","older":"Fluviatiel Pleistoceen","delta":"0.29"}' +
        'geology.crossing.at{"tests":"GEO-94/034-SVII, GEO-94/034-B3"}',
    )
  })

  it('C4 — without a known test the sentence stops after the gap', () => {
    expect(describeCrossingIssue(ISSUE, FORMATIONS, [], echo)).toBe(
      'geology.crossing.text{"younger":"Fluviatiel Holoceen","older":"Fluviatiel Pleistoceen","delta":"0.29"}',
    )
  })

  it('C5 — an unknown formation falls back to the backend text', () => {
    expect(describeCrossingIssue(ISSUE, [FORMATIONS[0]], [], echo)).toBe(ISSUE.detail)
  })

  it('C6 — in Dutch it reads as one sentence, no English, no em-dash', () => {
    setLanguage('nl')
    try {
      const tests = crossingIssueTests(ISSUE, CONTACTS, BOREHOLES, CPTS)
      const text = describeCrossingIssue(ISSUE, FORMATIONS, tests, appT)
      expect(text).toContain('Fluviatiel Holoceen')
      expect(text).toContain('0.29')
      expect(text).toContain('GEO-94/034-SVII')
      expect(text).not.toMatch(/Younger formation|sits below|—/)
    } finally {
      setLanguage('en')
    }
  })
})
