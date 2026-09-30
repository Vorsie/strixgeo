// The lab import's report and a borehole fetched from DOV (owner 2026-09-30:
// "Can't we just auto load from DOV when trying to load a lab tests"). When the
// import dialog finishes, the toast lists the boreholes fetched from DOV and
// those boreholes join the investigation list the way a bbox import's do.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { LabSeriesImportSummary } from '../../../components/labSeries/LabSeriesImportDialog'

const SUMMARY: LabSeriesImportSummary = {
  imported: 1,
  replaced: 0,
  unchanged: 0,
  skipped: 0,
  failed: 0,
  touchedBoreholeIds: ['bh-dov'],
  dovFetched: [{ id: 'bh-dov', name: '1445-GEO-25/022-B17' }],
}

vi.mock('../../../components/labSeries/LabSeriesImportDialog', () => ({
  default: ({ onFinished }: { onFinished: (s: LabSeriesImportSummary) => void }) => (
    <button type="button" onClick={() => onFinished(SUMMARY)}>
      finish
    </button>
  ),
}))

import { ShellContext } from '../../ShellContext'
import DataToolbar from './DataToolbar'

describe('DataToolbar — lab import report', () => {
  it('the toast lists the boreholes fetched from DOV and they join the list', async () => {
    const toast = vi.fn()
    const adopt = vi.fn(async () => {})
    const markMutated = vi.fn()
    const value = {
      project: { id: 'p' },
      visibleBoreholes: [],
      toasts: { toast },
      coordinator: { markMutated },
      investigations: {
        importing: false,
        dovImporting: false,
        bboxImportType: null,
        handleImportCpt: () => {},
        handleImportDov: () => {},
        handleImportBoreholeDov: () => {},
        loadBoreholeDetail: async () => {},
        adoptImportedBoreholes: adopt,
      },
    }
    ;(window as unknown as { electron: unknown }).electron = {
      openFiles: async () => ['C:/lab/tx_cd.txt'],
    }
    render(
      <ShellContext.Provider value={value as never}>
        <DataToolbar />
      </ShellContext.Provider>,
    )
    fireEvent.click(screen.getByRole('button', { name: /Import/ }))
    fireEvent.click(within(screen.getByRole('menu')).getByText('Import lab tests'))
    fireEvent.click(await screen.findByRole('button', { name: 'finish' }))
    await waitFor(() => expect(toast).toHaveBeenCalled())
    expect(toast.mock.calls[0][1]).toContain('Boreholes fetched from DOV: 1445-GEO-25/022-B17')
    expect(adopt).toHaveBeenCalledWith(['bh-dov'])
    expect(markMutated).toHaveBeenCalled()
  })
})
