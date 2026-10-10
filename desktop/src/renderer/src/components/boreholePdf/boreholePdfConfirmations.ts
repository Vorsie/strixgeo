// The user's answers to the two questions the PDF borehole import asks, and the
// import body built from them. Pure: no React, no I/O.
//
// Owner rulings 2026-10-08:
//  3. X/Y printed without a named system ARE Lambert 72, but the user confirms
//     it at import: "this test is Lambert 72", "all tests in this report are
//     Lambert 72", or "another CRS" picked from a list. Never silent, never
//     blocking (the row waits for an answer; it is never refused for good).
//  4. A water level printed as a bare number is cm BELOW GROUND, shown to the
//     user for confirmation at import.
//  5. A borehole printed twice with different data: both listed, the user
//     withholds one; two ticked prints are never merged.

import type {
  BoreholePdfCrsConfirmation,
  BoreholePdfImportItem,
  BoreholePdfRow,
} from '../../api/clients/boreholePdf'

/** Lambert 72: the system the owner ruled for X/Y printed without one. */
export const ASSUMED_EPSG = 31370

/** The systems "another CRS" offers: the ones the map and the 3-D view can
 *  draw (``useWgs84``). Mirrors the backend's ``SUPPORTED_BOREHOLE_PDF_EPSGS``.
 *  The labels are CRS names (domain tokens), never translated. */
export const CRS_OPTIONS: readonly { epsg: number; label: string }[] = [
  { epsg: 31370, label: 'Lambert 72 (EPSG 31370)' },
  { epsg: 28992, label: 'RD New (EPSG 28992)' },
]

/** One row's CRS answer. */
export type CrsChoice = { kind: 'this' } | { kind: 'report' } | { kind: 'other'; epsg: number }

/** What the user answered for one row. */
export interface RowDecision {
  crs: CrsChoice | null
  waterConfirmed: boolean
}

/** Row key -> its answers (a row without an entry answered nothing). */
export type RowDecisions = Record<string, RowDecision>

/** The finding codes the import refuses without an answer (backend names). */
export type ConfirmationCode = 'CRS_ASSUMED' | 'WATER_UNIT_ASSUMED'

/**
 * The questions a row still waits on.
 *
 * @param row - The triaged borehole.
 * @param decisions - Every row's answers.
 * @returns The finding codes not yet answered, CRS first.
 */
export function missingConfirmations(row: BoreholePdfRow, decisions: RowDecisions): ConfirmationCode[] {
  const decision = decisions[row.key]
  const missing: ConfirmationCode[] = []
  if (row.crs_assumed && !decision?.crs) missing.push('CRS_ASSUMED')
  if (row.water_unit_assumed && !decision?.waterConfirmed) missing.push('WATER_UNIT_ASSUMED')
  return missing
}

/**
 * Record a CRS answer. "All boreholes of this report are Lambert 72" answers
 * every row that asks (one click, visible on each row); any other answer
 * changes its own row only.
 *
 * @param rows - Every listed row.
 * @param decisions - The answers so far.
 * @param key - The row answered on.
 * @param choice - The answer.
 * @returns The new answers (a fresh object).
 */
export function applyCrsChoice(
  rows: readonly BoreholePdfRow[],
  decisions: RowDecisions,
  key: string,
  choice: CrsChoice,
): RowDecisions {
  const next: RowDecisions = { ...decisions }
  const targets = choice.kind === 'report' ? rows.filter(r => r.crs_assumed).map(r => r.key) : [key]
  for (const target of targets) {
    next[target] = { waterConfirmed: next[target]?.waterConfirmed ?? false, crs: choice }
  }
  return next
}

/**
 * Record the water-unit answer of one row.
 *
 * @returns The new answers (a fresh object).
 */
export function applyWaterChoice(decisions: RowDecisions, key: string, confirmed: boolean): RowDecisions {
  return { ...decisions, [key]: { crs: decisions[key]?.crs ?? null, waterConfirmed: confirmed } }
}

/** The body's ``crs`` for one answer. */
function crsBody(choice: CrsChoice): BoreholePdfCrsConfirmation {
  if (choice.kind === 'other') return { epsg: choice.epsg, scope: 'this' }
  return { epsg: ASSUMED_EPSG, scope: choice.kind }
}

/**
 * The ``boreholes`` of ``POST /borehole/pdf/import``: the ticked rows in list
 * order, each with the answers its findings asked for (and nothing else).
 *
 * @param rows - Every listed row.
 * @param selected - The ticked keys.
 * @param decisions - Every row's answers.
 * @returns One item per ticked row.
 */
export function buildImportItems(
  rows: readonly BoreholePdfRow[],
  selected: ReadonlySet<string>,
  decisions: RowDecisions,
): BoreholePdfImportItem[] {
  return rows
    .filter(r => selected.has(r.key))
    .map(r => {
      const decision = decisions[r.key]
      const item: BoreholePdfImportItem = { key: r.key }
      if (r.crs_assumed && decision?.crs) item.crs = crsBody(decision.crs)
      if (r.water_unit_assumed && decision?.waterConfirmed) item.water_unit_confirmed = true
      return item
    })
}

/**
 * Whether two prints of one borehole are ticked together (ruling 5).
 *
 * @returns True when a ticked row's ``repeat_of`` is ticked too.
 */
export function repeatClash(rows: readonly BoreholePdfRow[], selected: ReadonlySet<string>): boolean {
  return rows.some(r => selected.has(r.key) && r.repeat_of !== null && selected.has(r.repeat_of))
}

/**
 * The rows ticked when the list opens: every importable row except the second
 * print of a borehole printed twice with different data (the user picks).
 *
 * @returns The ticked keys.
 */
export function initialSelection(rows: readonly BoreholePdfRow[]): Set<string> {
  return new Set(rows.filter(r => r.importable && r.repeat_of === null).map(r => r.key))
}
