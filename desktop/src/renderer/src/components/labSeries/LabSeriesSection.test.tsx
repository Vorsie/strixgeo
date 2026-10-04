// The sample slide-in's "Raw tests" block (owner ruling 2026-10-04, option
// a). It lists the raw tests it is handed (the borehole log fetches once per
// borehole and groups by sample) with a flags badge, opens the readings
// viewer per test, and deletes behind a ConfirmDialog. The block itself never
// fetches the list.

import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LabSeriesTestSummary } from '../../api/client'

const listForBorehole = vi.fn()
const getForSample = vi.fn()
const deleteTest = vi.fn()
vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client')
  return {
    ...actual,
    api: {
      labSeries: {
        listForBorehole: (...a: unknown[]) => listForBorehole(...a),
        getForSample: (...a: unknown[]) => getForSample(...a),
        deleteTest: (...a: unknown[]) => deleteTest(...a),
      },
    },
  }
})

import LabSeriesSection from './LabSeriesSection'

function row(overrides: Partial<LabSeriesTestSummary> = {}): LabSeriesTestSummary {
  return {
    id: 't1',
    sample_id: 's1',
    sample_depth_top_m: 14.4,
    sample_depth_base_m: 14.9,
    sample_number: null,
    kind: 'oedometer',
    test_type_token: null,
    lab_sample_number: '20/0568',
    source_file_name: '200568B7-oed.txt',
    n_specimens: 1,
    n_stages: 16,
    n_readings: 800,
    n_warnings: 2,
    n_errors: 0,
    test_start_date: null,
    ...overrides,
  }
}

describe('LabSeriesSection (the raw tests of one sample)', () => {
  beforeEach(() => {
    listForBorehole.mockReset()
    getForSample.mockReset()
    deleteTest.mockReset()
  })

  it('lists each test with a flags badge and never fetches the list itself', () => {
    render(
      <LabSeriesSection
        projectId="p"
        tests={[row(), row({ id: 't2', kind: 'triaxial', test_type_token: 'CD', n_warnings: 0 })]}
      />,
    )
    expect(screen.getByText('Raw tests (2)')).toBeInTheDocument()
    const rows = screen.getAllByTestId('lab-series-row')
    expect(within(rows[0]).getByText('2 warning(s), 0 error(s)')).toBeInTheDocument()
    expect(within(rows[1]).getByText('No warnings')).toBeInTheDocument()
    expect(listForBorehole).not.toHaveBeenCalled()
  })

  // Owner 2026-10-04: "Verwijderen" on the lab test row; irreversible, so a
  // confirmation dialog with Cancel focused and the button "Delete lab test".
  // No undo.
  describe('delete a lab test', () => {
    it('asks first: Cancel is focused and deletes nothing', async () => {
      render(<LabSeriesSection projectId="p" tests={[row()]} />)
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByRole('button', { name: 'Delete lab test' })).toBeInTheDocument()
      const cancel = within(dialog).getByRole('button', { name: 'Cancel' })
      expect(cancel).toHaveFocus()
      fireEvent.click(cancel)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(deleteTest).not.toHaveBeenCalled()
    })

    it('deletes on "Delete lab test" and tells the parent', async () => {
      deleteTest.mockResolvedValue(undefined)
      const onDeleted = vi.fn()
      render(<LabSeriesSection projectId="p" tests={[row()]} onLabTestDeleted={onDeleted} />)
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
      fireEvent.click(
        within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete lab test' }),
      )
      await vi.waitFor(() => expect(onDeleted).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' })))
      expect(deleteTest).toHaveBeenCalledWith('p', 't1')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('a failed delete stays in the dialog with the reason and tells nobody', async () => {
      deleteTest.mockRejectedValue(new Error('Lab test not found'))
      const onDeleted = vi.fn()
      render(<LabSeriesSection projectId="p" tests={[row()]} onLabTestDeleted={onDeleted} />)
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
      const dialog = await screen.findByRole('dialog')
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete lab test' }))
      expect(await within(dialog).findByText(/Lab test not found/)).toBeInTheDocument()
      expect(onDeleted).not.toHaveBeenCalled()
    })
  })
})
