// The triage list (brief 2026-09-30, piece C): "the campaign soundings as a
// list with page thumbnails, checkboxes (all selected), a collapsed 'Not
// imported' block listing the dropped desk-study ids and duplicates once, an
// 'unknown' group the user can tick". Owner answer 2: desk-study reprints are
// named once — "Not imported, look these up yourself: GEO-22/040-S2, …".

import type { ComponentProps } from 'react'

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CptPdfDigest, CptPdfSounding } from '../../api/clients/cptPdf'
import { setLanguage } from '../../i18n/languageSelect'

const pageBlob = vi.fn()
vi.mock('../../api/clients/cptPdf', async () => {
  const actual = await vi.importActual<typeof import('../../api/clients/cptPdf')>('../../api/clients/cptPdf')
  return {
    ...actual,
    cptPdfClient: { ...actual.cptPdfClient, pageBlob: (...a: unknown[]) => pageBlob(...a) },
  }
})

import { clearPdfPageThumbnailCache } from '../../hooks/usePdfPageThumbnail'
import CptPdfTriageList from './CptPdfTriageList'

const realCreate = URL.createObjectURL
const realRevoke = URL.revokeObjectURL
beforeEach(() => {
  clearPdfPageThumbnailCache()
  pageBlob.mockReset()
  pageBlob.mockImplementation(async (_sha: string, page: number) => new Blob([`png-${page}`], { type: 'image/png' }))
  let n = 0
  URL.createObjectURL = vi.fn(() => `blob:thumb-${++n}`)
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => {
  URL.createObjectURL = realCreate
  URL.revokeObjectURL = realRevoke
  setLanguage('en')
})

function sounding(key: string, overrides: Partial<CptPdfSounding> = {}): CptPdfSounding {
  return {
    key,
    sounding_id: key,
    origin: 'campaign',
    page_numbers: [231],
    sheet_count: 1,
    graph_kind: 'vector',
    profile_name: 'van-der-straaten',
    ground_level_m: 6.02,
    z_epsg: 5710,
    x: 66980.21,
    y: 224746.0,
    epsg: 31370,
    test_date: '28-2-2024',
    curves: ['qc', 'fs'],
    clipped_points: 0,
    digitised: true,
    warnings: [],
    ...overrides,
  }
}

function digest(overrides: Partial<CptPdfDigest> = {}): CptPdfDigest {
  return {
    file_sha: 'a'.repeat(64),
    page_count: 300,
    class_counts: {},
    campaign: [sounding('110'), sounding('7', { x: null, y: null, epsg: null, warnings: ['no position printed'] })],
    unknown: [sounding('page-12', { sounding_id: null, origin: 'unknown', page_numbers: [12] })],
    dropped: [
      { sounding_id: 'GEO-22/040-S2', page_numbers: [59], reason: 'desk-study', note: 'look it up in DOV' },
      { sounding_id: 'GEO-22/040-S2', page_numbers: [60], reason: 'desk-study', note: 'look it up in DOV' },
      { sounding_id: '164', page_numbers: [70], reason: 'desk-study', note: 'its own project' },
      { sounding_id: '66', page_numbers: [215], reason: 'duplicate', note: 'printed twice: the sheet on page 210 is kept' },
    ],
    desk_study_ids: ['GEO-22/040-S2', '164'],
    report_code: 'CAMZ-001',
    campaign_codes: ['CAMZ-001'],
    project_numbers: [],
    ocr_available: true,
    raster_pages_unread: 0,
    profiles: ['van-der-straaten'],
    ...overrides,
  }
}

function renderList(
  d: CptPdfDigest,
  selected: string[],
  onToggle = vi.fn(),
  onCalibrate = vi.fn(),
  extra: Partial<ComponentProps<typeof CptPdfTriageList>> = {},
) {
  const onProjectNumberChange = vi.fn()
  render(
    <CptPdfTriageList
      digest={d}
      projectId="p1"
      selected={new Set(selected)}
      edited={new Set()}
      projectNumber=""
      onProjectNumberChange={onProjectNumberChange}
      onToggle={onToggle}
      onCalibrate={onCalibrate}
      {...extra}
    />,
  )
  return { onToggle, onCalibrate, onProjectNumberChange }
}

describe('CptPdfTriageList', () => {
  it('lists every campaign sounding with a page thumbnail and a ticked box', async () => {
    renderList(digest(), ['110', '7'])
    const rows = screen.getAllByTestId('cpt-pdf-row-campaign')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByRole('checkbox')).toBeChecked()
    // The page is fetched through the API client and shown from a blob: URL,
    // which the renderer's CSP allows (a plain http <img> src is blocked).
    const thumb = await within(rows[0]).findByRole('img')
    expect(thumb.getAttribute('src')).toMatch(/^blob:/)
    expect(pageBlob).toHaveBeenCalledWith('a'.repeat(64), 231, 'p1')
  })

  // Owner ruling 2026-10-04: the imported CPT is shown as "<project>-S<number>"
  // ("23.15-002-S110"), and the triage row shows the same name.
  it('the row is labelled with the name the CPT will be shown under', () => {
    renderList(
      digest({ campaign: [sounding('110', { project_number: '23.15-002', display_name: '23.15-002-S110' })] }),
      ['110'],
    )
    const row = screen.getAllByTestId('cpt-pdf-row-campaign')[0]
    expect(row.textContent).toContain('23.15-002-S110')
    expect(within(row).getByRole('checkbox', { name: '23.15-002-S110' })).toBeTruthy()
  })

  it('a backend that sends no display name keeps the printed sounding id', () => {
    renderList(digest({ campaign: [sounding('110')] }), ['110'])
    const row = screen.getAllByTestId('cpt-pdf-row-campaign')[0]
    expect(within(row).getByRole('checkbox', { name: '110' })).toBeTruthy()
  })

  it('a thumbnail that is still loading or failed is a neutral box, never alt text', async () => {
    pageBlob.mockReset()
    pageBlob.mockRejectedValue(new Error('boom'))
    renderList(digest(), ['110', '7'])
    const row = screen.getAllByTestId('cpt-pdf-row-campaign')[0]
    expect(within(row).getByTestId('cpt-pdf-thumbnail-placeholder')).toBeTruthy()
    await waitFor(() => expect(pageBlob).toHaveBeenCalled())
    expect(within(row).queryByRole('img')).toBeNull()
    expect(row.textContent).not.toContain('Page 231 of the report')
    expect(within(row).getByTestId('cpt-pdf-thumbnail-placeholder')).toBeTruthy()
  })

  it('in Dutch a row note reads in Dutch, rendered from its code', () => {
    setLanguage('nl')
    const d = digest({
      campaign: [
        sounding('110', {
          warnings: ['22 point(s) on an axis maximum: the true value is higher'],
          notes: [{ code: 'CLIPPED_POINTS', params: { count: 22 } }],
        }),
      ],
    })
    renderList(d, ['110'])
    const row = screen.getAllByTestId('cpt-pdf-row-campaign')[0]
    expect(row.textContent).toContain('22 punt(en) op een asmaximum: de echte waarde ligt hoger')
    expect(row.textContent).not.toContain('the true value is higher')
  })

  it('a note code this build does not know shows the English sentence the backend sent', () => {
    setLanguage('nl')
    const d = digest({
      campaign: [sounding('110', { warnings: ['a brand new check'], notes: [{ code: 'BRAND_NEW', params: {} }] })],
    })
    renderList(d, ['110'])
    expect(screen.getAllByTestId('cpt-pdf-row-campaign')[0].textContent).toContain('a brand new check')
  })

  it('the row link says what it does: "Check axes…", with a tooltip that explains it', () => {
    renderList(digest(), ['110'])
    const link = within(screen.getAllByTestId('cpt-pdf-row-campaign')[0]).getByTestId('cpt-pdf-calibrate')
    expect(link.textContent).toBe('Check axes…')
    expect(link.getAttribute('title')).toBe(
      'Show the axes the digitiser read on the page and move them if the orange curve does not sit on the printed one',
    )
  })

  it('in Dutch the row link reads "Assen controleren…" with its Dutch tooltip', () => {
    setLanguage('nl')
    renderList(digest(), ['110'])
    const link = within(screen.getAllByTestId('cpt-pdf-row-campaign')[0]).getByTestId('cpt-pdf-calibrate')
    expect(link.textContent).toBe('Assen controleren…')
    expect(link.getAttribute('title')).toBe(
      'Toon de assen die op de pagina gelezen zijn en verschuif ze als de oranje curve niet op de gedrukte ligt',
    )
  })

  it('under the summary one line explains that every row was read and when to open Check axes', () => {
    renderList(digest(), ['110'])
    expect(screen.getByTestId('cpt-pdf-explainer').textContent).toBe(
      'Every row was read automatically. Open Check axes to compare the read curve with the sheet, or when a row asks you to type axis values.',
    )
  })

  it('in Dutch the explainer line reads in Dutch', () => {
    setLanguage('nl')
    renderList(digest(), ['110'])
    expect(screen.getByTestId('cpt-pdf-explainer').textContent).toBe(
      'Elke rij is automatisch gelezen. Open Assen controleren om de gelezen curve met het blad te vergelijken, of wanneer een rij vraagt om aswaarden te typen.',
    )
  })

  it('names each desk-study id once, in a block that starts collapsed', () => {
    renderList(digest(), ['110', '7'])
    const block = screen.getByTestId('cpt-pdf-not-imported')
    expect(block.hasAttribute('open')).toBe(false)
    expect(block.textContent).toContain('GEO-22/040-S2, 164')
    expect(block.textContent?.match(/GEO-22\/040-S2/g)).toHaveLength(1)
  })

  it('lists a sheet printed twice with its notice', () => {
    renderList(digest(), ['110', '7'])
    expect(screen.getByTestId('cpt-pdf-not-imported').textContent).toContain(
      'printed twice: the sheet on page 210 is kept',
    )
  })

  it('lists the unknown-origin soundings apart, unticked, and lets the user tick one', () => {
    const { onToggle } = renderList(digest(), ['110', '7'])
    const unknown = screen.getAllByTestId('cpt-pdf-row-unknown')
    expect(unknown).toHaveLength(1)
    const box = within(unknown[0]).getByRole('checkbox')
    expect(box).not.toBeChecked()
    fireEvent.click(box)
    expect(onToggle).toHaveBeenCalledWith('page-12', true)
  })

  it('unticking a campaign sounding takes it out of the selection', () => {
    const { onToggle } = renderList(digest(), ['110', '7'])
    fireEvent.click(within(screen.getAllByTestId('cpt-pdf-row-campaign')[0]).getByRole('checkbox'))
    expect(onToggle).toHaveBeenCalledWith('110', false)
  })

  it('a sounding without a printed position shows its warning', () => {
    renderList(digest(), ['110', '7'])
    expect(screen.getAllByTestId('cpt-pdf-row-campaign')[1].textContent).toContain('no position printed')
  })

  it('opens the calibration overlay for a sounding', () => {
    const { onCalibrate } = renderList(digest(), ['110'])
    fireEvent.click(within(screen.getAllByTestId('cpt-pdf-row-campaign')[0]).getByTestId('cpt-pdf-calibrate'))
    expect(onCalibrate).toHaveBeenCalledWith('110')
  })

  it('without OCR it tells the user to type the axis values', () => {
    renderList(digest({ ocr_available: false }), ['110'])
    expect(screen.getByTestId('cpt-pdf-ocr-unavailable').textContent).toMatch(/tick reading unavailable/i)
  })

  // Owner ruling 2026-10-05 (a): the "Projectnummer" field under the summary.
  it('in Dutch the field reads "Projectnummer" with the hint "Voor rijen zonder gedrukt projectnummer"', () => {
    setLanguage('nl')
    renderList(digest(), ['110'])
    expect(screen.getByText('Projectnummer')).toBeTruthy()
    expect(screen.getByText('Voor rijen zonder gedrukt projectnummer')).toBeTruthy()
  })

  it('typing in the field reports the value to the dialog', () => {
    const { onProjectNumberChange } = renderList(digest(), ['110'])
    fireEvent.change(screen.getByTestId('cpt-pdf-project-number'), { target: { value: '23.15-006' } })
    expect(onProjectNumberChange).toHaveBeenCalledWith('23.15-006')
  })

  it('a project number typed for one row wins over the field', () => {
    renderList(digest({ campaign: [sounding('85')] }), ['85'], vi.fn(), vi.fn(), {
      projectNumber: '23.15-006',
      headers: { '85': { project_number: '24.13-005' } },
    })
    const row = screen.getAllByTestId('cpt-pdf-row-campaign')[0]
    expect(row.textContent).toContain('24.13-005-S85')
    expect(row.textContent).not.toContain('23.15-006')
  })
})
