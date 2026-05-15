// Shell data bus — all hook results from App.tsx assembled into one context.
//
// §8 Risk 2 mitigation: the context value MUST be wrapped in ``useMemo``
// at the provider site (App.tsx). If assembled inline as an object literal,
// every App render recreates the object and every ``useShell()`` consumer
// re-renders — even when nothing in their slice changed. The ``useMemo``
// makes identity stable across renders where only unrelated state changed.
//
// Consumers call ``useShell()`` and destructure only the slice they need.
// The hook does NOT add a per-field selector abstraction — the cost of
// pulling in the full context value is a single ``useContext`` read, not a
// re-render, because React only re-renders when the context *value reference*
// changes (which the ``useMemo`` prevents unless something in the dep array
// actually changed).

import { createContext, useContext } from 'react'

import type { UseToastsResult } from '../hooks/useToasts'
import type { UseAppBootResult } from '../hooks/useAppBoot'
import type { UseGeologicalModelResult } from '../hooks/useGeologicalModel'
import type { UseSectionsResult } from '../hooks/useSections'
import type { UseMapOverlaysResult } from '../hooks/useMapOverlays'
import type { UseProjectLifecycleResult } from '../hooks/useProjectLifecycle'
import type { UseInvestigationDataResult } from '../hooks/useInvestigationData'
import type { UseUndoStackResult } from '../hooks/useUndoStack'
import type { CptListItem, BoreholeListItem, ProjectResponse } from '../api/client'

/**
 * The full app state bus carried through the shell.
 *
 * Each field is the verbatim return value of the corresponding hook in
 * App.tsx.  Stage components read from this via ``useShell()`` rather than
 * receiving prop avalanches from the shell.
 *
 * ``project`` is lifted out of ``lifecycle`` for ergonomics — it is the
 * most-read field and saves a destructuring level for every consumer.
 */
export interface ShellContextValue {
  /** Active project (never null inside AppShell — the project gate in
   *  App.tsx ensures AppShell only mounts when a project is loaded). */
  project: ProjectResponse
  /** Project lifecycle — dirty flag, dialogs, save/close actions. */
  lifecycle: UseProjectLifecycleResult
  /** CPT + borehole data, import flows, hide/restore, elevation edits. */
  investigations: UseInvestigationDataResult
  /**
   * Manifest-filtered, removed-set-filtered CPT list.
   *
   * Computed in App.tsx and carried here so stage summary hooks and
   * stage components can read the user-visible list without re-computing
   * the two-layer filter.
   */
  visibleCpts: CptListItem[]
  /**
   * Manifest-filtered, removed-set-filtered borehole list.
   *
   * Same provenance as ``visibleCpts``.
   */
  visibleBoreholes: BoreholeListItem[]
  /** Geological model — formations, contacts, surfaces, all mutation handlers. */
  geoModel: UseGeologicalModelResult
  /** Cross-sections — list, selection, draw mode, CRUD. */
  sections: UseSectionsResult
  /** DEM hillshade + Virtuele Boring overlay state and handlers. */
  overlays: UseMapOverlaysResult
  /** Toast notification stack and ``toast`` action. */
  toasts: UseToastsResult
  /** Undo / redo stack — push + undo + redo + clear. */
  undo: UseUndoStackResult
  /** API boot — ``ready`` and ``apiError`` (stable refs; rarely needed by stages). */
  boot: UseAppBootResult
}

/**
 * The shell data bus context.
 *
 * Initialised with ``null!`` so TypeScript narrows cleanly inside providers.
 * Consuming code outside a ``ShellContext.Provider`` will get a runtime error
 * (intentional — stage components must be rendered inside AppShell).
 */
export const ShellContext = createContext<ShellContextValue>(null!)

/**
 * Selector hook for the shell data bus.
 *
 * Stage components call ``useShell()`` and destructure the slice they need.
 * Must be called from within a component tree that has a
 * ``<ShellContext.Provider>`` ancestor (i.e. inside AppShell).
 *
 * Returns
 * -------
 * ShellContextValue
 *     The full assembled context value.
 *
 * Raises
 * ------
 * TypeError
 *     At runtime if called outside a ``ShellContext.Provider``.
 */
export function useShell(): ShellContextValue {
  return useContext(ShellContext)
}
