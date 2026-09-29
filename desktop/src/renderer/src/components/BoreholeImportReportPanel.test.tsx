// The borehole import report — "flag everything that is weird" made visible.
//
// Rules: every file, every boring and every flag the backend raised is ON
// SCREEN (level, code, the backend's message naming the boring); a boring with
// nothing weird says so; a failed or declined file says why; "Copy report"
// puts the same content on the clipboard as plain text so it can be pasted
// into a mail or an issue.

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import BoreholeImportReportPanel, { formatImportReport } from './BoreholeImportReportPanel'
import type { BoreholeImportReportFile } from '../hooks/useBoreholeXmlImport'

const REPORT: BoreholeImportReportFile[] = [
  {
    fileName: 'boring van Smet GWT Europe.xml',
    outcome: 'imported',
    fileIssues: [],
    boreholes: [
      {
        borehole_id: 'S1',
        name: 'BGD024E0220',
        test_id: 'B/2004-106',
        has_errors: false,
        refreshed: false,
        imported: true,
        issues: [
          {
            level: 'warning',
            code: 'DEPTH_MISMATCH',
            message: 'BGD024E0220: total depth (diepte_tot) 44.00 m but the description ends at 47.00 m',
            rows: [],
          },
          {
            level: 'info',
            code: 'NAME_FROM_ALTERNATIVE',
            message: 'BGD024E0220: named by its alternative name',
            rows: [],
          },
        ],
      },
    ],
  },
  {
    fileName: 'GEO-25-110-B2onbewerkt.xml',
    outcome: 'imported',
    fileIssues: [],
    boreholes: [
      {
        borehole_id: 'B2',
        name: 'GEO-25/110-B2',
        test_id: 'X-B2',
        has_errors: false,
        refreshed: true,
        imported: true,
        issues: [],
      },
    ],
  },
  { fileName: 'broken.xml', outcome: 'failed', error: 'not a readable XML file', boreholes: [], fileIssues: [] },
  { fileName: 'B1.xml', outcome: 'declined', boreholes: [], fileIssues: [] },
]

afterEach(() => {
  vi.restoreAllMocks()
})

describe('BoreholeImportReportPanel', () => {
  it('shows every file, every boring and every flag with its code and message', () => {
    render(<BoreholeImportReportPanel report={REPORT} onClose={vi.fn()} />)
    expect(screen.getByText('boring van Smet GWT Europe.xml')).toBeTruthy()
    expect(screen.getByText('BGD024E0220')).toBeTruthy()
    expect(screen.getByText('DEPTH_MISMATCH')).toBeTruthy()
    expect(screen.getByText(/44\.00 m but the description ends at 47\.00 m/)).toBeTruthy()
    expect(screen.getByText('NAME_FROM_ALTERNATIVE')).toBeTruthy()
    expect(screen.getAllByTestId('import-flag')).toHaveLength(2)
  })

  it('says so when a boring has nothing weird, and tags a refreshed one', () => {
    render(<BoreholeImportReportPanel report={REPORT} onClose={vi.fn()} />)
    expect(screen.getByText('GEO-25/110-B2')).toBeTruthy()
    expect(screen.getByText('No flags')).toBeTruthy()
    expect(screen.getByText('refreshed')).toBeTruthy()
  })

  it('names why a file brought nothing: refused, or replacement declined', () => {
    render(<BoreholeImportReportPanel report={REPORT} onClose={vi.fn()} />)
    expect(screen.getByText(/File not imported: not a readable XML file/)).toBeTruthy()
    expect(screen.getByText(/replacement declined/)).toBeTruthy()
  })

  it('Copy report puts the whole report on the clipboard as text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<BoreholeImportReportPanel report={REPORT} onClose={vi.fn()} />)

    fireEvent.click(screen.getByTestId('borehole-import-report-copy'))

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    const text = writeText.mock.calls[0][0] as string
    expect(text).toContain('boring van Smet GWT Europe.xml')
    expect(text).toContain('BGD024E0220')
    expect(text).toContain('[Warning] DEPTH_MISMATCH')
    expect(text).toContain('44.00 m')
    await waitFor(() => expect(screen.getByText('Copied')).toBeTruthy())
  })

  it('Close closes', () => {
    const onClose = vi.fn()
    render(<BoreholeImportReportPanel report={REPORT} onClose={onClose} />)
    fireEvent.click(screen.getByTestId('borehole-import-report-close'))
    expect(onClose).toHaveBeenCalled()
  })

  it('renders nothing without a report', () => {
    render(<BoreholeImportReportPanel report={null} onClose={vi.fn()} />)
    expect(screen.queryByTestId('borehole-import-report')).toBeNull()
  })
})

describe('formatImportReport', () => {
  it('writes one line per file, boring and flag', () => {
    const text = formatImportReport(REPORT, key => key)
    const lines = text.split('\n')
    expect(lines[0]).toBe('boring van Smet GWT Europe.xml')
    expect(lines).toContain('  BGD024E0220')
    expect(lines.some(l => l.includes('NAME_FROM_ALTERNATIVE'))).toBe(true)
  })
})
