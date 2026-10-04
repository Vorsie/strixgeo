// Pure edits on a page calibration dict — what the calibration overlay's
// gestures do. The dict is the backend's PageCalibration.to_dict(): the overlay
// edits it and posts it back to /cpt/pdf/digitise ("Re-extract"), and the
// import posts the settled one. Nothing here renders or fetches.

import type {
  AxisScaleDict,
  FrameDict,
  PageCalibrationDict,
  PanelCalibrationDict,
  PanelKindValue,
} from '../../api/clients/cptPdf'

/** Which frame corner a drag handle moves. */
export type FrameCorner = 'top-left' | 'bottom-right'

/** Which axis of a panel: the value axis (x) or the vertical depth axis (y). */
export type PanelAxis = 'value' | 'depth'

/** An anchor this close (page units) to a frame edge is "on" that edge. */
const ON_EDGE_TOLERANCE = 1e-6

/**
 * Overlay pixels per calibration unit.
 *
 * A PDF-point calibration shown on an image rendered at ``overlayDpi`` has
 * ``overlayDpi / 72`` pixels per point; an image-pixel calibration made at its
 * own ``dpi`` has ``overlayDpi / dpi`` overlay pixels per calibration pixel.
 */
export function overlayScale(cal: PageCalibrationDict, overlayDpi: number): number {
  if (cal.coordinate_space === 'pdf-pt' || !cal.dpi) return overlayDpi / 72
  return overlayDpi / cal.dpi
}

function withPanel(
  cal: PageCalibrationDict,
  index: number,
  edit: (p: PanelCalibrationDict) => PanelCalibrationDict,
): PageCalibrationDict {
  return {
    ...cal,
    panels: cal.panels.map((p, i) => (i === index ? { ...edit(p), source: 'user' } : p)),
  }
}

/** Move an anchor that sat on ``oldEdge`` to ``newEdge``; leave others. */
function followEdge(scale: AxisScaleDict | null, oldEdge: number, newEdge: number): AxisScaleDict | null {
  if (!scale) return scale
  const on = (c: number): boolean => Math.abs(c - oldEdge) <= ON_EDGE_TOLERANCE
  return {
    ...scale,
    coord_a: on(scale.coord_a) ? newEdge : scale.coord_a,
    coord_b: on(scale.coord_b) ? newEdge : scale.coord_b,
  }
}

/**
 * Drag one frame corner of one panel to ``(x, y)`` (calibration units).
 *
 * An axis anchor that sat exactly on a moved edge travels with it (a draft
 * scale is anchored on the frame edges); an anchor on a tick inside the frame
 * stays on its tick. The frame never inverts.
 */
export function moveFrameCorner(
  cal: PageCalibrationDict,
  index: number,
  corner: FrameCorner,
  x: number,
  y: number,
): PageCalibrationDict {
  return withPanel(cal, index, p => {
    const f = p.frame
    const moved: FrameDict =
      corner === 'top-left' ? { ...f, x0: x, y0: y } : { ...f, x1: x, y1: y }
    const frame: FrameDict = {
      x0: Math.min(moved.x0, moved.x1),
      y0: Math.min(moved.y0, moved.y1),
      x1: Math.max(moved.x0, moved.x1),
      y1: Math.max(moved.y0, moved.y1),
    }
    const [oldX, newX] = corner === 'top-left' ? [f.x0, frame.x0] : [f.x1, frame.x1]
    const [oldY, newY] = corner === 'top-left' ? [f.y0, frame.y0] : [f.y1, frame.y1]
    return {
      ...p,
      frame,
      value_scale: followEdge(p.value_scale, oldX, newX),
      depth_scale: followEdge(p.depth_scale, oldY, newY),
    }
  })
}

/** The two values shown in an axis's inputs (null where no scale exists). */
export function axisValues(p: PanelCalibrationDict, axis: PanelAxis): [number | null, number | null] {
  const s = axis === 'value' ? p.value_scale : p.depth_scale
  return s ? [s.value_a, s.value_b] : [null, null]
}

/**
 * Set the two tick values of an axis.
 *
 * On an existing scale the values change at the existing anchors. On a draft
 * panel (no scale yet) the new scale is anchored on the frame edges. While a
 * value is missing, or both are equal, the axis stays without a scale — the
 * backend refuses a degenerate axis.
 */
export function setAxisValues(
  cal: PageCalibrationDict,
  index: number,
  axis: PanelAxis,
  a: number | null,
  b: number | null,
): PageCalibrationDict {
  return withPanel(cal, index, p => {
    const key = axis === 'value' ? 'value_scale' : 'depth_scale'
    if (a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b) || a === b) {
      return { ...p, [key]: null }
    }
    const current = p[key]
    const [edgeA, edgeB] = axis === 'value' ? [p.frame.x0, p.frame.x1] : [p.frame.y0, p.frame.y1]
    const scale: AxisScaleDict = {
      coord_a: current ? current.coord_a : edgeA,
      value_a: a,
      coord_b: current ? current.coord_b : edgeB,
      value_b: b,
      max_residual: 0,
    }
    return { ...p, [key]: scale }
  })
}

