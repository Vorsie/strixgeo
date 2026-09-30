// The triage list (brief 2026-09-30, piece C): "the campaign soundings as a
// list with page thumbnails, checkboxes (all selected), a collapsed 'Not
// imported' block listing the dropped desk-study ids and duplicates once, an
// 'unknown' group the user can tick". Owner answer 2: desk-study reprints are
// named once — "Not imported, look these up yourself: GEO-22/040-S2, …".

import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { CptPdfDigest, CptPdfSounding } from '../../api/clients/cptPdf'
import CptPdfTriageList from './CptPdfTriageList'

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

function renderList(d: CptPdfDigest, selected: string[], onToggle = vi.fn(), onCalibrate = vi.fn()) {
  render(
    <CptPdfTriageList
      digest={d}
      projectId="p1"
      selected={new Set(selected)}
      edited={new Set()}
      onToggle={onToggle}
      onCalibrate={onCalibrate}
    />,
  )
  return { onToggle, onCalibrate }
}

describe('CptPdfTriageList', () => {
  it('lists every campaign sounding with a page thumbnail and a ticked box', () => {
    renderList(digest(), ['110', '7'])
    const rows = screen.getAllByTestId('cpt-pdf-row-campaign')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByRole('checkbox')).toBeChecked()
    const thumb = within(rows[0]).getByRole('img')
    expect(thumb.getAttribute('src')).toContain(`/cpt/pdf/page/${'a'.repeat(64)}/231.png`)
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
})
