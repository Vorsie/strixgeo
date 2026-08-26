// The ground-surface layer (G7) — its legend row and the ONE number it exists
// to make legible.
//
// WHY THIS MODULE EXISTS. The DEM ground surface has been rendered since G7
// shipped: `buildTinPrimitive(groundSurface.vertices, .triangles,
// GROUND_SURFACE_COLOR, ...)` inside `rebuildSurfacePrimitives`, translucent
// (alpha 0.45) and non-occluding (Cesium's translucent render state disables
// depth writes, so the model below stays visible through the terrain). What
// was missing is the READING: with the surface on, the user sees a grey sheet
// floating some distance above the interpreted model top and has no way to
// tell whether that distance is 0.2 m or 2 m, nor whether a column poking
// THROUGH the terrain is a rendering artefact or a data conflict.
//
// The model top is the interpreted top, not the ground: on the dev project 47
// of 58 tests have their shallowest interpreted contact below their own
// collar. That daylight is real and is the thing the surface makes visible;
// this module turns it into a number, and names the columns where the model
// breaks through the terrain instead.
//
// Deliberately Cesium-math-only (Color) plus pure arithmetic, so it runs under
// vitest without WebGL — same rule `cesiumGeometry.ts` follows.

import * as Cesium from 'cesium'

import { sampleTinZ, type TinLike } from './cesiumGeometry'
import { GROUND_SURFACE_COLOR } from './geology3DPrimitives'

/** Vertical difference (m) below which terrain and model top are read as the
 * same level. 1 mm is the project's geometry precision floor (litho layer
 * depths clamp at 0.001 m server-side), so anything tighter is noise from the
 * TIN interpolation rather than a real gap. */
export const DAYLIGHT_FLUSH_EPS_M = 0.001

/** One column to read the daylight at — an investigation's plan position. */
export interface DaylightColumn {
  /** Investigation name, used verbatim in the readout. Falls back to the
   * coordinate pair when absent so a record is never anonymous. */
  label?: string
  x: number
  y: number
}

/** What the terrain and the model say at one column.
 *
 * `daylightM` is signed: positive = the model top sits BELOW the terrain
 * (the normal case — daylight); negative = the model top sits ABOVE it,
 * which is a data conflict, not a smaller gap. `status` names which.
 */
export interface DaylightRecord {
  label: string
  x: number
  y: number
  /** DEM terrain elevation at the column (m, project vertical datum). */
  groundZ: number
  /** Shallowest model surface elevation at the column (m). */
  modelTopZ: number
  /** `groundZ - modelTopZ` (m). Signed — see the interface note. */
  daylightM: number
  status: 'daylight' | 'flush' | 'above_ground'
}

/** The one-line reading for the legend row. */
export interface DaylightSummary {
  /** Columns where both a terrain and a model top were found. */
  counted: number
  /** Of those, how many have the model top below the terrain. */
  withDaylight: number
  /** Of those, how many have the model top ABOVE the terrain (a conflict). */
  aboveGround: number
  /** Largest daylight found, or null when nothing could be read. */
  maxDaylightM: number | null
  /** Which column that was, or null. */
  maxLabel: string | null
}

/** Legend-row data for the ground surface.
 *
 * The fenced `Geology3DViewer` hardcodes the swatch as the literal
 * `'rgb(140,133,122)'` while the mesh takes its colour from
 * `GROUND_SURFACE_COLOR`. They agree today by coincidence of maintenance.
 * Deriving the swatch from the colour makes drift impossible.
 */
export interface LegendEntry {
  id: string
  label: string
  /** Solid CSS colour for the swatch (alpha dropped — a 45 %-alpha swatch on
   * a panel background reads as a different hue than the mesh). */
  swatchCss: string
}

/**
 * Convert a Cesium colour to an opaque CSS `rgb()` string.
 *
 * Alpha is dropped on purpose: the legend swatch is an identity marker, not a
 * preview of the mesh's transparency.
 */
