/**
 * The geotech "Build model" press, and the question it asks first.
 *
 * Owner ruling 2026-08-26: *"yes that suggestion is fine, these 2 tests… but
 * ofcourse make it so that user can go to those test through one click. Build
 * without them should produce the model that was there before the added tests,
 * so just plain ignore them."* — serving *"I can't have gaps or fallbacks in
 * the model unless users make mistakes."*
 *
 * The press has four outcomes and this hook owns the walk between them:
 *
 * 1. Nothing to ask (the finished-model case, and today's behaviour) → build.
 * 2. Ask → the dialog names the tests, each one a click away.
 * 3. "Subdivide them & build" → run the machine-safe presses, WAIT for the
 *    bands to reach the renderer, then build. The wait is not optional: the
 *    presses finish by bumping a refetch nonce whose GET runs on a later
 *    render, and the voxel builder is a closure over ``geotechLayers``, so
 *    building on the spot would post the payload from before the press.
 * 4. "Build without them" → build with those tests excluded from BOTH the
 *    packing columns and the litho frame, then say so on a chip.
 *
 * Lives beside ``GeotechnicalToolbar`` rather than inside it: the toolbar is a
 * render function, this is a four-state machine with a watchdog.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useShell } from '../../ShellContext'
import { nextVisitIndex } from '../../../components/sections/tieVisitNav'
import {
  geotechBuildPreflight,
  type GeotechBuildPreflightInputs,
  type UnbandedTest,
} from '../../../utils/geotechBuildPreflight'
import { log } from '../../../utils/log'
import { geotechVoxelRequestCallback } from './GeotechnicalCanvas'
import { GEOTECH_BAND_WAIT_MS } from './useGeotechBuildPreflight_constants'

/** Nothing excluded — the ordinary whole-model build, exactly as before. */
const NOTHING_EXCLUDED = undefined

/** Where the press currently is. */
type Phase =
  /** No press in flight. */
  | { kind: 'idle' }
  /** The dialog is open on these findings. */
  | { kind: 'asking'; tests: readonly UnbandedTest[] }
  /** The subdivide / divide verbs are running. */
  | { kind: 'subdividing' }
  /** The verbs are done; waiting for their bands to reach the renderer. */
  | { kind: 'awaiting-bands'; investigationIds: readonly string[] }

/** What the toolbar needs to render and drive the press. */
export interface UseGeotechBuildPreflightResult {
  /** The Build button's onClick. */
  pressBuild: () => void
  /** Tests the dialog is open on, or ``null`` when it is closed. */
  askingAbout: readonly UnbandedTest[] | null
  /** Send the engineer to this test on a section that carries it. */
  visitTest: (test: UnbandedTest) => void
  /** Dialog default: run the presses, then build once the bands land. */
  subdivideAndBuild: () => Promise<void>
  /** Dialog: build ignoring the flagged tests entirely. */
  buildWithout: () => void
  /** Dialog: close without building. */
  cancel: () => void
  /** Tests the LAST build left out — what the post-build chip lists. */
  excludedFromLastBuild: readonly UnbandedTest[]
  /** Visit the next excluded test, wrapping at the end (the chip's press). */
  visitNextExcluded: () => void
  /** True while the presses run or their bands are awaited. */
  busy: boolean
}

/**
 * Own the geotech Build press: the pre-flight, the dialog, and the exclusion.
 *
 * Returns
 * -------
 * UseGeotechBuildPreflightResult
 *     The press, the dialog state and actions, and the post-build chip's list.
 */
