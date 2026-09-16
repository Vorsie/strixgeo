// Apply a completed voxel-build response to the litho-solid UI state.
//
// Extracted from useLithoSolids so BOTH the synchronous build path and the new
// streaming build path (debt #282, ``useVoxelBuildStream``) refresh identically:
// the solids list, the gapless verdict, the project-dirty flag, and the outcome
// toast are the same whether the build ran one-shot or as a background job.

import type { LithoBodySolidResponse, RebuildLithoSolidsResponse } from '../api/client'
import type { GaplessBuildReport } from '../utils/gaplessGate/types'
import { log } from '../utils/log'
import { t } from '../i18n/translate'

/** The setters + side-effect hooks the apply needs (owned by useLithoSolids). */
export interface VoxelBuildResultSink {
  setSolids: (solids: LithoBodySolidResponse[]) => void
  setGaplessReport: (report: GaplessBuildReport | null) => void
  toast: (type: 'success' | 'error' | 'warning', message: string) => void
  onMutated?: () => void
}

/**
 * Apply a build outcome: refresh solids + verdict, mark the project dirty, toast.
 *
 * The response already carries the updated solids list, so this applies it
 * directly (no re-fetch). Severity is DERIVED from the outcome: an empty build
 * (which also CLEARED the stored model) warns with the reason; an incomplete
 * build (uncovered investigations / under-constrained bodies) warns naming them;
 * a clean build toasts success.
 *
 * @param result - The build response (from the sync endpoint or the SSE `done`).
 * @param sink - The state setters + side-effect hooks from useLithoSolids.
 */
export function applyVoxelBuildResult(
  result: RebuildLithoSolidsResponse,
  sink: VoxelBuildResultSink,
): void {
  const { setSolids, setGaplessReport, toast, onMutated } = sink

  log.success(
    'useLithoSolids',
    `built ${result.bodies_built} voxel body solid(s), flagged=${result.bodies_flagged}`,
  )
  // Build response already carries the updated solids list — apply directly.
  setSolids(result.solids)
  // The verdict belongs to THESE solids, so it lands with them. A response with
  // no report clears the previous one rather than leaving a stale verdict beside
  // a fresh model.
  setGaplessReport(result.gapless_report ?? null)
  if (result.gapless_report) {
    const failed = result.gapless_report.clauses.filter(c => c.status === 'fail')
    const unmeasured = result.gapless_report.clauses.filter(c => c.status === 'not-evaluated')
    const line =
      `gapless gate: ${result.gapless_report.verdict} ` +
      `(${failed.length} failed, ${unmeasured.length} not evaluated)`
    // The gate fails the REPORT, never the build — a failed verdict is a warning
    // beside a successful build, not an error.
    if (result.gapless_report.verdict === 'pass') log.info('useLithoSolids', line)
    else log.warn('useLithoSolids', `${line} — ${failed.map(c => c.title).join('; ')}`)
  } else {
    log.warn(
      'useLithoSolids',
      'build returned no gapless report — the model carries no verdict for this build',
    )
  }
  // A build is an unsaved change like any other (``litho_solids`` rides in the
  // .strix bundle). AFTER the call lands, never before: a refused build changes
  // nothing.
  onMutated?.()

  const builtMsg = t('litho.builtBodies', {
    n: result.bodies_built,
    bodyWord: result.bodies_built === 1 ? t('litho.bodyWordOne') : t('litho.bodyWordMany'),
  })
  // A build that produced NOTHING also cleared the stored 3-D model. Say what
  // happened instead of a green "Built 0 bodies" over an erased model.
  if (result.empty_reason) {
    log.warn('useLithoSolids', `build produced nothing: ${result.empty_reason}`)
    toast('warning', t('litho.nothingCouldBeBuilt', { reason: result.empty_reason }))
    return
  }
  // Severity is DERIVED from what the build reported. ``uncovered_test_ids`` is
  // the harder problem — those investigations have no 3-D model at all — so it
  // leads the message.
  const uncovered = result.uncovered_test_ids ?? []
  const problems: string[] = []
  if (uncovered.length > 0) {
    const named = uncovered.slice(0, 3).join(', ')
    const rest = uncovered.length > 3 ? t('litho.moreCount', { n: uncovered.length - 3 }) : ''
    problems.push(
      t('litho.uncoveredInvestigations', {
        n: uncovered.length,
        investigationWord:
          uncovered.length === 1
            ? t('litho.investigationWordOne')
            : t('litho.investigationWordMany'),
        named,
        rest,
      }),
    )
    log.warn(
      'useLithoSolids',
      `build left ${uncovered.length} investigation(s) outside the footprint: ${uncovered.join(', ')}`,
    )
  }
  if (result.bodies_flagged > 0) {
    problems.push(
      t('litho.underConstrainedBodies', {
        n: result.bodies_flagged,
        bodyWord: result.bodies_flagged === 1 ? t('litho.bodyWordOne') : t('litho.bodyWordMany'),
      }),
    )
  }
  if (problems.length > 0) {
    toast('warning', `${builtMsg}: ${problems.join('; ')}`)
  } else {
    toast('success', builtMsg)
  }
}
