// The borehole detail's "Lab tests" section (2026-09-29 brief): "listing each
// test (kind, sample, stages/specimens, reading counts, flags badge) and a
// viewer". It refetches when an import elsewhere reports a change.

import { act, fireEvent, render, screen, within } from '@testing-library/react'
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

import { notifyLabSeriesChanged } from '../../hooks/useLabSeriesRevision'
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
    source_file_name: '200568B7-LstSMControleListing.txt',
    n_specimens: 1,
    n_stages: 16,
    n_readings: 800,
    n_warnings: 2,
    n_errors: 0,
    ...overrides,
  }
}

describe('LabSeriesSection', () => {
  beforeEach(() => {
    listForBorehole.mockReset()
    getForSample.mockReset()
    deleteTest.mockReset()
  })

  it('lists each test with its kind, sample, counts and a flags badge', async () => {
    listForBorehole.mockResolvedValue([
      row(),
      row({ id: 't2', kind: 'triaxial', test_type_token: 'CD', n_specimens: 3, n_stages: 3, n_readings: 3402, n_warnings: 0 }),
    ])
    render(<LabSeriesSection projectId="p" boreholeId="bh" />)
    expect(await screen.findByText('Lab tests (2)')).toBeInTheDocument()
    const rows = screen.getAllByTestId('lab-series-row')
    expect(within(rows[0]).getByText('Oedometer')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Sample 14.40 to 14.90 m')).toBeInTheDocument()
    expect(within(rows[0]).getByText('1 specimen(s), 16 stage(s), 800 readings')).toBeInTheDocument()
    expect(within(rows[0]).getByText('2 warning(s), 0 error(s)')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Triaxial CD')).toBeInTheDocument()
    expect(within(rows[1]).getByText('No warnings')).toBeInTheDocument()
    expect(listForBorehole).toHaveBeenCalledWith('p', 'bh')
  })

  it('opens the readings viewer for a test', async () => {
    listForBorehole.mockResolvedValue([row()])
    getForSample.mockResolvedValue([])
    render(<LabSeriesSection projectId="p" boreholeId="bh" />)
    fireEvent.click(await screen.findByRole('button', { name: 'View readings' }))
    expect(await screen.findByTestId('lab-series-viewer')).toBeInTheDocument()
    expect(getForSample).toHaveBeenCalledWith('p', 's1')
  })

  it('says how to import when the borehole has no lab test', async () => {
    listForBorehole.mockResolvedValue([])
    render(<LabSeriesSection projectId="p" boreholeId="bh" />)
    fireEvent.click(await screen.findByText('Lab tests (0)'))
    expect(screen.getByText(/No raw lab tests on this borehole/)).toBeInTheDocument()
  })

  it('refetches after an import reports a change', async () => {
    listForBorehole.mockResolvedValue([])
    render(<LabSeriesSection projectId="p" boreholeId="bh" />)
    await screen.findByText('Lab tests (0)')
    listForBorehole.mockResolvedValue([row()])
    act(() => notifyLabSeriesChanged())
    expect(await screen.findByText('Lab tests (1)')).toBeInTheDocument()
  })

  // Owner 2026-10-04: "Verwijderen" on the lab test row; irreversible, so a
  // confirmation dialog with Cancel focused and the button "Delete lab test";
  // after the delete the list refreshes. No undo.
  describe('delete a lab test', () => {
    it('asks first: Cancel is focused and deletes nothing', async () => {
      listForBorehole.mockResolvedValue([row()])
      render(<LabSeriesSection projectId="p" boreholeId="bh" />)
      fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByRole('button', { name: 'Delete lab test' })).toBeInTheDocument()
      const cancel = within(dialog).getByRole('button', { name: 'Cancel' })
      expect(cancel).toHaveFocus()
      fireEvent.click(cancel)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(deleteTest).not.toHaveBeenCalled()
    })

    it('deletes on "Delete lab test", tells the parent and refreshes the list', async () => {
      listForBorehole.mockResolvedValue([row()])
      deleteTest.mockResolvedValue(undefined)
      const onDeleted = vi.fn()
      render(<LabSeriesSection projectId="p" boreholeId="bh" onLabTestDeleted={onDeleted} />)
      fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
      listForBorehole.mockResolvedValue([])
      fireEvent.click(
        within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete lab test' }),
      )
      expect(await screen.findByText('Lab tests (0)')).toBeInTheDocument()
      expect(deleteTest).toHaveBeenCalledWith('p', 't1')
      expect(onDeleted).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('a failed delete stays in the dialog with the reason and tells nobody', async () => {
      listForBorehole.mockResolvedValue([row()])
      deleteTest.mockRejectedValue(new Error('Lab test not found'))
      const onDeleted = vi.fn()
      render(<LabSeriesSection projectId="p" boreholeId="bh" onLabTestDeleted={onDeleted} />)
      fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
      const dialog = await screen.findByRole('dialog')
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete lab test' }))
      expect(await within(dialog).findByText(/Lab test not found/)).toBeInTheDocument()
      expect(onDeleted).not.toHaveBeenCalled()
    })
  })
})
