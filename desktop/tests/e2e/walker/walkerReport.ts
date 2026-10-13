/**
 * Markdown formatter for the walker's findings report.
 *
 * The orchestrator enriches each {@link Finding} with the last-ten-steps repro
 * trail and a screenshot path, then this module renders ``findings.md``. The
 * string building is pure (the grep-stable summary line the session main scans
 * for is unit tested without the app); the one impure step is resolving a
 * bundled ``assets/<chunk>.js:line:col`` frame in a detail back to its source
 * line via the emitted ``.map`` (injectable, defaults to reading disk, no-ops
 * when no map is present — so a mapless run still renders a valid report).
 */

import type { Finding } from './walkerInvariants'
import { resolveDetailSourceLocation } from './walkerSourceMap'

/** A finding plus the context the report needs to make it reproducible. */
export interface ReportFinding extends Finding {
  /** The last up-to-ten action notes ending at this step -- the reproduction. */
  readonly trail: readonly string[]
  /** Path (relative to the results dir) of the screenshot taken at the finding. */
  readonly screenshot?: string
}

/** Run-level facts printed in the report header. */
export interface RunMeta {
  readonly seed: number
  readonly steps: number
  readonly stepBudget: number
  readonly timeBudgetS: number
  readonly durationS: number
  readonly stagesVisited: readonly string[]
  readonly projectId: string
  readonly startedAt: string
  readonly appCrashed: boolean
  /** Which of the invocation's runs this is (``WALKER_RUNS``); absent = a single run. */
  readonly run?: { readonly index: number; readonly total: number }
  /** Project switches made, with their outcomes (owner 2026-10-13). */
  readonly projectSwitches?: readonly string[]
}

/**
 * The one line the session main greps to see how a run went. Stable prefix.
 *
 * @param findings - All findings from the run.
 * @returns ``WALKER: <n> findings``.
 */
export function summaryLine(findings: readonly Finding[]): string {
  return `WALKER: ${findings.length} findings`
}

/**
 * The grep line over several runs (``WALKER_RUNS``): the same prefix as
 * :func:`summaryLine`, with the total over every run that reported.
 *
 * @param perRun - The finding count of each run that reported.
 * @param planned - How many runs the invocation planned.
 * @returns ``WALKER: <total> findings over <reported> of <planned> runs``.
 */
export function totalSummaryLine(perRun: readonly number[], planned: number): string {
  const total = perRun.reduce((a, b) => a + b, 0)
  return `WALKER: ${total} findings over ${perRun.length} of ${planned} runs`
}

/** Count findings per invariant name, sorted by descending count then name. */
function tally(findings: readonly Finding[]): Array<[string, number]> {
  const counts = new Map<string, number>()
  for (const f of findings) counts.set(f.invariant, (counts.get(f.invariant) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
}

/**
 * Render the full ``findings.md`` for a run.
 *
 * @param meta - Run-level facts.
 * @param findings - The enriched findings, in the order they occurred.
 * @param resolveDetail - Maps a finding detail to one enriched with its source
 *   location (a bundle frame resolved through the chunk's ``.map``). Injectable
 *   for tests; defaults to the disk-backed resolver, which returns the detail
 *   unchanged when there is no frame or no map.
 * @returns The markdown document.
 */
export function formatReport(
  meta: RunMeta,
  findings: readonly ReportFinding[],
  resolveDetail: (detail: string) => string = resolveDetailSourceLocation,
): string {
  const lines: string[] = []
  lines.push('# Walker scenario pass')
  lines.push('')
  // The grep line first, so a truncated tail still carries the count.
  lines.push(summaryLine(findings))
  lines.push('')
  lines.push('## Run')
  lines.push('')
  lines.push(`- seed: \`${meta.seed}\` (set WALKER_SEED to replay)`)
  lines.push(`- steps run: ${meta.steps} of ${meta.stepBudget} (time budget ${meta.timeBudgetS} s)`)
  lines.push(`- duration: ${meta.durationS.toFixed(1)} s`)
  lines.push(`- project id: ${meta.projectId}`)
  lines.push(`- stages visited: ${meta.stagesVisited.join(', ') || 'none'}`)
  lines.push(`- started: ${meta.startedAt}`)
  lines.push(`- app crashed: ${meta.appCrashed ? 'YES' : 'no'}`)
  if (meta.run) lines.push(`- run: ${meta.run.index} of ${meta.run.total}`)
  if (meta.projectSwitches) {
    lines.push(`- project switches: ${meta.projectSwitches.length === 0 ? 'none' : meta.projectSwitches.join('; ')}`)
  }
  lines.push('')

  lines.push('## Findings by invariant')
  lines.push('')
  if (findings.length === 0) {
    lines.push('None. The novice walk surfaced no invariant violations this run.')
    lines.push('')
  } else {
    for (const [name, n] of tally(findings)) lines.push(`- ${name}: ${n}`)
    lines.push('')
    lines.push('## Findings')
    lines.push('')
    findings.forEach((f, i) => {
      lines.push(`### ${i + 1}. [${f.invariant}] step ${f.step}`)
      lines.push('')
      lines.push(`- detail: ${resolveDetail(f.detail)}`)
      if (f.screenshot) lines.push(`- screenshot: ${f.screenshot}`)
      lines.push('- reproduction (last steps, oldest first):')
      if (f.trail.length === 0) {
        lines.push('  - (no prior steps recorded)')
      } else {
        f.trail.forEach((note, j) => {
          const stepNo = f.step - (f.trail.length - 1 - j)
          lines.push(`  - step ${stepNo}: ${note}`)
        })
      }
      lines.push('')
    })
  }
  return lines.join('\n')
}