export function useGeotechBuildPreflight(): UseGeotechBuildPreflightResult {
  const {
    visibleCpts,
    visibleBoreholes,
    sections: { visibleSections },
    geoModel: {
      lithoLayers,
      geotechLayers,
      buildGeotechSolids,
      handleSubdivideAllBodies,
      handleDivideBoreholes,
    },
    coordinator: { setSectionsDeepLinkTarget },
    toasts: { toast },
  } = useShell()

  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [excludedFromLastBuild, setExcludedFromLastBuild] = useState<readonly UnbandedTest[]>([])
  // A ref, not state: cycling the chip must not re-render the stage.
  const visitRef = useRef<number | null>(null)

  const investigations = useMemo(
    () => [
      ...visibleCpts.map(c => ({
        id: c.id,
        name: c.name,
        location_x: c.location_x,
        location_y: c.location_y,
        elevation_m: c.elevation_m,
      })),
      ...visibleBoreholes.map(b => ({
        id: b.id,
        name: b.name,
        location_x: b.location_x,
        location_y: b.location_y,
        elevation_m: b.elevation_m,
      })),
    ],
    [visibleCpts, visibleBoreholes],
  )

  const inputs = useMemo<GeotechBuildPreflightInputs>(
    () => ({
      visibleSections: visibleSections.map(s => ({
        id: s.id,
        name: s.name,
        start_x: s.start_x,
        start_y: s.start_y,
        end_x: s.end_x,
        end_y: s.end_y,
        projection_buffer_m: s.projection_buffer_m,
        excluded_cpt_ids: s.excluded_cpt_ids,
        excluded_borehole_ids: s.excluded_borehole_ids,
      })),
      investigations,
      lithoLayers,
      geotechLayers,
    }),
    [visibleSections, investigations, lithoLayers, geotechLayers],
  )

  // Read through a ref inside the callbacks so a press always acts on what the
  // stage is showing NOW, without every callback changing identity on each pan.
  const inputsRef = useRef(inputs)
  inputsRef.current = inputs

  const runBuild = useCallback(
    (excludedInvestigationIds?: ReadonlySet<string>) => {
      const builder = geotechVoxelRequestCallback.current
      if (builder === null || excludedInvestigationIds === undefined) {
        // Today's call site, verbatim — the ordinary build must not become a
        // different call just because a pre-flight now stands in front of it.
        log.info('geotech-voxel', 'build press: whole model')
        void buildGeotechSolids(builder ?? undefined)
        return
      }
      log.info(
        'geotech-voxel',
        `build press: ignoring ${excludedInvestigationIds.size} investigation(s) — ` +
          `${[...excludedInvestigationIds].join(', ')}`,
      )
      // Wrapped, because ``buildGeotechSolids`` takes a zero-argument builder
      // and the exclusion set has to travel with this one build only.
      void buildGeotechSolids(() => builder(excludedInvestigationIds))
    },
    [buildGeotechSolids],
  )

  const pressBuild = useCallback(() => {
    const { unbandedTests } = geotechBuildPreflight(inputsRef.current)
    if (unbandedTests.length === 0) {
      runBuild(NOTHING_EXCLUDED)
      return
    }
    log.info(
      'geotech-voxel',
      `build pre-flight: ${unbandedTests.length} test(s) in the model carry no packing bands — ` +
        unbandedTests.map(t => t.name).join(', '),
    )
    setPhase({ kind: 'asking', tests: unbandedTests })
  }, [runBuild])

  /** Deep-link to a section that carries this test and pulse its column. */
  const visitTest = useCallback(
    (test: UnbandedTest) => {
      log.info(
        'geotech-voxel',
        `pre-flight visit: ${test.name} on section ${test.revealSectionId}`,
      )
      setPhase({ kind: 'idle' })
      setSectionsDeepLinkTarget({
        sectionId: test.revealSectionId,
        // Empty on purpose: this deep-link is about a COLUMN, and
        // ``handleFocusContacts`` no-ops on an empty list, so the two halves of
        // the shared payload never fight over the camera.
        contactIds: [],
        sectionModelAxis: 'geotechnical',
        // One id: this deep-link is about ONE test, so the panel centres AND
        // pulses that column. (Two ids would name a gap — the gapless report's
        // "Show me" — and pulse nothing.)
        revealInvestigationIds: [test.investigationId],
      })
    },
    [setSectionsDeepLinkTarget],
  )

  const subdivideAndBuild = useCallback(async () => {
    if (phase.kind !== 'asking') return
    const tests = phase.tests
    const boreholeIds = new Set(visibleBoreholes.map(b => b.id))
    const flaggedBoreholeIds = tests
      .map(t => t.investigationId)
      .filter(id => boreholeIds.has(id))
    const hasFlaggedCpt = tests.some(t => !boreholeIds.has(t.investigationId))
    setPhase({ kind: 'subdividing' })
    log.info(
      'geotech-voxel',
      `pre-flight subdivide: ${hasFlaggedCpt ? 'CPT columns + ' : ''}` +
        `${flaggedBoreholeIds.length} borehole(s)`,
    )
    // ``deriveEdges: false`` is the ``subdivideCpts`` verb, and it is the one
    // that carries skip-existing — the combined ``subdivideAllBodies`` re-derives
    // every edge model-wide and does not. This press must only fill in what is
    // missing, never rewrite what the engineer already has.
    if (hasFlaggedCpt) {
      await handleSubdivideAllBodies({ deriveEdges: false, rebuildExisting: false })
    }
    // Scoped to the flagged boreholes; an empty list is never sent (the bus
    // refuses it, and "divide none" is never what a click means). No
    // ``sectionPartitions``: assembling one needs the Sections canvas, which is
    // not mounted on this stage, so the backend applies its donor rule — the
    // documented behaviour for a caller that has no partition to offer.
    if (flaggedBoreholeIds.length > 0) {
      await handleDivideBoreholes({ boreholeIds: flaggedBoreholeIds, skipExisting: true })
    }
    setPhase({ kind: 'awaiting-bands', investigationIds: tests.map(t => t.investigationId) })
  }, [phase, visibleBoreholes, handleSubdivideAllBodies, handleDivideBoreholes])

  const buildWithout = useCallback(() => {
    if (phase.kind !== 'asking') return
    const tests = phase.tests
    setPhase({ kind: 'idle' })
    setExcludedFromLastBuild(tests)
    visitRef.current = null
    runBuild(new Set(tests.map(t => t.investigationId)))
  }, [phase, runBuild])

  const cancel = useCallback(() => {
    setPhase({ kind: 'idle' })
  }, [])

  const visitNextExcluded = useCallback(() => {
    const index = nextVisitIndex(visitRef.current, excludedFromLastBuild.length)
    if (index === null) {
      visitRef.current = null
      return
    }
    visitRef.current = index
    visitTest(excludedFromLastBuild[index])
  }, [excludedFromLastBuild, visitTest])

  // The wait between "the presses finished" and "their bands are on the bus".
  // Re-runs the SAME pre-flight rather than a private has-bands test, so the
  // condition it waits for is exactly the condition that stopped the press.
  useEffect(() => {
    if (phase.kind !== 'awaiting-bands') return
    const requested = new Set(phase.investigationIds)
    const stillUnbanded = geotechBuildPreflight(inputs).unbandedTests.filter(t =>
      requested.has(t.investigationId),
    )
    if (stillUnbanded.length === 0) {
      setPhase({ kind: 'idle' })
      runBuild(NOTHING_EXCLUDED)
      return
    }
    // Bounded, so a column the press could not band cannot leave the Build
    // button silently doing nothing for the rest of the session.
    const timer = window.setTimeout(() => {
      setPhase({ kind: 'idle' })
      const names = stillUnbanded.map(t => t.name).join(', ')
      log.warn(
        'geotech-voxel',
        `pre-flight give-up: still no packing bands for ${names} — nothing was built`,
      )
      toast(
        'warning',
        `${names} still ${stillUnbanded.length === 1 ? 'has' : 'have'} no packing bands, ` +
          'so nothing was built — subdivide on the Sections stage, then Build again.',
      )
    }, GEOTECH_BAND_WAIT_MS)
    return () => window.clearTimeout(timer)
    // reason: ``toast`` is the ref-stable action from useToasts; listing it
    // would suggest a toast change should restart the wait.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, inputs, runBuild])

  return {
    pressBuild,
    askingAbout: phase.kind === 'asking' ? phase.tests : null,
    visitTest,
    subdivideAndBuild,
    buildWithout,
    cancel,
    excludedFromLastBuild,
    visitNextExcluded,
    busy: phase.kind === 'subdividing' || phase.kind === 'awaiting-bands',
  }
}
