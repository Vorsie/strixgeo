// Owner 2026-10-04: a lab test deleted from the borehole's Lab tests list.
// The delete writes to the database, so after it (1) a toast says what was
// deleted, (2) the Data list refreshes (the borehole's flask icon follows its
// lab-test count) and (3) the project turns dirty, so File > Save writes the
// .strix WITHOUT the test — otherwise the reopen replace-restores the DB from
// the old file and the deleted test comes back.
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { LabSeriesTestSummary } from '../../../api/client'
import { ShellContext } from '../../ShellContext'
import { makeStubContext } from '../sections/__fixtures__/shellStub'

const boreholeLogProps: { onLabTestDeleted?: (row: LabSeriesTestSummary) => void }[] = []
vi.mock('../../../components/MapView', () => ({ default: () => null }))
vi.mock('../../../components/CptChart', () => ({ default: () => null }))
vi.mock('../../../components/DovImportProgressPanel', () => ({ default: () => null }))
vi.mock('../../../components/BoreholeLog', () => ({
  default: (props: { onLabTestDeleted?: (row: LabSeriesTestSummary) => void }) => {
    boreholeLogProps.push(props)
    return null
  },
}))

import DataCanvas from './DataCanvas'

afterEach(() => {
  cleanup()
  boreholeLogProps.length = 0
})

describe('DataCanvas: after a lab test is deleted', () => {
  it('toasts, refreshes the Data list and marks the project dirty', async () => {
    const ctx = makeStubContext()
    ctx.coordinator.selectedBoreholeId = 'bh-1'
    ctx.coordinator.view = 'chart'
    ctx.investigations.boreholeDetailMap = new Map([
      ['bh-1', { id: 'bh-1' } as never],
    ]) as typeof ctx.investigations.boreholeDetailMap
    const refreshBoreholeList = vi.fn(async () => {})
    ctx.investigations.refreshBoreholeList = refreshBoreholeList
    render(
      <ShellContext.Provider value={ctx}>
        <DataCanvas />
      </ShellContext.Provider>,
    )
    const onDeleted = boreholeLogProps.at(-1)?.onLabTestDeleted
    expect(onDeleted).toBeTypeOf('function')
    onDeleted!({ id: 't1', source_file_name: 'tx_cd.txt' } as LabSeriesTestSummary)
    await Promise.resolve()
    expect(ctx.toasts.toast).toHaveBeenCalledWith('success', 'Lab test tx_cd.txt deleted')
    expect(refreshBoreholeList).toHaveBeenCalled()
    expect(ctx.coordinator.markMutated).toHaveBeenCalled()
  })
})
