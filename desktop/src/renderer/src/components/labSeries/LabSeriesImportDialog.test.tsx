// The "Import lab tests (Geosys)" preview dialog. Owner Q4 (2026-09-29), in
// his words: "ask user, to double check, there should be a sample; if no,
// default create one; overlapping depths, yes same sample" — and "the borehole
// match itself (name ends with <job>-<borehole>) is shown in the preview and
// can be changed". A refresh of a stored test is irreversible: confirmation,
// Cancel focused, an action-named button (docs/ux.md).

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LabSeriesPreviewResponse } from '../../api/client'

const preview = vi.fn()
const doImport = vi.fn()
vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client')
  return {
    ...actual,
    api: {
      labSeries: {
        preview: (...a: unknown[]) => preview(...a),
        import: (...a: unknown[]) => doImport(...a),
      },
    },
  }
})

import { LabSeriesRefreshConfirmationRequiredError } from '../../api/client'
import LabSeriesImportDialog from './LabSeriesImportDialog'

const BOREHOLES = [
  { id: 'bh-7a', name: 'GEO-19/122-B7A' },
  { id: 'bh-8a', name: 'GEO-19/122-B8A' },
]

function pv(overrides: Partial<LabSeriesPreviewResponse> = {}): LabSeriesPreviewResponse {
  return {
    file_name: '200568B7-LstSMControleListing.txt',
    kind: 'oedometer',
    source_format: 'geosys_oed_control_listing',
    test_type_token: null,
    identity: {
      job_number: 'GEO-19/122',
      borehole_name: 'B7A',
      sequence_number: 'N002',
      sample_number: '20/0568',
      depth_top_m: 14.5,
      depth_base_m: 15,
      visual_description: 'zand',
    },
    specimens: [{ label: null, n_stages: 16, n_readings: 800 }],
    borehole_candidates: [{ id: 'bh-7a', name: 'GEO-19/122-B7A' }],
    borehole_match: 'unique',
    proposed_borehole_id: 'bh-7a',
    samples: [{ id: 's-1', depth_top_m: 14.4, depth_base_m: 14.9, sample_number: null }],
    proposed_sample_id: 's-1',
    sample_match: 'overlap',
    create_sample_default: { depth_top_m: 14.5, depth_base_m: 15, sample_number: '20/0568' },
    existing_test: null,
    issues: [{ level: 'info', code: 'SETTLEMENT_STEPS_BACK', message: 'stage 2: print rounding', rows: [] }],
    has_errors: false,
    ...overrides,
  }
}

const IMPORTED = {
  test_id: 't',
  sample_id: 's-1',
  kind: 'oedometer',
  created_sample: false,
  refreshed: false,
  unchanged: false,
  has_errors: false,
  issues: [],
}

function mount(files = ['C:/lab/200568B7-LstSMControleListing.txt']) {
  const onFinished = vi.fn()
  render(
    <LabSeriesImportDialog
      projectId="p"
      filePaths={files}
      boreholes={BOREHOLES}
      onFinished={onFinished}
    />,
  )
  return onFinished
}

