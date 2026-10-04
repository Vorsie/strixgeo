// The import report in Dutch — owner dogfeed 2026-10-03: "the flag texts are
// English inside the NL report".
//
// Rule (translate at the presentation boundary): every flag the DOV borehole
// XML import raises reads in the interface language, built from its code and
// its structured params; the raw code stays visible as a small tag; the
// backend's English sentence is only the tooltip (data, not chrome). "Copy
// report" copies the translated lines. A code the catalogue does not know, or
// a flag from an older backend without params, still shows the English
// message rather than nothing.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ImportFlag } from '../api/client'
import type { BoreholeImportReportFile } from '../hooks/useBoreholeXmlImport'
import { setLanguage } from '../i18n/languageSelect'
import BoreholeImportReportPanel from './BoreholeImportReportPanel'

/** One finding per code the importer can raise, with the params the backend sends. */
const FLAGS: Array<Pick<ImportFlag, 'code' | 'params'> & { level?: string }> = [
  { code: 'FILE_HOLDS_MANY_BORINGS', params: { count: 4 } },
  {
    code: 'NAME_FROM_ALTERNATIVE',
    params: {
      alternatives: [{ name: 'GEO-25/110-B1', type: 'VO - Afdeling Geotechniek' }, { name: 'B1', type: null }],
      test_id: '1411-BORGEO2600011-21-04-2026-B1',
    },
  },
  { code: 'NO_LITHOLOGICAL_DESCRIPTION', params: {} },
  {
    code: 'MULTIPLE_LITHOLOGICAL_DESCRIPTIONS',
    params: { count: 3, used_layers: 12, used_permkey: '2025-9', other_layers: [4, 2] },
  },
  { code: 'STRATIGRAPHY_PRESENT', params: { stream: 'formal_stratigraphy', layers: 5, permkey: '2025-7' } },
  { code: 'RELIABILITY_NOT_GOOD', params: { subject: 'position', reliability: 'onbekend' } },
  { code: 'RELIABILITY_NOT_GOOD', params: { subject: 'elevation', reliability: 'twijfelachtig' } },
  {
    code: 'RELIABILITY_NOT_GOOD',
    params: { subject: 'interpretation', stream: 'lithological_description', permkey: '2025-9', reliability: 'onbekend' },
  },
  { code: 'ELEVATION_ZERO', params: { method: 'GPS' } },
  { code: 'ELEVATION_ZERO', params: { method: null } },
  { code: 'NO_FIELD_LOG', params: {} },
  { code: 'DRILLMASTER_UNKNOWN', params: { drillmaster: 'Onbekend' } },
  { code: 'DRILLMASTER_UNKNOWN', params: { drillmaster: null } },
  { code: 'PURPOSE_NOT_GEOTECHNICAL', params: { purpose: 'Geologisch onderzoek', expected: 'Geotechnisch onderzoek' } },
  { code: 'PURPOSE_NOT_GEOTECHNICAL', params: { purpose: null, expected: 'Geotechnisch onderzoek' } },
  { code: 'REMARK_PRESENT', params: { remark: 'boring gestaakt op steen' } },
  { code: 'ATTACHMENT_PRESENT', params: { title: 'boorstaat.pdf', url: 'https://dov.example/b.pdf' } },
  { code: 'ATTACHMENT_PRESENT', params: { title: null, url: null } },
  { code: 'DEPTH_MISMATCH', params: { total_m: 44, end_m: 47, against: 'lithological_description' } },
  { code: 'DEPTH_MISMATCH', params: { total_m: 3, end_m: 2, against: 'drill_segment' } },
  { code: 'DATE_IN_FUTURE', params: { date: '2026-12-01', today: '2026-10-04' } },
  { code: 'GROUNDWATER_ASSUMED', params: { depth_m: 7 } },
  { code: 'GROUNDWATER_ASSUMED', params: { depth_m: null } },
  { code: 'START_DEPTH_NOT_ZERO', params: { depth_m: 0.5 } },
  {
    code: 'LITHOLOGY_GAPS_OR_OVERLAPS',
    params: {
      count: 8,
      places: [
        { kind: 'start', from_m: 0.2, to_m: null },
        { kind: 'gap', from_m: 1, to_m: 1.5 },
        { kind: 'overlap', from_m: 2, to_m: 2.4 },
      ],
      more: 5,
    },
  },
  { code: 'UNKNOWN_INTERPRETATION_STREAM', params: { tag: 'nieuwestroom' } },
  {
    code: 'INTERPRETATION_WITHOUT_BORING',
    params: { file: 'b.xml', count: 2, tags: ['lithologischebeschrijving'], boring: 'ELDERS-B9' },
  },
  { code: 'DUPLICATE_BORING_IN_FILE', params: {} },
  { code: 'INVALID_INTERVAL', params: { part: 'drill_segment', top_m: 2, base_m: 1, reason: 'base_not_below_top' } },
  { code: 'INVALID_INTERVAL', params: { part: 'color', top_m: 1, base_m: 1, reason: 'base_not_below_top' } },
  {
    code: 'INVALID_INTERVAL',
    params: { part: 'layer', layer_index: 3, top_m: -1, base_m: 2, reason: 'invalid_value' },
  },
  { code: 'NOT_IMPORTED', level: 'error', params: {} },
  { code: 'NO_COORDINATES', level: 'error', params: {} },
  { code: 'ZERO_COORDINATES', level: 'error', params: {} },
  { code: 'COORDINATES_OUTSIDE_CRS_BOUNDS', params: { x: 5, y: 7, crs: 'Belge 1972 / Belgian Lambert 72 (EPSG:31370)' } },
  { code: 'NO_TOTAL_DEPTH', params: {} },
  { code: 'NO_ELEVATION', params: {} },
  { code: 'NO_DETAILS', params: {} },
  { code: 'INCOMPLETE_DRILL_SEGMENT', params: { top_m: 1, base_m: null, method: null } },
  { code: 'INCOMPLETE_FIELD_LOG', params: { part: 'moisture', top_m: null, base_m: 2 } },
  { code: 'NO_LAYERS', params: { stream: 'informal_stratigraphy' } },
  { code: 'INCOMPLETE_LAYER', params: { layer_index: 4, top_m: null, base_m: null } },
  { code: 'SAMPLES_PRESENT', params: { count: 6, grain_size: 2 } },
  { code: 'SAMPLE_WITHOUT_DEPTH', params: { sample: '3' } },
  { code: 'SAMPLE_WITHOUT_BORING', params: { file: 'b.xml', sample: '7', boring: 'ELDERS-B9' } },
  {
    code: 'SAMPLE_OBSERVATIONS_NOT_IMPORTED',
    params: { sample: '3', count: 2, parameters: ['Watergehalte', 'Atterberg grenzen'] },
  },
]

