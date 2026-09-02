import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SectionSheet } from './SectionSheet'
import type { SheetPayload } from './sheetPayload'

function payload(): SheetPayload {
  return {
    language: 'nl',
    section: { id: 's1', name: 'CS1', epsg: 31370, lengthM: 400, startX: 0, startY: 0, endX: 400, endY: 0, viewState: null },
    columns: [
      { investigationId: 'c1', kind: 'cpt', name: 'GEO-16/095-S6', code: 'S6', projectKey: 'GEO-16/095', colourIndex: 0, alongM: 0, collarElevationM: 5, totalDepthM: 20, cptType: 'CPTU', plot: null, detail: null },
      { investigationId: 'c2', kind: 'cpt', name: 'GEO-16/095-S5', code: 'S5', projectKey: 'GEO-16/095', colourIndex: 0, alongM: 400, collarElevationM: 4, totalDepthM: 18, cptType: 'CPTU', plot: null, detail: null },
    ],
    regions: [
      { formation_id: 'f-sand', body_id: 'b1', gap_index: 0, polygon: [[0, 5], [1, 4], [1, -3], [0, -2]] },
      { formation_id: 'f-clay', body_id: 'b2', gap_index: 0, polygon: [[0, -2], [1, -3], [1, -15], [0, -15]] },
    ],
    units: [
      { formationId: 'f-sand', name: 'ZAND · Quartair', colour: '#e8c26a', displayOrder: 1 },
      { formationId: 'f-clay', name: 'KLEI · Quartair', colour: '#9db7c9', displayOrder: 2 },
    ],
    levelMaxM: 5.5, levelMinM: -15.5,
    map: { basemapId: 'osm', points: [], legend: [{ projectKey: 'GEO-16/095', colourIndex: 0, codes: ['S6', 'S5'] }] },
    settings: {
      fill: 'litho', scaleMode: 'fit', hScale: null, vScale: null, vex: 5, spacing: 1,
      fields: [{ label: 'Project', value: 'Kaai 1712' }, { label: 'Profiel', value: 'CS1' }, { label: 'Opdrachtgever', value: '' }, { label: 'Datum · Auteur', value: '2026-09-02' }],
    },
  }
}

describe('SectionSheet — the printed sheet is the on-screen partition', () => {
  it('draws one path per region, in unit colour, with no white column mask', () => {
    render(<SectionSheet payload={payload()} map={<div data-testid="map-slot" />} />)
    const paths = screen.getAllByTestId('sheet-region')
    expect(paths).toHaveLength(2)
    expect(paths[0]).toHaveAttribute('fill', '#e8c26a')
    expect(screen.queryAllByTestId('sheet-column-mask')).toHaveLength(0)
  })
  it('labels the ends A and A′ and the columns by short code', () => {
    render(<SectionSheet payload={payload()} map={<div />} />)
    expect(screen.getByText('A')).toBeInTheDocument()
    expect(screen.getByText('A′')).toBeInTheDocument()
    expect(screen.getByText('S6')).toBeInTheDocument()
  })
  it('renders the four fields, the scale line and the unit legend', () => {
    render(<SectionSheet payload={payload()} map={<div />} />)
    expect(screen.getByText('Kaai 1712')).toBeInTheDocument()
    expect(screen.getByText('Opdrachtgever')).toBeInTheDocument()
    expect(screen.getByTestId('sheet-scale-line').textContent).toMatch(/H 1:\d+/)
    // The unit name appears both inside its region fill and in the legend
    // (both are spec requirements); assert the legend copy specifically.
    const legend = screen.getByTestId('sheet-unit-legend')
    expect(within(legend).getByText('KLEI · Quartair')).toBeInTheDocument()
  })
  it('sizes the page to the computed paper: a short profile floors at A3, fit mode is A3 high', () => {
    // A short profile still gets a full A3 width (spec "Paper"); fit mode is A3
    // high. (The plan's 400 m payload was narrowed here — at vex 5 that profile
    // is ~1092 mm wide, so it could not exercise the 420 mm floor the assertion
    // is about.)
    const p = payload()
    p.columns[1] = { ...p.columns[1], alongM: 40 }
    render(<SectionSheet payload={p} map={<div />} />)
    const page = screen.getByTestId('sheet-page')
    expect(page.style.width).toBe('420mm')
    expect(page.style.height).toBe('297mm')
  })
})