describe('LabSeriesImportDialog', () => {
  beforeEach(() => {
    preview.mockReset()
    doImport.mockReset()
  })

  it('shows the lab identity, proposes the matched borehole and the overlapping sample, and imports onto it', async () => {
    preview.mockResolvedValue(pv())
    doImport.mockResolvedValue(IMPORTED)
    const onFinished = mount()
    expect(await screen.findByText('20/0568')).toBeInTheDocument()
    expect(screen.getByText('Matched by name. Change it if it is wrong.')).toBeInTheDocument()
    expect((screen.getByTestId('lab-import-borehole') as HTMLSelectElement).value).toBe('bh-7a')
    expect(screen.getByText('This sample overlaps the lab sampling depth.')).toBeInTheDocument()
    expect((screen.getByTestId('lab-import-sample-s-1') as HTMLInputElement).checked).toBe(true)
    expect(screen.getByText(/SETTLEMENT_STEPS_BACK/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    await waitFor(() => expect(onFinished).toHaveBeenCalled())
    expect(doImport).toHaveBeenCalledWith('C:/lab/200568B7-LstSMControleListing.txt', 'p', {
      boreholeId: 'bh-7a',
      sampleId: 's-1',
      createSample: false,
      sampleDepthTopM: null,
      sampleDepthBaseM: null,
      confirmRefresh: false,
    })
    expect(onFinished.mock.calls[0][0]).toMatchObject({ imported: 1, touchedBoreholeIds: ['bh-7a'] })
  })

  it('with no overlapping sample, defaults to creating one with the lab interval', async () => {
    preview.mockResolvedValue(pv({ proposed_sample_id: null, sample_match: 'none' }))
    doImport.mockResolvedValue({ ...IMPORTED, created_sample: true })
    mount()
    expect(
      await screen.findByText('No sample overlaps the lab sampling depth. A new sample will be created.'),
    ).toBeInTheDocument()
    expect((screen.getByTestId('lab-import-create-sample') as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    await waitFor(() => expect(doImport).toHaveBeenCalled())
    expect(doImport.mock.calls.at(-1)![2]).toMatchObject({ createSample: true, sampleId: null })
  })

  it('re-previews with the borehole the user picks, so its samples are offered', async () => {
    preview.mockResolvedValue(pv())
    mount()
    const select = await screen.findByTestId('lab-import-borehole')
    fireEvent.change(select, { target: { value: 'bh-8a' } })
    await waitFor(() => expect(preview).toHaveBeenLastCalledWith(expect.any(String), 'p', 'bh-8a'))
  })

  it('an export with no sampling depth needs the new sample interval before it imports', async () => {
    preview.mockResolvedValue(
      pv({
        identity: { ...pv().identity, borehole_name: null, depth_top_m: null, depth_base_m: null },
        borehole_match: 'none',
        proposed_borehole_id: null,
        samples: [],
        proposed_sample_id: null,
        sample_match: 'none',
        create_sample_default: null,
      }),
    )
    doImport.mockResolvedValue({ ...IMPORTED, created_sample: true })
    mount()
    expect(await screen.findByText('No borehole matches. Pick one.')).toBeInTheDocument()
    const importButton = screen.getByRole('button', { name: 'Import' })
    expect(importButton).toBeDisabled()
    fireEvent.change(screen.getByTestId('lab-import-borehole'), { target: { value: 'bh-7a' } })
    await waitFor(() => expect(preview).toHaveBeenLastCalledWith(expect.any(String), 'p', 'bh-7a'))
    fireEvent.change(screen.getByLabelText('Top (m)'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('Base (m)'), { target: { value: '3.2' } })
    expect(screen.getByRole('button', { name: 'Import' })).not.toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    await waitFor(() => expect(doImport).toHaveBeenCalled())
    expect(doImport.mock.calls.at(-1)![2]).toMatchObject({
      boreholeId: 'bh-7a',
      createSample: true,
      sampleDepthTopM: 3,
      sampleDepthBaseM: 3.2,
    })
  })

  it('asks before it replaces a stored test (Cancel focused) and re-posts with the consent', async () => {
    preview.mockResolvedValue(pv({ existing_test: { id: 't', sample_id: 's-1', same_content: false } }))
    doImport
      .mockImplementationOnce(() => {
        const p = Promise.reject(
          new LabSeriesRefreshConfirmationRequiredError({
            testId: 't',
            oldNSpecimens: 1,
            newNSpecimens: 1,
            oldNReadings: 800,
            newNReadings: 799,
            oldSourceFileName: 'a.txt',
            newSourceFileName: 'b.txt',
          }),
        )
        p.catch(() => {})
        return p
      })
      .mockResolvedValueOnce({ ...IMPORTED, refreshed: true })
    const onFinished = mount()
    expect(await screen.findByText(/Importing replaces its readings/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    expect(await screen.findByText('Replace the stored lab test?')).toBeInTheDocument()
    expect(document.activeElement?.textContent).toBe('Cancel')
    fireEvent.click(screen.getByRole('button', { name: 'Replace readings' }))
    await waitFor(() => expect(onFinished).toHaveBeenCalled())
    expect(doImport.mock.calls[1][2]).toMatchObject({ confirmRefresh: true })
    expect(onFinished.mock.calls[0][0]).toMatchObject({ replaced: 1 })
  })

  it('walks several files one by one; Skip moves on without writing', async () => {
    preview.mockResolvedValue(pv())
    doImport.mockResolvedValue(IMPORTED)
    const onFinished = mount(['C:/a.txt', 'C:/b.txt'])
    expect(await screen.findByText('File 1 of 2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Skip this file' }))
    expect(await screen.findByText('File 2 of 2')).toBeInTheDocument()
    await screen.findByText('20/0568')
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    await waitFor(() => expect(onFinished).toHaveBeenCalled())
    expect(doImport).toHaveBeenCalledTimes(1)
    expect(onFinished.mock.calls[0][0]).toMatchObject({ imported: 1, skipped: 1 })
  })

  it('a triaxial export says it has no time channel', async () => {
    preview.mockResolvedValue(pv({ kind: 'triaxial', test_type_token: 'CD' }))
    mount()
    expect(await screen.findByText(/The triaxial export has no time channel/)).toBeInTheDocument()
  })
})
