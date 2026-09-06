// The React hook that feeds the tutorial's done conditions (spec §Architecture).
//
// It reads the shell bus via `useShell()` and derives the observable facts. The
// derivation is pure (`deriveTutorialState`) and unit-tested on its own; this
// hook is the thin wrapper. It returns a VALUE-MEMOISED object so its identity
// is stable while the facts are unchanged — the overlay's advance effect depends
// on it, and a fresh object every render would re-fire that effect endlessly.
//
// `TutorialOverlay` is mounted inside a `ShellContext.Provider` (App wraps it),
// so `useShell()` returns a real value. The null guard is belt-and-braces: the
// context default is `null` outside any provider, and returning the empty state
// there is safer than throwing on a mis-wire.

import { useMemo } from 'react'

import { useShell, type ShellContextValue } from '../shell/ShellContext'
import { deriveTutorialState, emptyTutorialState, type TutorialState } from './tutorialState'

/**
 * The tutorial's observable state, derived from the shell bus.
 *
 * Returns
 * -------
 * TutorialState
 *     Value-stable across renders where none of the facts changed.
 */
export function useTutorialState(): TutorialState {
  const shell = useShell() as ShellContextValue | null
  const state = shell ? deriveTutorialState(shell) : emptyTutorialState()
  // reason: the memo returns the derived state keyed on its PRIMITIVE fields; the
  // `state` object is intentionally recreated every render (deriveTutorialState is
  // pure), so listing `state` would defeat the memo and re-fire every dependent
  // effect on each render. The field list IS the real dependency set.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(
    () => state,
    [
      state.projectOpen,
      state.cptCount,
      state.boreholeCount,
      state.sectionCount,
      state.twoSectionsExist,
      state.geoModelExists,
      state.contactCount,
      state.lumpingCount,
      state.lithoAcceptedCount,
      state.lithoSolidsBuilt,
      state.geotechModelExists,
      state.cptOpen,
      state.boreholeOpen,
      state.projectSettingsOpen,
      state.crsSet,
      state.datumSet,
      state.importMenuOpen,
      state.lithoModelExists,
      state.lithoAxisActive,
      state.geotechAxisActive,
      state.sectionOpen,
      state.geoSurfacesBuilt,
      state.geotechSolidsBuilt,
    ],
  )
}
