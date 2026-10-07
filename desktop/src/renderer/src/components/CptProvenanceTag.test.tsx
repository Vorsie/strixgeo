// A CPT read off a PDF report says so where its chart is shown (brief
// 2026-09-30: "find them on the map ... with 'pdf-digitised' provenance"). A
// GEF / DOV CPT carries no provenance and shows nothing extra.

import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { setLanguage } from '../i18n/languageSelect'

import CptProvenanceTag from './CptProvenanceTag'

describe('CptProvenanceTag', () => {
  afterEach(() => setLanguage('en'))

  it('names the report and the pages a digitised CPT was read from', () => {
    render(
      <CptProvenanceTag
        provenance={{
          source: 'pdf-digitised',
          report_file_name: 'camz-001.pdf',
          pages: [231, 232],
          digitiser_version: 'pdf-digitiser 1.0',
          depth_source: 'derived from plotted elevation',
        }}
      />,
    )
    const tag = screen.getByTestId('cpt-provenance-tag')
    expect(tag.textContent).toContain('camz-001.pdf')
    expect(tag.textContent).toContain('231')
    expect(tag.getAttribute('title')).toContain('pdf-digitiser 1.0')
    expect(tag.getAttribute('title')).toContain('derived from plotted elevation')
  })

  it('shows nothing for a CPT imported from a file', () => {
    const { container } = render(<CptProvenanceTag provenance={null} />)
    expect(container.textContent).toBe('')
  })

  // Owner 2026-10-04, reading the Data pane of sounding 110: "where is the
  // Voorboring note?" The drilled stretches of a digitised CPT are named on the
  // provenance line, one decimal, the same wording as the triage row's note.
  // Owner 2026-10-07: a stretch inside the sounding is "overboring"; only the
  // drilling from the surface to the first reading is "voorboring".
  it('names the drilled stretches after the pages', () => {
    render(
      <CptProvenanceTag
        provenance={{
          source: 'pdf-digitised',
          report_file_name: '23.15-RAP-002-2.4 Proefverslag CAMZ-001.pdf',
          pages: [235, 236],
          drilled_intervals_m: [[32.0, 32.3], [40.1, 40.94]],
          pre_drill_m: 0,
        }}
      />,
    )
    expect(screen.getByTestId('cpt-provenance-tag').textContent).toBe(
      'digitised from 23.15-RAP-002-2.4 Proefverslag CAMZ-001.pdf, p. 235, 236, drilled 32.0 to 32.3 m, 40.1 to 40.9 m',
    )
  })

  it('says nothing about drilling when the CPT has no drilled stretch', () => {
    render(
      <CptProvenanceTag
        provenance={{ source: 'pdf-digitised', report_file_name: 'r.pdf', pages: [235], drilled_intervals_m: [] }}
      />,
    )
    expect(screen.getByTestId('cpt-provenance-tag').textContent).toBe('digitised from r.pdf, p. 235')
  })

  it('reads in Dutch inside the Dutch app', () => {
    setLanguage('nl')
    render(
      <CptProvenanceTag
        provenance={{
          source: 'pdf-digitised',
          report_file_name: '23.15-RAP-002-2.4 Proefverslag CAMZ-001.pdf',
          pages: [235, 236],
          drilled_intervals_m: [[32.0, 32.3], [40.1, 40.9]],
        }}
      />,
    )
    expect(screen.getByTestId('cpt-provenance-tag').textContent).toBe(
      'gedigitaliseerd uit 23.15-RAP-002-2.4 Proefverslag CAMZ-001.pdf, blz. 235, 236, overboring 32.0 tot 32.3 m, 40.1 tot 40.9 m',
    )
  })
})