/** English words the backend sentences use and no Dutch sentence should. */
const ENGLISH_WORDS = [
  'the',
  'file',
  'named',
  'description',
  'imported',
  'depth',
  'reliability',
  'remark',
  'attachment',
  'drill',
  'purpose',
  'layers',
  'starts',
  'surface',
  'assumed',
  'given',
  'borehole',
  'interpretation',
  'sample',
  'with',
  'which',
  'not',
  'only',
  'more',
  'position',
  'elevation',
  'stream',
  'unknown',
  'coordinates',
  'missing',
  'invalid',
  'skipped',
]

function englishWordsIn(text: string): string[] {
  // Raw source values in the fixtures are Dutch / neutral, so any hit is chrome.
  const words: string[] = text.toLowerCase().match(/[a-z]+/g) ?? []
  return ENGLISH_WORDS.filter(w => words.includes(w))
}

const ENGLISH_MESSAGE = (code: string): string => `X-B1: english backend sentence for ${code}`

function reportOf(flags: typeof FLAGS): BoreholeImportReportFile[] {
  return [
    {
      fileName: 'b.xml',
      outcome: 'imported',
      fileIssues: [],
      boreholes: [
        {
          borehole_id: 'B1',
          name: 'X-B1',
          test_id: 'X-B1',
          has_errors: false,
          refreshed: false,
          imported: true,
          issues: flags.map(f => ({
            level: f.level ?? 'warning',
            code: f.code,
            message: ENGLISH_MESSAGE(f.code),
            rows: [],
            params: f.params,
          })),
        },
      ],
    },
  ]
}

describe('BoreholeImportReportPanel in Dutch', () => {
  beforeEach(() => setLanguage('nl'))
  afterEach(() => {
    setLanguage('en')
    vi.restoreAllMocks()
  })

  it.each(FLAGS.map((f, i) => [f.code, i] as const))(
    '%s reads in Dutch, without English words, raw code as tag and English as tooltip',
    (code, index) => {
      render(<BoreholeImportReportPanel report={reportOf([FLAGS[index]])} onClose={vi.fn()} />)
      const row = screen.getByTestId('import-flag')
      const text = within(row).getByTestId('import-flag-text')
      expect(text.textContent ?? '').not.toBe('')
      expect(text.textContent).not.toContain('english backend sentence')
      expect(englishWordsIn(text.textContent ?? '')).toEqual([])
      // The backend's English sentence is the tooltip; the code is a small tag.
      expect(text.getAttribute('title')).toBe(ENGLISH_MESSAGE(code))
      expect(within(row).getByTestId('import-flag-code').textContent).toBe(code)
    },
  )

  it('fills the variable parts in: counts, names, depths, permkeys', () => {
    render(<BoreholeImportReportPanel report={reportOf(FLAGS.slice(0, 4))} onClose={vi.fn()} />)
    const texts = screen.getAllByTestId('import-flag-text').map(el => el.textContent ?? '')
    expect(texts[0]).toContain('4')
    expect(texts[1]).toContain('GEO-25/110-B1')
    expect(texts[1]).toContain('1411-BORGEO2600011-21-04-2026-B1')
    expect(texts[3]).toContain('2025-9')
    expect(texts[3]).toContain('12')
  })

  it('Copy report copies the Dutch lines, not the English sentences', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<BoreholeImportReportPanel report={reportOf(FLAGS)} onClose={vi.fn()} />)
    fireEvent.click(screen.getByTestId('borehole-import-report-copy'))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    const copied = writeText.mock.calls[0][0] as string
    expect(copied).not.toContain('english backend sentence')
    expect(copied).toContain('[Waarschuwing] FILE_HOLDS_MANY_BORINGS:')
  })

  it('an unknown code, or a flag without params, falls back to the English message', () => {
    render(
      <BoreholeImportReportPanel
        report={[
          {
            fileName: 'b.xml',
            outcome: 'imported',
            fileIssues: [],
            boreholes: [
              {
                borehole_id: 'B1',
                name: 'X-B1',
                test_id: 'X-B1',
                has_errors: false,
                refreshed: false,
                imported: true,
                issues: [
                  { level: 'info', code: 'SOMETHING_NEW', message: 'X-B1: brand new finding', rows: [] },
                  { level: 'info', code: 'FILE_HOLDS_MANY_BORINGS', message: 'X-B1: old backend', rows: [] },
                ],
              },
            ],
          },
        ]}
        onClose={vi.fn()}
      />,
    )
    const texts = screen.getAllByTestId('import-flag-text').map(el => el.textContent)
    expect(texts).toEqual(['X-B1: brand new finding', 'X-B1: old backend'])
  })
})
