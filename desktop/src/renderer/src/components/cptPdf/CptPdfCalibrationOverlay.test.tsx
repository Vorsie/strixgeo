// The calibration overlay (brief 2026-09-30, piece C): "the page image with the
// orange digitised curve drawn over it (the overlay PNG from the backend), the
// frame corners draggable, the two tick values per axis editable (numbers), the
// panel kind selectable, a curve-colour eyedropper for scans (click the image →
// RGB → re-extract), a 'Re-extract' that posts the calibration dict, the
// assumptions listed, the clipped-point count, XY/Z/date editable when not read".

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CptPdfDigitised, CptPdfSounding, PageCalibrationDict } from '../../api/clients/cptPdf'
import { setLanguage } from '../../i18n/languageSelect'

const digitise = vi.fn()
vi.mock('../../api/clients/cptPdf', async () => {
  const actual = await vi.importActual<typeof import('../../api/clients/cptPdf')>('../../api/clients/cptPdf')
  return { ...actual, cptPdfClient: { ...actual.cptPdfClient, digitise: (b: unknown) => digitise(b) } }
})

import CptPdfCalibrationOverlay from './CptPdfCalibrationOverlay'

const SHA = 'a'.repeat(64)
const DPI = 144 // two overlay pixels per PDF point

function calibration(): PageCalibrationDict {
  return {
    page_number: 231,
    coordinate_space: 'pdf-pt',
    dpi: null,
    depth_reference: 'depth',
    panels: [
      {
        kind: 'qc',
        frame: { x0: 60, y0: 90, x1: 300, y1: 790 },
        value_scale: { coord_a: 60, value_a: 0, coord_b: 300, value_b: 20, max_residual: 0 },
        depth_scale: { coord_a: 90, value_a: 0, coord_b: 790, value_b: 14, max_residual: 0 },
        unit: 'MPa',
        to_storage_factor: 1,
        curve_colour: [0, 0, 1],
        source: 'text-layer',
        assumptions: ['qc labels read from the text layer'],
      },
    ],
    ground_level_m: 6.02,
    sounding_id: '110',
    profile_name: 'van-der-straaten',
    assumptions: ['depth axis in m below ground'],
  }
}

function answer(cal = calibration()): CptPdfDigitised {
  return {
    sounding_id: '110',
    page_numbers: [231],
    series: { depth_m: [1, 1.02], qc_mpa: [3, 32], qc_clipped: [false, true] },
    sampling: 'vector vertices (no resampling)',
    calibrations: [cal],
    assumptions: ['depth axis in m below ground', 'qc labels read from the text layer'],
    clipped_count: 1,
    printed_values: [[1.02, '38.10']],
    header: { x: null, y: null, epsg: null, ground_level_m: 6.02, z_epsg: 5710, test_date: '28-2-2024' },
    warnings: ['no position printed: type X and Y before importing'],
    overlays: [{ page_number: 231, dpi: DPI, width: 1190, height: 1684, png_base64: 'iVBORw0KGgo=' }],
  }
}

function sounding(): CptPdfSounding {
  return {
    key: '110',
    sounding_id: '110',
    origin: 'campaign',
    page_numbers: [231],
    sheet_count: 1,
    graph_kind: 'vector',
    profile_name: 'van-der-straaten',
    ground_level_m: 6.02,
    z_epsg: 5710,
    x: null,
    y: null,
    epsg: null,
    test_date: '28-2-2024',
    curves: ['qc'],
    clipped_points: 1,
    digitised: true,
    warnings: [],
  }
}

function renderOverlay(onDone = vi.fn(), samplePixel = vi.fn(() => [255, 0, 51] as [number, number, number])) {
  render(
    <CptPdfCalibrationOverlay
      projectId="p1"
      fileSha={SHA}
      sounding={sounding()}
      initial={{}}
      onDone={onDone}
      onBack={vi.fn()}
      samplePixel={samplePixel}
    />,
  )
  return { onDone, samplePixel }
}

beforeEach(() => {
  digitise.mockReset()
  digitise.mockImplementation(async (body: { calibrations?: PageCalibrationDict[] }) =>
    answer(body.calibrations?.[0] ?? calibration()),
  )
})

