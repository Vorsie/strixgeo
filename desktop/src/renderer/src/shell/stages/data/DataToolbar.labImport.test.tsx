// The lab import's report and a borehole fetched from DOV (owner 2026-09-30:
// "Can't we just auto load from DOV when trying to load a lab tests"). When the
// import dialog finishes, the toast names the boreholes fetched from DOV and
// those boreholes join the investigation list the way a bbox import's do.
//
// Owner dogfeed 2026-10-04: "there is no B7A in testproject_dev? where can i
// see them" — the preview fetched 1411-GEO-19/122-B7A from DOV, the tests were
// attached to it, but the Data list kept its old borehole count. A fetched
// borehole must appear in the list (refetched, marked new, selected), and any
// written import refetches the list (the borehole's lab-test count changed).

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { LabSeriesImportSummary } from '../../../components/labSeries/LabSeriesImportDialog'

let summary: LabSeriesImportSummary

vi.mock('../../../components/labSeries/LabSeriesImportDialog', () => ({
  default: ({ onFinished }: { onFinished: (s: LabSeriesImportSummary) => void }) => (
    <button type="button" onClick={() => onFinished(summary)}>
      finish
    </button>
  ),
}))

import { ShellContext } from '../../ShellContext'
import DataToolbar from './DataToolbar'

function makeSummary(over: Partial<LabSeriesImportSummary>): LabSeriesImportSummary {
  return {
    imported: 0,
    replaced: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
    touchedBoreholeIds: [],
    dovFetched: [],
    ...over,
  }
}

/** Render the toolbar on a stub bus, run the lab import, return the spies. */
async function runImport(s: LabSeriesImportSummary) {
  summary = s
  const toast = vi.fn()
  const adopt = vi.fn(async () => {})
  const refreshBoreholeList = vi.fn(async () => {})
  const markMutated = vi.fn()
  const setSelectedBoreholeId = vi.fn()
  const value = {
    project: { id: 'p' },
    visibleBoreholes: [],
    toasts: { toast },
    coordinator: { markMutated, setSelectedBoreholeId },
    investigations: {
      importing: false,
      dovImporting: false,
      bboxImportType: null,
      handleImportCpt: () => {},
      handleImportDov: () => {},
      handleImportBoreholeDov: () => {},
      loadBoreholeDetail: async () => {},
      refreshBoreholeList,
      adoptImportedBoreholes: adopt,
    },
  }
  ;(window as unknown as { electron: unknown }).electron = {
    openFiles: async () => ['C:/lab/oed.txt'],
  }
  render(
    <ShellContext.Provider value={value as never}>
      <DataToolbar />
    </ShellContext.Provider>,
  )
  fireEvent.click(screen.getByRole('button', { name: /Import/ }))
  fireEvent.click(within(screen.getByRole('menu')).getByText('Lab tests'))
  fireEvent.click(await screen.findByRole('button', { name: 'finish' }))
  await waitFor(() => expect(toast).toHaveBeenCalled())
  return { toast, adopt, refreshBoreholeList, markMutated, setSelectedBoreholeId }
}

describe('DataToolbar — lab import report', () => {
  it('a borehole fetched from DOV is named in the toast, joins the list and is selected', async () => {
    const spies = await runImport(
      makeSummary({
        imported: 1,
        touchedBoreholeIds: ['bh-b7a'],
        dovFetched: [{ id: 'bh-b7a', name: '1411-GEO-19/122-B7A' }],
      }),
    )
    expect(spies.toast.mock.calls[0][1]).toContain('Borehole 1411-GEO-19/122-B7A fetched from DOV')
    expect(spies.adopt).toHaveBeenCalledWith(['bh-b7a'])
    expect(spies.setSelectedBoreholeId).toHaveBeenCalledWith('bh-b7a')
    expect(spies.markMutated).toHaveBeenCalled()
  })

  it('several fetched boreholes are listed together and all join the list', async () => {
    const spies = await runImport(
      makeSummary({
        imported: 2,
        dovFetched: [
          { id: 'a', name: 'GEO-1-B1' },
          { id: 'b', name: 'GEO-1-B2' },
        ],
      }),
    )
    expect(spies.toast.mock.calls[0][1]).toContain('Boreholes fetched from DOV: GEO-1-B1, GEO-1-B2')
    expect(spies.adopt).toHaveBeenCalledWith(['a', 'b'])
  })

  it('a written import without a DOV fetch still refetches the borehole list (lab-test count changed)', async () => {
    const spies = await runImport(makeSummary({ imported: 1, touchedBoreholeIds: ['bh-1'] }))
    await waitFor(() => expect(spies.refreshBoreholeList).toHaveBeenCalledTimes(1))
    expect(spies.adopt).not.toHaveBeenCalled()
    expect(spies.setSelectedBoreholeId).not.toHaveBeenCalled()
  })

  it('nothing written and nothing fetched: the list is not refetched', async () => {
    const spies = await runImport(makeSummary({ skipped: 1 }))
    expect(spies.refreshBoreholeList).not.toHaveBeenCalled()
    expect(spies.adopt).not.toHaveBeenCalled()
  })
})
