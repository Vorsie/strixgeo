/**
 * Give the section-reconciliation clause (clause 7) a "Show me" target.
 *
 * The backend computes clause 7 on the RE-SEATED payload, which carries the
 * section LINE endpoints but no cross-section row id, so its findings arrive with
 * coordinates and no ``section_id`` — and the panel offers "Show me" only where a
 * finding names a section. This pure pass matches each clause-7 finding's line
 * endpoints against the project's cross-sections and stamps the matched row's
 * ``section_id`` and ``section_name`` onto the entry, so a reconciliation finding
 * becomes one press away like every other located clause (owner, 2026-09-13:
 * "the Show me jump on every clause that has a location").
 *
 * A no-op for every other clause and for a finding whose endpoints match no
 * section (the report is returned unchanged in that case, never guessed).
 *
 * @module utils/gaplessGate/resolveReconciliationSections
 */

import type { GaplessBuildReport, GaplessClauseEntry } from './types'

/** The minimum a cross-section has to expose to be matched by its line. */
export interface SectionLine {
  id: string
  name: string
  start_x: number
  start_y: number
  end_x: number
  end_y: number
}

/** How close two endpoints must be (metres) to be the same section line. */
const MATCH_TOLERANCE_M = 1.0

/** Both endpoints of ``a`` within tolerance of ``b``'s, in the same orientation. */
function sameLine(
  a: { sx: number; sy: number; ex: number; ey: number },
  b: SectionLine,
): boolean {
  return (
    Math.hypot(a.sx - b.start_x, a.sy - b.start_y) <= MATCH_TOLERANCE_M &&
    Math.hypot(a.ex - b.end_x, a.ey - b.end_y) <= MATCH_TOLERANCE_M
  )
}

/** The clause-7 entry's own line endpoints, from its ``params`` (or ``null``). */
function entryLine(
  entry: GaplessClauseEntry,
): { sx: number; sy: number; ex: number; ey: number } | null {
  const p = entry.params
  if (!p) return null
  const sx = p.start_x
  const sy = p.start_y
  const ex = p.end_x
  const ey = p.end_y
  if (
    typeof sx !== 'number' ||
    typeof sy !== 'number' ||
    typeof ex !== 'number' ||
    typeof ey !== 'number'
  ) {
    return null
  }
  return { sx, sy, ex, ey }
}

/**
 * Return a copy of the report whose section-reconciliation findings carry the
 * cross-section id and name they stand on.
 *
 * @param report The build report, or ``null`` (returned as-is).
 * @param sections The project's cross-section lines to match against.
 * @returns The report with clause-7 entries enriched; unchanged when nothing matches.
 */
export function resolveReconciliationSections(
  report: GaplessBuildReport | null,
  sections: readonly SectionLine[],
): GaplessBuildReport | null {
  if (report === null) return report
  let changed = false
  const clauses = report.clauses.map((clause) => {
    if (clause.key !== 'section-reconciliation' || clause.entries.length === 0) return clause
    const entries = clause.entries.map((entry) => {
      if (entry.section_id) return entry // already located
      const line = entryLine(entry)
      if (line === null) return entry
      const match = sections.find((s) => sameLine(line, s))
      if (match === undefined) return entry
      changed = true
      return { ...entry, section_id: match.id, section_name: match.name }
    })
    return { ...clause, entries }
  })
  return changed ? { ...report, clauses } : report
}
