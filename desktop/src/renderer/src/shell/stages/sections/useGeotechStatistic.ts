// The representative-qc statistic state machine for the geotech-axis toolbar.
//
// Extracted verbatim from ``SectionsToolbar`` (debt #201). It owns the two
// renderer-held pieces of statistic state — the per-model bridge answer and the
// pre-model pending choice — plus their reconciliation effects and the setter.
// The derived label + staleness flag come out of the hook so the toolbar reads
// them without carrying the machinery. Bodies are byte-identical to the inline
// original; only the surrounding declaration moved.

import { useCallback, useEffect, useState } from 'react'

import { api } from '../../../api/client'
import type { GeologicalModelResponse, ProjectResponse } from '../../../api/client'
import { DEFAULT_GEOTECH_STATISTIC, type GeotechStatistic } from '../../../utils/geotechStatistic'
import { t } from '../../../i18n/translate'

/** What the statistic hook needs from the shell bus. */
export interface UseGeotechStatisticDeps {
  /** Active project (holds the id the statistic write posts to). */
  project: ProjectResponse
  /** Active geotech model — ``null`` before the first subdivide. */
  activeGeotechModel: GeologicalModelResponse | null
  /** Mark the project dirty (two-stage save model). */
  markMutated: () => void
  /** Toast stack action. */
  toast: (type: 'success' | 'error' | 'warning', message: string) => void
}

/** The derived statistic read-outs + setter the toolbar renders from. */
export interface UseGeotechStatisticResult {
  /**
   * The statistic the NEXT subdivide will classify with (or the one the bands
   * on screen were built with, once a model exists).
   */
  geotechStatistic: string
  /** True when the classified-with statistic differs from the chosen one. */
  geotechBandsStale: boolean
  /** The pre-model pending choice, handed to the first subdivide (else null). */
  pendingStatistic: GeotechStatistic | null
  /** Set the representative statistic (parks it pre-model, POSTs it post-model). */
  handleSetGeotechStatistic: (statistic: GeotechStatistic) => void
}

/**
 * Own the geotech representative-qc statistic state + its derivations.
 *
 * Parameters
 * ----------
 * deps : UseGeotechStatisticDeps
 *     Project, active geotech model, and the two shell actions the setter fires.
 *
 * Returns
 * -------
 * UseGeotechStatisticResult
 *     The derived statistic label, staleness flag, pending choice + setter.
 */
export function useGeotechStatistic({
  project,
  activeGeotechModel,
  markMutated,
  toast,
}: UseGeotechStatisticDeps): UseGeotechStatisticResult {
  // The representative-qc statistic (rulings 7+8). The server answer is held
  // locally per model until the next refreshModels naturally refreshes the
  // model row; staleness is DERIVED (classified_with != representative) and
  // never stored. Ruling 8: changing the choice re-derives NOTHING - the tag
  // on step 1 is how the debt surfaces.
  const [statisticState, setStatisticState] = useState<{
    modelId: string
    statistic: string
    classifiedWith: string | null
  } | null>(null)
  // The choice made BEFORE any geotech model exists (owner 2026-08-15: "i
  // can't choose harmonic qc before first subdivide, that's friction we don't
  // need?"). It cannot be written anywhere — the column it lives in belongs to
  // a row step 1 has not created yet — so it is held here and handed to the
  // FIRST subdivide, which creates the model under it. Dropped the moment a
  // model exists (effect below): from then on the MODEL is what the label
  // must show, so a build that ignored the request cannot be papered over.
  const [pendingStatistic, setPendingStatistic] = useState<GeotechStatistic | null>(null)
  // With no model there is no column to read, so the engineer's own pending
  // choice IS the answer — shown exactly as a committed one, because to him it
  // is the same decision. With a model, the model wins: the local bridge, then
  // its own column, then the backend default.
  const geotechStatistic: string =
    !activeGeotechModel
      ? (pendingStatistic ?? DEFAULT_GEOTECH_STATISTIC)
      : ((statisticState?.modelId === activeGeotechModel.id
          ? statisticState?.statistic
          : undefined) ??
        activeGeotechModel.representative_statistic ??
        DEFAULT_GEOTECH_STATISTIC)
  const geotechClassifiedWith =
    statisticState !== null && statisticState.modelId === activeGeotechModel?.id
      ? statisticState.classifiedWith
      : (activeGeotechModel?.classified_with_statistic ?? null)
  const geotechBandsStale =
    geotechClassifiedWith !== null && geotechClassifiedWith !== geotechStatistic
  // The local answer is a BRIDGE, not a cache: it covers the gap between the
  // statistic write and the next model refresh, then gets out of the way. Once
  // the refreshed row agrees about the choice it is authoritative about what
  // the bands were classified with too — and holding the pre-change value past
  // that point pins the "re-run under X" tag on forever, inviting the engineer
  // to press a verb that wipes and rebuilds every band on each press.
  useEffect(() => {
    if (statisticState === null) return
    if (activeGeotechModel === null || activeGeotechModel.id !== statisticState.modelId) {
      setStatisticState(null)
      return
    }
    if (activeGeotechModel.representative_statistic === statisticState.statistic) {
      setStatisticState(null)
    }
  }, [activeGeotechModel, statisticState])

  // The pre-model choice retires the instant a model exists. Keeping it would
  // let the label promise a statistic the build did not use — and from here on
  // the statistic route, not a renderer-held value, is what changes the model.
  useEffect(() => {
    if (activeGeotechModel && pendingStatistic !== null) setPendingStatistic(null)
  }, [activeGeotechModel, pendingStatistic])

  const handleSetGeotechStatistic = useCallback(
    (statistic: GeotechStatistic): void => {
      if (!project) return
      if (!activeGeotechModel) {
        // Nothing to write to yet — park the choice and say what will consume
        // it. No markMutated: no row changed, so the project is not dirty.
        setPendingStatistic(statistic)
        toast('success', t('sections.stat.setBuild', { statistic }))
        return
      }
      void api.geology
        .setGeotechStatistic(project.id, activeGeotechModel.id, statistic)
        .then(result => {
          setStatisticState({
            modelId: activeGeotechModel.id,
            statistic: result.representative_statistic,
            classifiedWith: result.classified_with_statistic,
          })
          markMutated()
          toast(
            'success',
            result.bands_stale
              ? t('sections.stat.setReclassify', { statistic })
              : t('sections.stat.set', { statistic }),
          )
        })
        .catch((err: unknown) => {
          toast('error', err instanceof Error ? err.message : t('sections.toolbar.statisticFailed'))
        })
    },
    [project, activeGeotechModel, markMutated, toast],
  )

  return { geotechStatistic, geotechBandsStale, pendingStatistic, handleSetGeotechStatistic }
}