/** Name the quantity a panel plots. */
export function setPanelKind(cal: PageCalibrationDict, index: number, kind: PanelKindValue): PageCalibrationDict {
  return withPanel(cal, index, p => ({ ...p, kind }))
}

/** Store an eyedropper pick (RGB 0..255) as the panel's curve colour (0..1). */
export function setCurveColour(
  cal: PageCalibrationDict,
  index: number,
  rgb: [number, number, number],
): PageCalibrationDict {
  const unit = (c: number): number => Math.round((c / 255) * 1000) / 1000
  return withPanel(cal, index, p => ({ ...p, curve_colour: [unit(rgb[0]), unit(rgb[1]), unit(rgb[2])] }))
}

// ---------------------------------------------------------------------------
// User edits kept apart from the detected calibration (owner dogfeed
// 2026-10-04: "give the values that are selected right now in grey"). The
// overlay keeps the digitiser's own calibration (``detected``) untouched and
// the user's edits sparse beside it: a field the user left empty means "use
// the detected value". ``applyEdits`` is the one place the two merge, for the
// re-read, the import and the drawing.

/** The tick values the user typed on one axis; a missing tick = the detected one. */
export interface TickEdit {
  a?: number
  b?: number
}

/** What the user changed on one panel; every field is optional. */
export interface PanelEdit {
  /** The dragged frame (calibration units). */
  frame?: FrameDict
  /** Typed tick values per axis. */
  ticks?: Partial<Record<PanelAxis, TickEdit>>
  /** The quantity the user named. */
  kind?: PanelKindValue
  /** The eyedropper pick, RGB 0..255. */
  colourRgb?: [number, number, number]
}

/** Sparse edits: page index -> panel index -> what changed. */
export type CalibrationEdits = Record<number, Record<number, PanelEdit>>

function panelEditIsEmpty(edit: PanelEdit): boolean {
  const ticks = Object.values(edit.ticks ?? {}).some(t => t && (t.a !== undefined || t.b !== undefined))
  return !edit.frame && !ticks && edit.kind === undefined && !edit.colourRgb
}

/** True when the user changed anything at all. */
export function hasEdits(edits: CalibrationEdits): boolean {
  return Object.values(edits).some(panels => Object.values(panels).some(e => !panelEditIsEmpty(e)))
}

/**
 * Patch one panel's edit; the result never keeps an empty panel entry.
 *
 * ``patch`` replaces the given fields; pass a field as ``undefined`` to drop it.
 */
export function patchPanelEdit(
  edits: CalibrationEdits,
  page: number,
  panel: number,
  patch: PanelEdit,
): CalibrationEdits {
  const merged: PanelEdit = { ...(edits[page]?.[panel] ?? {}), ...patch }
  const pagePanels = { ...(edits[page] ?? {}) }
  if (panelEditIsEmpty(merged)) delete pagePanels[panel]
  else pagePanels[panel] = merged
  const next = { ...edits }
  if (Object.keys(pagePanels).length === 0) delete next[page]
  else next[page] = pagePanels
  return next
}

function applyPanelEdit(cal: PageCalibrationDict, index: number, edit: PanelEdit): PageCalibrationDict {
  let c = cal
  if (edit.frame) {
    // Two corner moves reproduce the drag: an anchor on a moved edge follows it.
    c = moveFrameCorner(c, index, 'top-left', edit.frame.x0, edit.frame.y0)
    c = moveFrameCorner(c, index, 'bottom-right', edit.frame.x1, edit.frame.y1)
  }
  for (const axis of ['value', 'depth'] as const) {
    const tick = edit.ticks?.[axis]
    if (!tick || (tick.a === undefined && tick.b === undefined)) continue
    const [a, b] = axisValues(c.panels[index], axis)
    c = setAxisValues(c, index, axis, tick.a ?? a, tick.b ?? b)
  }
  if (edit.kind !== undefined) c = setPanelKind(c, index, edit.kind)
  if (edit.colourRgb) c = setCurveColour(c, index, edit.colourRgb)
  return c
}

/** The calibration that goes out: the user's edits over the detected one. */
export function applyEdits(detected: PageCalibrationDict[], edits: CalibrationEdits): PageCalibrationDict[] {
  return detected.map((cal, page) => {
    const panels = edits[page]
    if (!panels) return cal
    return Object.entries(panels).reduce(
      (c, [panel, edit]) => (panelEditIsEmpty(edit) ? c : applyPanelEdit(c, Number(panel), edit)),
      cal,
    )
  })
}

/**
 * A detected value as the chart prints it (``0``, ``32``, ``6.02``): a point
 * separator, float noise rounded off at 6 decimals, empty when unknown.
 */
export function formatDetectedValue(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return ''
  return String(Math.round(value * 1e6) / 1e6)
}
