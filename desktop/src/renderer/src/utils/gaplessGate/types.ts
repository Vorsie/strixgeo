/**
 * THE SEVEN-CLAUSE GAPLESS GATE — the shared wire contract.
 *
 * Owner constraint, 2026-08-26: *"I can't have gaps or fallbacks in the model
 * unless users make mistakes."* That is a promise about the built model, and a
 * promise nobody measures is a wish. This module is the vocabulary the
 * measurement speaks — one report per build, seven clauses, each either kept or
 * named-and-broken.
 *
 * The gate **fails the report loudly, never the build.** A build that trips a
 * clause still writes its solids: the engineer keeps working and sees, on the
 * stage, exactly which section and which gap he has to look at. Blocking the
 * build would trade a visible defect for an invisible one.
 *
 * WHO COMPUTES WHAT. Clauses 1-4 are 2-D and are computed in the renderer at
 * press time, where the fill diagnostics live; they ride out with the build
 * payload as {@link GaplessClauseInput}s. Clauses 5-7 are 3-D and are computed
 * by the backend from the label grid. **The backend is the assembler of
 * record:** it re-stamps every clause's number and title from its own
 * constants, merges all seven, stores them on the build-generation row and
 * returns the whole thing. So the renderer never names a clause — it only says
 * what it found — and the seven titles have exactly one home
 * (``gapless_build_report_constants.py``) instead of two that can drift.
 *
 * Both shapes are snake_case, the wire convention of every other type in
 * ``geology.types.ts``, so no mapper stands between the halves to drift either.
 *
 * WHY EVERY OPTIONAL IS ``?: T | null`` AND NOT ``?: T``. The two directions
 * spell "absent" differently and both are on this wire: the renderer OMITS a
 * locator it does not know, while Pydantic serialises the same absence as an
 * explicit ``null``. Typing them ``?: T`` describes only the outbound half, and
 * a reader that then tests ``x !== undefined`` treats every inbound ``null`` as
 * a value — which is exactly what happened before this was widened: the report
 * banner offered a "Show me" button on all three findings of a real backend
 * report, two of which stand nowhere at all. Test the VALUE, not the slot.
 *
 * @module utils/gaplessGate/types
 */

/** The seven clauses, in report order. */
export type GaplessClauseKey =
  /** (1) Classed + unclassed = the litho cover, per section per gap. */
  | 'area-conservation'
  /** (2) The 3-D build can read the fill at both edges of every gap. */
  | 'edge-reach'
  /** (3) Every patch of unclassed ground has a cause the law knows. */
  | 'cause-closure'
  /** (4) Every litho-frame section reached the payload, or was consented out. */
  | 'section-closure'
  /** (5) No empty column inside the model footprint. */
  | 'column-totality'
  /** (6) No interior void taller than the hairline limit in any column. */
  | 'stack-voids'
  /** (7) The 3-D model holds the ground its own sections classed. */
  | 'section-reconciliation'

/**
 * Whether one clause was kept.
 *
 * ``not-evaluated`` is a first-class answer, not a soft pass. A litho build
 * runs no hierarchical fill, so clauses 1-3 have nothing to measure; a
 * checksum-skipped build (``force=false``) labels no grid, so clauses 5-7 have
 * nothing to read. Reporting either as ``pass`` would be a lie in the exact
 * direction the owner's constraint cannot afford.
 */
export type GaplessClauseStatus = 'pass' | 'fail' | 'not-evaluated'

/**
 * The build's verdict.
 *
 * ``incomplete`` = nothing failed but not everything was measured. It is
 * deliberately NOT green: an unmeasured clause is an unkept promise until it is
 * measured.
 */
export type GaplessVerdict = 'pass' | 'fail' | 'incomplete'

/** The unit a clause entry's measurement is in. */
export type GaplessMeasureUnit = 'm' | 'm2' | 'count'

/** A number a clause entry is making a claim about. */
export interface GaplessMeasure {
  value: number
  unit: GaplessMeasureUnit
  /**
   * What the value was allowed to be, where the clause has a derived budget
   * (clause 7's quantisation allowance, clause 6's hairline limit). Absent
   * where the budget is simply zero — most clauses forbid the thing outright.
   */
  budget?: number | null
}

/**
 * One named spot a clause was broken at — the sentence the engineer reads plus
 * enough identity to navigate to it.
 *
 * Every optional locator is present whenever the clause can know it: a 2-D
 * clause knows its section and gap, clause 5 knows a world position, clause 4
 * knows a section only. Nothing here is guessed to fill a field.
 */
export interface GaplessClauseEntry {
  /** One line, in the engineer's own vocabulary — never a variable name. */
  label: string
  /** The cross-section row id, where the finding stands on one. */
  section_id?: string | null
  /** Its display name, so the line reads without a lookup. */
  section_name?: string | null
  /** The frame gap index within that section. */
  gap_index?: number | null
  /**
   * The two investigations whose columns the gap stands between, in axis
   * order — what a reader NAVIGATES by.
   *
   * ``gap_index`` above is a LABEL: the sentence says "gap 12" and the
   * engineer quotes it. It is not a way to find the gap, because it indexes
   * the litho FRAME's column list and nothing else — on the geotech axis's own
   * ``visibleColumns`` the same number is a different gap, which is exactly how
   * the crossing chip once centred the wrong one (``PartitionFillOverlay.
   * onJumpToConflictGap``). So the clause resolves the pair against the frame
   * at the moment it mints the entry, and the NAMES travel instead; the render
   * surface turns them back into a position through its own column list
   * (``resolveColumnReveal``, whose span midpoint IS the gap between them).
   *
   * Absent whenever the clause cannot name the pair — a backend-computed
   * clause with no frame in scope, a gap index past the frame's own columns,
   * or a report written before this field existed. A reader that finds it
   * absent opens the section and centres nothing, which is honest; guessing a
   * position would not be.
   */
  gap_investigation_ids?: readonly string[] | null
  /** A CPT / borehole id, where the finding names one. */
  investigation_id?: string | null
  /** Project-CRS easting, where the finding stands at a map position. */
  world_x?: number | null
  /** Project-CRS northing, where the finding stands at a map position. */
  world_y?: number | null
  /** What the finding measured. */
  measure?: GaplessMeasure | null
}

/**
 * What the renderer says about one clause — substance only.
 *
 * No ``number``, no ``title``: naming the clause is the backend's job (see the
 * module docstring), so those cannot drift between the two languages.
 */
export interface GaplessClauseInput {
  key: GaplessClauseKey
  status: GaplessClauseStatus
  /**
   * Why the clause could not be measured. Present ONLY on ``not-evaluated`` —
   * an unmeasured clause that cannot say why is itself a defect.
   */
  not_evaluated_reason?: string | null
  /** The named spots. Empty on ``pass`` and on ``not-evaluated``. */
  entries: GaplessClauseEntry[]
}

/** One clause as the backend assembled it — substance plus its name. */
export interface GaplessClause extends GaplessClauseInput {
  /** 1-7 — the clause's number in the guarantee, stable across versions. */
  number: number
  /** The promise this clause keeps, stated positively. */
  title: string
}

/** The whole gate, one per build. */
export interface GaplessBuildReport {
  verdict: GaplessVerdict
  /** All seven, always, in clause-number order — even the unmeasured ones. */
  clauses: GaplessClause[]
  /** ISO-8601 UTC instant the report was assembled. */
  generated_at: string
}
