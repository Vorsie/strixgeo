// The calibration overlay's edits (brief 2026-09-30, piece C): "the frame
// corners draggable, the two tick values per axis editable (numbers), the panel
// kind selectable, a curve-colour eyedropper ... a 'Re-extract' that posts the
// calibration dict". These are the pure edits on that dict; the component only
// turns mouse / keyboard input into them.

import { describe, expect, it } from 'vitest'

import type { PageCalibrationDict, PanelCalibrationDict } from '../../api/clients/cptPdf'
import {
  applyEdits,
  axisValues,
  formatDetectedValue,
  hasEdits,
  moveFrameCorner,
  overlayScale,
  setAxisValues,
  setCurveColour,
  setPanelKind,
} from './cptPdfCalibrationEdits'

function panel(overrides: Partial<PanelCalibrationDict> = {}): PanelCalibrationDict {
  return {
    kind: 'qc',
    frame: { x0: 60, y0: 90, x1: 300, y1: 790 },
    value_scale: { coord_a: 60, value_a: 0, coord_b: 300, value_b: 20, max_residual: 0 },
    depth_scale: { coord_a: 90, value_a: 0, coord_b: 790, value_b: 14, max_residual: 0 },
    unit: 'MPa',
    to_storage_factor: 1,
    curve_colour: [0, 0, 1],
    source: 'text-layer',
    assumptions: [],
    ...overrides,
  }
}

function page(panels: PanelCalibrationDict[], space = 'pdf-pt', dpi: number | null = null): PageCalibrationDict {
  return {
    page_number: 231,
    coordinate_space: space,
    dpi,
    depth_reference: 'depth',
    panels,
    ground_level_m: 6.02,
    sounding_id: '110',
    profile_name: 'van-der-straaten',
    assumptions: [],
  }
}

describe('overlay scale', () => {
  it('a PDF-point calibration shown at 144 dpi is two image pixels per point', () => {
    expect(overlayScale(page([panel()]), 144)).toBe(2)
  })

  it('an image-pixel calibration at 200 dpi shown at 100 dpi is half a pixel per pixel', () => {
    expect(overlayScale(page([panel()], 'image-px', 200), 100)).toBe(0.5)
  })
})

describe('dragging a frame corner', () => {
  it('moves that corner of that panel to the dropped point, and marks it user-set', () => {
    const cal = moveFrameCorner(page([panel()]), 0, 'bottom-right', 310, 800)
    expect(cal.panels[0].frame).toEqual({ x0: 60, y0: 90, x1: 310, y1: 800 })
    expect(cal.panels[0].source).toBe('user')
  })

  it('carries an axis anchor that sat ON the dragged edge along with it', () => {
    const cal = moveFrameCorner(page([panel()]), 0, 'bottom-right', 310, 800)
    expect(cal.panels[0].value_scale).toMatchObject({ coord_b: 310, value_b: 20 })
    expect(cal.panels[0].depth_scale).toMatchObject({ coord_b: 800, value_b: 14 })
  })

  it('leaves an anchor on a tick INSIDE the frame where the tick is', () => {
    const inside = panel({
      value_scale: { coord_a: 66, value_a: 0, coord_b: 294, value_b: 20, max_residual: 0 },
    })
    const cal = moveFrameCorner(page([inside]), 0, 'top-left', 50, 80)
    expect(cal.panels[0].frame).toMatchObject({ x0: 50, y0: 80 })
    expect(cal.panels[0].value_scale).toMatchObject({ coord_a: 66, coord_b: 294 })
  })

  it('never inverts the frame when a corner is dragged past the opposite one', () => {
    const cal = moveFrameCorner(page([panel()]), 0, 'top-left', 320, 100)
    const f = cal.panels[0].frame
    expect(f.x0).toBeLessThan(f.x1)
    expect(f.y0).toBeLessThan(f.y1)
  })

  it('does not touch the other panels', () => {
    const fs = panel({ kind: 'fs', frame: { x0: 330, y0: 90, x1: 530, y1: 790 } })
    const cal = moveFrameCorner(page([panel(), fs]), 0, 'bottom-right', 310, 800)
    expect(cal.panels[1]).toBe(fs)
  })
})

