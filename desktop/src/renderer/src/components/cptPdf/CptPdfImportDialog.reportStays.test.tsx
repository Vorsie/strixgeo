// Owner finding 2026-10-04: "import report disappears automatically, a bit too
// fast". After "Import selected (2)" the report of what happened to each
// sounding is the thing the engineer reads; it stays on screen, with every
// row, until HE clicks Close. The app booking the import (toast, list
// refetch, the first new CPT selected) must not take it away.

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CptPdfDigest, CptPdfImportResult, CptPdfSounding } from '../../api/clients/cptPdf'

const importSoundings = vi.fn()
vi.mock('../../api/clients/cptPdf', async () => {
  const actual = await vi.importActual<typeof import('../../api/clients/cptPdf')>('../../api/clients/cptPdf')
  return {
    ...actual,
    cptPdfClient: { ...actual.cptPdfClient, importSoundings: (b: unknown) => importSoundings(b) },
  }
})

const triageState: { current: unknown } = { current: { status: 'idle' } }
vi.mock('../../hooks/useCptPdfTriage', () => ({
  useCptPdfTriage: () => ({ state: triageState.current, start: vi.fn(), reset: vi.fn() }),
}))

import { useCptPdfImport } from '../../hooks/useCptPdfImport'
import CptPdfImportDialog from './CptPdfImportDialog'

function sounding(key: string): CptPdfSounding {
  return {
    key,
    sounding_id: key,
    origin: 'campaign',
    page_numbers: [235],
    sheet_count: 1,
    graph_kind: 'vector',
    profile_name: 'van-der-straaten',
    ground_level_m: 6.05,
    z_epsg: 5710,
    x: 1,
    y: 2,
    epsg: 31370,
    test_date: null,
    curves: ['qc'],
    clipped_points: 0,
    digitised: true,
    warnings: [],
  }
}

const DIGEST: CptPdfDigest = {
  file_sha: 'b'.repeat(64),
  page_count: 300,
  class_counts: {},
  campaign: [sounding('110'), sounding('112')],
  unknown: [],
  dropped: [],
  desk_study_ids: [],
  report_code: 'CAMZ-001',
  campaign_codes: ['CAMZ-001'],
  project_numbers: [],
  ocr_available: true,
  raster_pages_unread: 0,
  profiles: [],
}

function imported(key: string): CptPdfImportResult {
  return {
    sounding_id: key,
    status: 'imported',
    name: key,
    cpt_id: `cpt-${key}`,
    code: null,
    message: null,
    diff: null,
    issues: [],
  }
}

/** The App's own wiring of the dialog; the booking deps re-render the parent like App's do. */
function Harness({ toast }: { toast: (type: string, message: string) => void }): JSX.Element {
  const [, setList] = useState<string[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { pdfImport, handleImportCptPdf, closePdfImport, handlePdfImported } = useCptPdfImport({
    project: { id: 'p1' },
    toast,
    refreshList: async () => setList(prev => [...prev, 'refetched']),
    unhideCpts: () => undefined,
    addToManifest: () => undefined,
    setSessionImportCptIds: () => undefined,
    markMutated: () => undefined,
    setSelectedId,
  })
  return (
    <>
      <button type="button" data-testid="menu-import-pdf" onClick={() => void handleImportCptPdf()} />
      <span data-testid="selected">{selectedId ?? ''}</span>
      {pdfImport && (
        <CptPdfImportDialog
          open
          filePath={pdfImport.filePath}
          projectId="p1"
          onClose={closePdfImport}
          onImported={(results, fileName) => void handlePdfImported(results, fileName)}
        />
      )}
    </>
  )
}

beforeEach(() => {
  window.electron = { ...(window.electron ?? {}), openFile: vi.fn(async () => 'C:/r/camz-001.pdf') } as never
  importSoundings.mockReset()
  triageState.current = { status: 'done', digest: DIGEST }
})

describe('the PDF import report stays until the user closes it', () => {
  it('after the app has booked two imported soundings, the report with both rows is still on screen', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      importSoundings.mockResolvedValue({ results: [imported('110'), imported('112')] })
      const toast = vi.fn()
      render(<Harness toast={toast} />)
      fireEvent.click(screen.getByTestId('menu-import-pdf'))
      fireEvent.click(await screen.findByTestId('cpt-pdf-import'))
      // The app has booked it: toast said, list refetched, first new CPT selected.
      await waitFor(() => expect(screen.getByTestId('selected').textContent).toBe('cpt-110'))
      expect(toast).toHaveBeenCalledTimes(1)
      // Long after any toast would have expired, nobody clicked Close.
      await act(async () => {
        vi.advanceTimersByTime(30_000)
      })
      expect(screen.getByTestId('cpt-pdf-import-report')).toBeTruthy()
      expect(screen.getAllByTestId('cpt-pdf-report-row').map(r => r.textContent?.slice(0, 3))).toEqual(['110', '112'])
      // ...and it goes when the user closes it, not before.
      fireEvent.click(screen.getByText('Close'))
      expect(screen.queryByTestId('cpt-pdf-import-report')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
