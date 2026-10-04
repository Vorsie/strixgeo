// The raw lab tests (oedometer / triaxial series) of ONE borehole, fetched
// once per borehole and grouped by sample in memory (owner ruling 2026-10-04,
// option a: the tests live in the sample slide-in, and the samples track
// flags every sample that has one). One request per borehole, never one per
// sample. Re-reads when an import or a delete reports a change
// (useLabSeriesRevision).

import { useEffect, useMemo, useState } from 'react'

import { api } from '../api/client'
import type { LabSeriesTestSummary } from '../api/client'
import { log } from '../utils/log'
import { useLabSeriesRevision } from './useLabSeriesRevision'

/** Where the borehole's raw-test list stands. */
export type BoreholeLabSeriesState = 'idle' | 'loading' | 'failed' | 'ready'

/** The borehole's raw tests, flat and grouped by sample id. */
export interface BoreholeLabSeries {
  state: BoreholeLabSeriesState
  /** Every raw test of the borehole (empty until ready). */
  tests: readonly LabSeriesTestSummary[]
  /** The same tests keyed by ``sample_id``. */
  bySample: ReadonlyMap<string, readonly LabSeriesTestSummary[]>
}

const EMPTY: readonly LabSeriesTestSummary[] = []

/**
 * Fetch the raw lab tests of one borehole.
 *
 * @param projectId - Active project; ``undefined`` = no fetch (state ``idle``),
 *   for read-only mounts and tests that render the log alone.
 * @param boreholeId - The borehole whose tests to list.
 * @returns The list, its per-sample grouping and the load state.
 */
export function useBoreholeLabSeries(projectId: string | undefined, boreholeId: string): BoreholeLabSeries {
  const revision = useLabSeriesRevision()
  const [load, setLoad] = useState<{ state: BoreholeLabSeriesState; tests: readonly LabSeriesTestSummary[] }>({
    state: projectId ? 'loading' : 'idle',
    tests: EMPTY,
  })

  useEffect(() => {
    if (!projectId) {
      setLoad({ state: 'idle', tests: EMPTY })
      return
    }
    let alive = true
    setLoad(prev => ({ state: prev.state === 'ready' ? 'ready' : 'loading', tests: prev.tests }))
    api.labSeries
      .listForBorehole(projectId, boreholeId)
      .then(tests => {
        if (!alive) return
        log.debug('labSeries', `borehole ${boreholeId}: ${tests.length} raw lab test(s)`)
        setLoad({ state: 'ready', tests })
      })
      .catch(err => {
        if (!alive) return
        log.warn('labSeries', `raw lab tests of borehole ${boreholeId} not loaded: ${String(err)}`)
        setLoad({ state: 'failed', tests: EMPTY })
      })
    return () => {
      alive = false
    }
  }, [projectId, boreholeId, revision])

  const bySample = useMemo(() => {
    const map = new Map<string, LabSeriesTestSummary[]>()
    for (const test of load.tests) {
      const list = map.get(test.sample_id)
      if (list) list.push(test)
      else map.set(test.sample_id, [test])
    }
    return map
  }, [load.tests])

  return { state: load.state, tests: load.tests, bySample }
}