export function cesiumColorToCss(color: Cesium.Color): string {
  const c = (v: number): number => Math.round(v * 255)
  return `rgb(${c(color.red)}, ${c(color.green)}, ${c(color.blue)})`
}

/** The ground-surface legend row. */
export const GROUND_SURFACE_LEGEND: LegendEntry = {
  id: 'ground-surface',
  label: 'Ground surface',
  swatchCss: cesiumColorToCss(GROUND_SURFACE_COLOR),
}

/**
 * Read the vertical gap between the DEM terrain and the interpreted model top
 * at each column.
 *
 * A column is skipped (not reported as zero) when either side is missing: no
 * terrain triangle covers it, or no model surface reaches it. Reporting a
 * fabricated 0 there would read as "flush ground", which is exactly the
 * wrong conclusion.
 *
 * Parameters
 * ----------
 * groundSurface
 *     The DEM ground TIN (`GroundSurfaceBuildResponse`-shaped).
 * modelSurfaces
 *     Every formation/litho TIN in the scene. The shallowest one present at a
 *     column is that column's model top.
 * columns
 *     Investigation plan positions to read at.
 */
export function computeGroundDaylight(
  groundSurface: TinLike,
  modelSurfaces: readonly TinLike[],
  columns: readonly DaylightColumn[],
): DaylightRecord[] {
  if (groundSurface.triangles.length === 0) return []

  const records: DaylightRecord[] = []

  for (const column of columns) {
    const groundZ = sampleTinZ(groundSurface, column.x, column.y)
    if (groundZ === null) continue

    let modelTopZ: number | null = null
    for (const surface of modelSurfaces) {
      const z = sampleTinZ(surface, column.x, column.y)
      if (z === null) continue
      if (modelTopZ === null || z > modelTopZ) modelTopZ = z
    }
    if (modelTopZ === null) continue

    const daylightM = groundZ - modelTopZ
    const status: DaylightRecord['status'] =
      Math.abs(daylightM) < DAYLIGHT_FLUSH_EPS_M
        ? 'flush'
        : daylightM < 0
          ? 'above_ground'
          : 'daylight'

    records.push({
      label: column.label ?? `(${column.x.toFixed(0)}, ${column.y.toFixed(0)})`,
      x: column.x,
      y: column.y,
      groundZ,
      modelTopZ,
      daylightM,
      status,
    })
  }

  return records
}

/**
 * Collapse the per-column records into the single line the legend shows.
 *
 * Ties on the maximum keep the FIRST column encountered, so the caption is
 * stable across renders rather than flickering between equal columns.
 */
export function summariseDaylight(records: readonly DaylightRecord[]): DaylightSummary {
  let withDaylight = 0
  let aboveGround = 0
  let maxDaylightM: number | null = null
  let maxLabel: string | null = null

  for (const record of records) {
    if (record.status === 'daylight') withDaylight += 1
    if (record.status === 'above_ground') aboveGround += 1
    if (maxDaylightM === null || record.daylightM > maxDaylightM) {
      maxDaylightM = record.daylightM
      maxLabel = record.label
    }
  }

  return {
    counted: records.length,
    withDaylight,
    aboveGround,
    maxDaylightM,
    maxLabel,
  }
}

/**
 * Format the summary as the legend's secondary line.
 *
 * Returns `null` when there is nothing to say, so the caller can omit the
 * line entirely rather than render "0 of 0".
 */
export function formatDaylightCaption(summary: DaylightSummary): string | null {
  if (summary.counted === 0) return null

  const parts: string[] = []
  if (summary.maxDaylightM !== null && summary.withDaylight > 0) {
    parts.push(
      `${summary.withDaylight}/${summary.counted} below ground` +
        `, max ${summary.maxDaylightM.toFixed(2)} m at ${summary.maxLabel}`,
    )
  }
  if (summary.aboveGround > 0) {
    parts.push(`${summary.aboveGround} above ground`)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}