describe('typing the two tick values of an axis', () => {
  it('changes the values at the existing anchors', () => {
    const cal = setAxisValues(page([panel()]), 0, 'value', 0, 32)
    expect(cal.panels[0].value_scale).toMatchObject({ coord_a: 60, value_a: 0, coord_b: 300, value_b: 32 })
    expect(cal.panels[0].source).toBe('user')
  })

  it('on a draft panel anchors the new scale on the frame edges', () => {
    const draft = panel({ value_scale: null, depth_scale: null, source: 'draft' })
    const cal = setAxisValues(page([draft]), 0, 'depth', 0, 14)
    expect(cal.panels[0].depth_scale).toMatchObject({ coord_a: 90, value_a: 0, coord_b: 790, value_b: 14 })
  })

  it('keeps no scale while a value is missing or both are equal (the backend refuses those)', () => {
    const draft = panel({ value_scale: null })
    expect(setAxisValues(page([draft]), 0, 'value', 5, null).panels[0].value_scale).toBeNull()
    expect(setAxisValues(page([draft]), 0, 'value', 5, 5).panels[0].value_scale).toBeNull()
  })

  it('reads back the values shown in the two inputs', () => {
    expect(axisValues(panel(), 'value')).toEqual([0, 20])
    expect(axisValues(panel({ depth_scale: null }), 'depth')).toEqual([null, null])
  })
})

describe('panel kind and eyedropper', () => {
  it('selecting a panel kind names the quantity the panel plots', () => {
    expect(setPanelKind(page([panel()]), 0, 'u2').panels[0].kind).toBe('u2')
  })

  it('the eyedropper stores the clicked pixel colour as RGB 0..1', () => {
    const cal = setCurveColour(page([panel()]), 0, [255, 0, 51])
    expect(cal.panels[0].curve_colour).toEqual([1, 0, 0.2])
  })
})

// Owner dogfeed 2026-10-04: the read values are grey hints; what the user
// types is kept APART from what the digitiser detected, and an empty field
// means "use the detected value".
describe('user edits kept apart from the detected calibration', () => {
  it('no edits: the detected calibration goes out unchanged', () => {
    const detected = [page([panel()])]
    expect(applyEdits(detected, {})).toEqual(detected)
    expect(hasEdits({})).toBe(false)
  })

  it('one typed tick goes out with the detected value of the tick left empty', () => {
    const out = applyEdits([page([panel()])], { 0: { 0: { ticks: { value: { b: 32 } } } } })
    expect(out[0].panels[0].value_scale).toMatchObject({ value_a: 0, value_b: 32 })
    expect(out[0].panels[0].depth_scale).toMatchObject({ value_a: 0, value_b: 14 })
  })

  it('a dragged frame goes out with the edge anchors carried along', () => {
    const frame = { x0: 60, y0: 90, x1: 310, y1: 800 }
    const out = applyEdits([page([panel()])], { 0: { 0: { frame } } })
    expect(out[0].panels[0].frame).toEqual(frame)
    expect(out[0].panels[0].value_scale?.coord_b).toBe(310)
  })

  it('kind and colour edits go out; the other panels stay as detected', () => {
    const other = panel({ kind: 'fs' })
    const out = applyEdits([page([panel(), other])], { 0: { 0: { kind: 'u2', colourRgb: [255, 0, 51] } } })
    expect(out[0].panels[0].kind).toBe('u2')
    expect(out[0].panels[0].curve_colour).toEqual([1, 0, 0.2])
    expect(out[0].panels[1]).toEqual(other)
  })

  it('a panel entry with nothing in it is no edit', () => {
    expect(hasEdits({ 0: { 0: {} } })).toBe(false)
    expect(hasEdits({ 0: { 0: { kind: 'qc' } } })).toBe(true)
  })

  it('formats a detected value as the chart prints it', () => {
    expect(formatDetectedValue(0)).toBe('0')
    expect(formatDetectedValue(32)).toBe('32')
    expect(formatDetectedValue(6.02)).toBe('6.02')
    expect(formatDetectedValue(0.1 + 0.2)).toBe('0.3')
    expect(formatDetectedValue(null)).toBe('')
  })
})
