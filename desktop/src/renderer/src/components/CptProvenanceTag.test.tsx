// A CPT read off a PDF report says so where its chart is shown (brief
// 2026-09-30: "find them on the map ... with 'pdf-digitised' provenance"). A
// GEF / DOV CPT carries no provenance and shows nothing extra.

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import CptProvenanceTag from './CptProvenanceTag'

describe('CptProvenanceTag', () => {
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
})
