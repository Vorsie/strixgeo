/**
 * The walker's on-disk step trail: ``<resultsDir>/trail.log``.
 *
 * Playwright's reporters swallow the test's ``console.log``, so a run that hung
 * (run 14, 2026-09-10: twenty minutes of silence) said nothing about where.
 * Every step is appended here BEFORE its action runs, synchronously, so the
 * last line of a hung run's file is the step it hung on. A write failure never
 * reaches the walk: the trail is a witness, not a gate.
 */

import fs from 'fs'
import path from 'path'

/** Name of the trail file inside a run's results directory. */
export const TRAIL_FILE = 'trail.log'

/**
 * One trail line.
 *
 * @param step - The 0-based step index.
 * @param stage - The stage the step started on, or null when undetectable.
 * @param kind - The action kind.
 * @param note - The action's human note.
 * @returns ``step <n> stage=<stage|?> <kind>: <note>``.
 */
export function formatTrailLine(step: number, stage: string | null, kind: string, note: string): string {
  return `step ${step} stage=${stage ?? '?'} ${kind}: ${note}`
}

/** Appends trail lines to ``<dir>/trail.log`` as the walk goes. */
export class TrailWriter {
  private readonly file: string

  /**
   * @param dir - The run's results directory (created by the orchestrator).
   */
  constructor(dir: string) {
    this.file = path.join(dir, TRAIL_FILE)
  }

  /** Append one step line (before the action runs). */
  step(step: number, stage: string | null, kind: string, note: string): void {
    this.append(formatTrailLine(step, stage, kind, note))
  }

  /** Append a free note (a switch outcome, a reopen, a run boundary). */
  note(text: string): void {
    this.append(text)
  }

  private append(line: string): void {
    try {
      fs.appendFileSync(this.file, `${new Date().toISOString()} ${line}\n`, 'utf-8')
    } catch {
      /* the trail is a witness; a lost line must not end the walk */
    }
  }
}
