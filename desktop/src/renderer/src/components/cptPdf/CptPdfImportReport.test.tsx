// The PDF import report says each remark in the app language (owner finding
// 2026-10-04: the report printed the raw code plus the backend's English
// sentence inside the Dutch app). Project rule: translate at the presentation
// boundary from code + params; the code stays as a small tag and the English
// sentence is the tooltip. A code this build does not know keeps the English.

import { render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { CptPdfImportResult } from '../../api/clients/cptPdf'
import { setLanguage } from '../../i18n/languageSelect'
import CptPdfImportReport from './CptPdfImportReport'

afterEach(() => setLanguage('en'))

const CLIPPED_EN =
  'PDF_CLIPPED_POINTS: 112 qc point(s) drawn on the axis maximum (31.998): the true value is at least that; kept at the maximum and flagged, never interpolated'

function result(issues: CptPdfImportResult['issues']): CptPdfImportResult {
  return {
    sounding_id: 's112',
    status: 'refreshed',
    name: '23.15-002-S112',
    cpt_id: 'c1',
    code: null,
    message: null,
    diff: null,
    issues,
  }
}

const S112 = result([
  {
    level: 'warning',
    code: 'PDF_CLIPPED_POINTS',
    message: CLIPPED_EN.replace('PDF_CLIPPED_POINTS: ', ''),
    rows: [1],
    params: { curve: 'qc', count: 112, axis_max: 31.998 },
  },
  {
    level: 'info',
    code: 'PDF_DEPTH_FROM_ELEVATION',
    message: 'the sheet plots elevation: depth = printed ground level (6.05 m) - plotted elevation',
    rows: [],
    params: { ground_level_m: 6.05 },
  },
  {
    level: 'info',
    code: 'PDF_DRILLED_INTERVALS',
    message:
      '4 drilled interval(s) without measurement (32.40-33.16 m, 35.96-37.04 m, 39.29-40.20 m, 45.51-46.01 m): left empty, never interpolated',
    rows: [],
    params: { intervals: [[32.4, 33.16], [35.96, 37.04], [39.29, 40.2], [45.51, 46.01]] },
  },
])

function remarks(): HTMLElement[] {
  return within(screen.getByTestId('cpt-pdf-report-row')).getAllByTestId('cpt-pdf-report-issue')
}

describe('CptPdfImportReport says each remark in the app language', () => {
  it('Dutch app: the three remarks of S112 read Dutch with their numbers filled', () => {
    setLanguage('nl')
    render(<CptPdfImportReport results={[S112]} />)
    const [clipped, elevation, drilled] = remarks()
    expect(clipped).toHaveTextContent(
      '112 qc-punt(en) op het asmaximum (31.998): de echte waarde ligt minstens zo hoog; op het maximum gehouden en gemarkeerd',
    )
    expect(elevation).toHaveTextContent('Hoogte-as: diepte = gedrukt maaiveld (6.05 m) min geplotte hoogte')
    expect(drilled).toHaveTextContent(
      'Overboring zonder meting: 32.4 tot 33.2 m, 36.0 tot 37.0 m, 39.3 tot 40.2 m, 45.5 tot 46.0 m; leeg gelaten, nooit geïnterpoleerd',
    )
    // The status line is unchanged.
    expect(screen.getByTestId('cpt-pdf-report-row')).toHaveTextContent('vervangen')
  })

  it('the code stays as a small tag and the English sentence is the tooltip', () => {
    setLanguage('nl')
    render(<CptPdfImportReport results={[S112]} />)
    const [clipped] = remarks()
    expect(within(clipped).getByText('PDF_CLIPPED_POINTS')).toBeInTheDocument()
    expect(clipped).toHaveAttribute('title', S112.issues[0].message)
    expect(clipped).not.toHaveTextContent('drawn on the axis maximum')
  })

  it('no-position and no-OCR remarks read Dutch too', () => {
    setLanguage('nl')
    render(
      <CptPdfImportReport
        results={[
          result([
            { level: 'error', code: 'PDF_NO_XY', message: 'the sheet prints no position: type X and Y to place this sounding', rows: [] },
            { level: 'info', code: 'PDF_OCR_UNAVAILABLE', message: 'read without OCR: the axis values were typed or taken from the grid', rows: [] },
          ]),
        ]}
      />,
    )
    const [noXy, noOcr] = remarks()
    expect(noXy).toHaveTextContent('Geen ligging op het blad: typ X en Y om deze sondering te plaatsen')
    expect(noOcr).toHaveTextContent('Gelezen zonder OCR: de aswaarden zijn getypt of van het raster genomen')
  })

  it('a GEF pre-drill warning reuses its existing line', () => {
    setLanguage('nl')
    render(
      <CptPdfImportReport
        results={[
          result([
            {
              level: 'warning',
              code: 'PRE_DRILL_NOT_APPLIED',
              message: 'declared pre-drill 0.35 m not applied',
              rows: [],
              details: { pre_drill_m: 0.35, first_depth_m: 0.02 },
            },
          ]),
        ]}
      />,
    )
    expect(remarks()[0]).toHaveTextContent('een voorboring van 0.35 m is opgegeven, maar de diepten beginnen op 0.02 m')
  })

  it('an unknown code keeps the English sentence; params missing keep it too', () => {
    setLanguage('nl')
    render(
      <CptPdfImportReport
        results={[
          result([
            { level: 'info', code: 'PDF_SOMETHING_NEW', message: 'a remark this build does not know', rows: [] },
            { level: 'info', code: 'PDF_DEPTH_FROM_ELEVATION', message: 'the sheet plots elevation: no ground level', rows: [] },
          ]),
        ]}
      />,
    )
    const [unknown, noParams] = remarks()
    expect(unknown).toHaveTextContent('a remark this build does not know')
    expect(within(unknown).getByText('PDF_SOMETHING_NEW')).toBeInTheDocument()
    expect(noParams).toHaveTextContent('the sheet plots elevation: no ground level')
  })

  it('English app: the clipped remark reads the English sentence', () => {
    render(<CptPdfImportReport results={[S112]} />)
    expect(remarks()[0]).toHaveTextContent(
      '112 qc point(s) drawn on the axis maximum (31.998): the true value is at least that; kept at the maximum and flagged, never interpolated',
    )
  })
})