describe('CptPdfCalibrationOverlay', () => {
  afterEach(() => setLanguage('en'))

  it('names what it is for: "Check the axes of sounding 110", with a one-line how-to under the title', () => {
    renderOverlay()
    expect(screen.getByRole('heading').textContent).toBe('Check the axes of sounding 110')
    expect(screen.getByTestId('cpt-pdf-overlay-intro').textContent).toBe(
      'Drag the frame corners onto the printed axes and type the value at two tick marks per axis, then Read again.',
    )
  })

  it('in Dutch the title and the how-to read in Dutch', () => {
    setLanguage('nl')
    renderOverlay()
    expect(screen.getByRole('heading').textContent).toBe('Assen van sondering 110 controleren')
    expect(screen.getByTestId('cpt-pdf-overlay-intro').textContent).toBe(
      'Sleep de hoeken van het kader op de gedrukte assen en typ de waarde bij twee maatstrepen per as, lees dan opnieuw af.',
    )
  })

  it('reads the sounding through the digitiser\'s own calibration and shows the overlay', async () => {
    renderOverlay()
    await screen.findByTestId('cpt-pdf-overlay-image')
    expect(digitise).toHaveBeenCalledWith({ project_id: 'p1', file_sha: SHA, sounding_id: '110' })
    expect(screen.getByTestId('cpt-pdf-overlay-image').getAttribute('src')).toBe(
      'data:image/png;base64,iVBORw0KGgo=',
    )
  })

  it('lists the assumptions and the clipped-point count', async () => {
    renderOverlay()
    await screen.findByTestId('cpt-pdf-overlay-image')
    expect(screen.getByTestId('cpt-pdf-assumptions').textContent).toContain('qc labels read from the text layer')
    expect(screen.getByTestId('cpt-pdf-clipped').textContent).toContain('1')
  })

  it('dragging a frame corner changes the frame that Re-extract posts', async () => {
    renderOverlay()
    await screen.findByTestId('cpt-pdf-overlay-image')
    const handle = screen.getByTestId('cpt-pdf-corner-0-bottom-right')
    fireEvent.mouseDown(handle, { clientX: 600, clientY: 1580 })
    // 20 image px right and down = 10 PDF points at 144 dpi.
    fireEvent.mouseMove(window, { clientX: 620, clientY: 1600 })
    fireEvent.mouseUp(window, { clientX: 620, clientY: 1600 })
    fireEvent.click(screen.getByTestId('cpt-pdf-reextract'))
    await waitFor(() => expect(digitise).toHaveBeenCalledTimes(2))
    const posted = digitise.mock.calls[1][0].calibrations[0].panels[0].frame
    expect(posted).toEqual({ x0: 60, y0: 90, x1: 310, y1: 800 })
  })

  it('typed tick values change the scale that Re-extract posts', async () => {
    renderOverlay()
    await screen.findByTestId('cpt-pdf-overlay-image')
    const tickB = screen.getByTestId('cpt-pdf-value-tick-b')
    fireEvent.focus(tickB)
    fireEvent.change(tickB, { target: { value: '32' } })
    fireEvent.click(screen.getByTestId('cpt-pdf-reextract'))
    await waitFor(() => expect(digitise).toHaveBeenCalledTimes(2))
    expect(digitise.mock.calls[1][0].calibrations[0].panels[0].value_scale).toMatchObject({
      value_a: 0,
      value_b: 32,
    })
  })

  it('the eyedropper takes the clicked pixel as the curve colour and re-extracts', async () => {
    const { samplePixel } = renderOverlay()
    await screen.findByTestId('cpt-pdf-overlay-image')
    fireEvent.click(screen.getByTestId('cpt-pdf-eyedropper'))
    fireEvent.click(screen.getByTestId('cpt-pdf-overlay-surface'), { clientX: 200, clientY: 400 })
    expect(samplePixel).toHaveBeenCalled()
    await waitFor(() => expect(digitise).toHaveBeenCalledTimes(2))
    expect(digitise.mock.calls[1][0].calibrations[0].panels[0].curve_colour).toEqual([1, 0, 0.2])
  })

  it('asks for the position the sheet did not print and hands it back with the calibration', async () => {
    const { onDone } = renderOverlay()
    await screen.findByTestId('cpt-pdf-overlay-image')
    for (const [id, value] of [
      ['cpt-pdf-header-x', '67000'],
      ['cpt-pdf-header-y', '224800'],
    ]) {
      const input = screen.getByTestId(id)
      fireEvent.focus(input)
      fireEvent.change(input, { target: { value } })
    }
    fireEvent.click(screen.getByTestId('cpt-pdf-use'))
    expect(onDone).toHaveBeenCalledWith({
      calibrations: [calibration()],
      header: { x: 67000, y: 224800, epsg: 31370 },
    })
  })
})
