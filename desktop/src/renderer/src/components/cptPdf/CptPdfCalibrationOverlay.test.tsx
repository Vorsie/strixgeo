// The calibration overlay (brief 2026-09-30, piece C): "the page image with the
// orange digitised curve drawn over it (the overlay PNG from the backend), the
// frame corners draggable, the two tick values per axis editable (numbers), the
// panel kind selectable, a curve-colour eyedropper for scans (click the image →
// RGB → re-extract), a 'Re-extract' that posts the calibration dict, the
// assumptions listed, the clipped-point count, XY/Z/date editable when not read".

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
    expect(onDone).toHaveBeenCalledWith(
      expect.objectContaining({
        calibrations: [calibration()],
        header: { x: 67000, y: 224800, epsg: 31370 },
      }),
    )
  })

  // Owner dogfeed 2026-10-04: "with assen controleren, you should give the
  // values that are selected right now in grey" / "i can type but the text is
  // white on white" / "you also need a reset button to auto pick".
  describe('the values the digitiser read are grey hints, not typed text', () => {
    it('each tick field starts EMPTY and shows the value the digitiser read as its grey placeholder', async () => {
      renderOverlay()
      await screen.findByTestId('cpt-pdf-overlay-image')
      const expected: Array<[string, string]> = [
        ['cpt-pdf-value-tick-a', '0'],
        ['cpt-pdf-value-tick-b', '20'],
        ['cpt-pdf-depth-tick-a', '0'],
        ['cpt-pdf-depth-tick-b', '14'],
      ]
      for (const [id, hint] of expected) {
        const input = screen.getByTestId(id) as HTMLInputElement
        expect(input.value).toBe('')
        expect(input.placeholder).toBe(hint)
      }
    })

    it('a header field the sheet did not print starts empty, with its default as the grey hint', async () => {
      renderOverlay()
      await screen.findByTestId('cpt-pdf-overlay-image')
      const epsg = screen.getByTestId('cpt-pdf-header-epsg') as HTMLInputElement
      expect(epsg.value).toBe('')
      expect(epsg.placeholder).toBe('31370')
    })

    it('typing ONE tick sends that value, and the read value for the tick left empty', async () => {
      renderOverlay()
      await screen.findByTestId('cpt-pdf-overlay-image')
      const tickA = screen.getByTestId('cpt-pdf-value-tick-a')
      fireEvent.focus(tickA)
      fireEvent.change(tickA, { target: { value: '2' } })
      fireEvent.click(screen.getByTestId('cpt-pdf-reextract'))
      await waitFor(() => expect(digitise).toHaveBeenCalledTimes(2))
      expect(digitise.mock.calls[1][0].calibrations[0].panels[0].value_scale).toMatchObject({
        value_a: 2,
        value_b: 20,
      })
      // The typed tick is shown as typed; the untouched one stays a hint.
      expect((screen.getByTestId('cpt-pdf-value-tick-b') as HTMLInputElement).value).toBe('')
    })
  })

  it('reopening a sounding keeps the typed tick as typed and the read values as grey hints', async () => {
    const { onDone } = renderOverlay()
    await screen.findByTestId('cpt-pdf-overlay-image')
    const tickB = screen.getByTestId('cpt-pdf-value-tick-b')
    fireEvent.focus(tickB)
    fireEvent.change(tickB, { target: { value: '32' } })
    fireEvent.blur(tickB)
    fireEvent.click(screen.getByTestId('cpt-pdf-use'))
    const settled = onDone.mock.calls[0][0]
    cleanup()
    digitise.mockClear()
    render(
      <CptPdfCalibrationOverlay
        projectId="p1"
        fileSha={SHA}
        sounding={sounding()}
        initial={settled}
        onDone={vi.fn()}
        onBack={vi.fn()}
      />,
    )
    await screen.findByTestId('cpt-pdf-overlay-image')
    expect(digitise.mock.calls[0][0].calibrations[0].panels[0].value_scale).toMatchObject({ value_a: 0, value_b: 32 })
    const reopened = screen.getByTestId('cpt-pdf-value-tick-b') as HTMLInputElement
    expect(reopened.value).toBe('32')
    expect(reopened.placeholder).toBe('20')
    expect((screen.getByTestId('cpt-pdf-reset') as HTMLButtonElement).disabled).toBe(false)
  })

  it('every field in the overlay follows the theme: themed background, themed text, grey hint', async () => {
    renderOverlay()
    await screen.findByTestId('cpt-pdf-overlay-image')
    const fields = within(screen.getByTestId('cpt-pdf-overlay')).getAllByRole('textbox')
    // tick A/B on two axes + x, y, epsg (the sheet printed no position).
    expect(fields.length).toBeGreaterThanOrEqual(7)
    for (const field of [...fields, screen.getByTestId('cpt-pdf-panel-kind')]) {
      const classes = field.className.split(/\s+/)
      expect(classes, field.getAttribute('data-testid') ?? '').toEqual(
        expect.arrayContaining(['bg-surface-overlay', 'text-text-primary', 'placeholder:text-text-muted']),
      )
    }
  })

  describe('"Pick automatically again" drops every edit back to the digitiser\'s own reading', () => {
    it('is disabled while nothing was edited', async () => {
      renderOverlay()
      await screen.findByTestId('cpt-pdf-overlay-image')
      const reset = screen.getByTestId('cpt-pdf-reset')
      expect(reset.textContent).toBe('Pick automatically again')
      expect((reset as HTMLButtonElement).disabled).toBe(true)
    })

    it('after an edit it clears the edits and reads the page again through the digitiser\'s own calibration', async () => {
      renderOverlay()
      await screen.findByTestId('cpt-pdf-overlay-image')
      const tickB = screen.getByTestId('cpt-pdf-value-tick-b')
      fireEvent.focus(tickB)
      fireEvent.change(tickB, { target: { value: '32' } })
      fireEvent.blur(tickB)
      fireEvent.change(screen.getByTestId('cpt-pdf-panel-kind'), { target: { value: 'fs' } })
      const x = screen.getByTestId('cpt-pdf-header-x')
      fireEvent.focus(x)
      fireEvent.change(x, { target: { value: '67000' } })
      fireEvent.blur(x)
      const reset = screen.getByTestId('cpt-pdf-reset') as HTMLButtonElement
      expect(reset.disabled).toBe(false)
      fireEvent.click(reset)
      await waitFor(() => expect(digitise).toHaveBeenCalledTimes(2))
      // No calibration posted = the server detects the axes itself.
      expect(digitise.mock.calls[1][0]).toEqual({ project_id: 'p1', file_sha: SHA, sounding_id: '110' })
      await waitFor(() => expect(reset.disabled).toBe(true))
      expect((screen.getByTestId('cpt-pdf-value-tick-b') as HTMLInputElement).value).toBe('')
      expect((screen.getByTestId('cpt-pdf-header-x') as HTMLInputElement).value).toBe('')
      expect((screen.getByTestId('cpt-pdf-panel-kind') as HTMLSelectElement).value).toBe('qc')
    })

    it('reads "Automatisch opnieuw kiezen" in Dutch', async () => {
      setLanguage('nl')
      renderOverlay()
      await screen.findByTestId('cpt-pdf-overlay-image')
      expect(screen.getByTestId('cpt-pdf-reset').textContent).toBe('Automatisch opnieuw kiezen')
    })
  })
})
