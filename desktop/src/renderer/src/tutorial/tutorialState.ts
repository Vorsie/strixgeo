// The tutorial's observable state — the handful of facts a step's `done`
// condition reads to know the user actually did the thing (spec §Architecture).
//
// Assumption A4 (spec): every done condition auto-advances on OBSERVABLE state,
// nothing is faked or scripted. Each fact below is derived from the shell bus
// (`useShell()`), so the tutorial reads exactly what the app itself renders.
//
// `deriveTutorialState` is kept pure (it takes a plain facts object, not the
// live context) so the done-condition logic is unit-testable without mounting a
// provider. `useTutorialState()` (the React hook) is the thin wrapper that feeds
// it `useShell()` — see `useTutorialState.ts`.

/**
 * The observable facts the tutorial's `done` conditions read.
 *
 * Every field is either a boolean flag ("a project is open") or a count
 * ("CPT count > 0"). A `done.state` condition is satisfied when its named field
 * is truthy — `Boolean(count)` is `false` at 0 and `true` above it, so counts
 * and flags share one satisfaction rule (see `tutorialMachine.ts`).
 */
export interface TutorialState {
  /** A project is open (the shell carries a real project, not the welcome gate). */
  projectOpen: boolean
  /** Number of CPTs visible in the current project. */
  cptCount: number
  /** Number of boreholes visible in the current project. */
  boreholeCount: number
  /** Number of cross-sections created. */
  sectionCount: number
  /** A geological model exists (has an active model). */
  geoModelExists: boolean
  /** Number of geological formation contacts. */
  contactCount: number
  /** Number of stratigraphy units lumped together (0 when no lumping is applied). */
  lumpingCount: number
  /** Number of ACCEPTED litho layers (pending / rejected do not count). */
  lithoAcceptedCount: number
  /** Litho 3-D solids have been built. */
  lithoSolidsBuilt: boolean
  /** A geotechnical model exists (has an active model). */
  geotechModelExists: boolean
  /** A CPT detail is open — a row was clicked and its chart is showing. */
  cptOpen: boolean
  /** A borehole detail is open — a row was clicked and its log is showing. */
  boreholeOpen: boolean
}

/**
 * The first-launch state — every flag false, every count zero. The canonical
 * source of the runtime key list (`Object.keys(emptyTutorialState())`), which
 * the catalogue test uses to assert every `done.state` names a real fact.
 *
 * @returns  A `TutorialState` with all facts unmet.
 */
export function emptyTutorialState(): TutorialState {
  return {
    projectOpen: false,
    cptCount: 0,
    boreholeCount: 0,
    sectionCount: 0,
    geoModelExists: false,
    contactCount: 0,
    lumpingCount: 0,
    lithoAcceptedCount: 0,
    lithoSolidsBuilt: false,
    geotechModelExists: false,
    cptOpen: false,
    boreholeOpen: false,
  }
}

/**
 * The narrow slice of the shell bus the tutorial reads.
 *
 * Deliberately structural and loose (arrays as `readonly unknown[]`, model
 * handles as `unknown`) so the real `ShellContextValue` is assignable to it
 * without the tutorial coupling to every stage hook's full result type — and so
 * a test can build a fact object by hand in a few lines.
 */
export interface TutorialShellFacts {
  /** The active project, or `null` on the welcome gate. */
  project: unknown
  /** The manifest-filtered visible CPT list. */
  visibleCpts: readonly unknown[]
  /** The manifest-filtered visible borehole list. */
  visibleBoreholes: readonly unknown[]
  /** The cross-sections slice (`sections.sections` is the list). */
  sections: { readonly sections: readonly unknown[] }
  /** The geological-model slice. */
  geoModel: {
    /** Active geological model handle, or `null`. */
    activeGeologicalModel: unknown
    /** Formation contacts. */
    contacts: readonly unknown[]
    /** Litho layers, each carrying a `status`. */
    lithoLayers: readonly { readonly status: string }[]
    /** Whether litho 3-D solids have been built. */
    hasLithoSolids: boolean
    /** Active geotechnical model handle, or `null`. */
    activeGeotechModel: unknown
  }
  /** The project lifecycle slice (carries the stratigraphy lumping snapshot). */
  lifecycle: { readonly currentLumping: { readonly map: Record<string, string> } | null }
  /** The selection coordinator slice — a selected CPT / borehole means its
   *  detail view (chart / log) is open (owner ruling 7). */
  coordinator: { readonly selectedId: string | null; readonly selectedBoreholeId: string | null }
}

/**
 * Derive the tutorial's observable state from the shell facts.
 *
 * Parameters
 * ----------
 * facts : TutorialShellFacts
 *     The slice of the shell bus the tutorial reads.
 *
 * Returns
 * -------
 * TutorialState
 *     The flags and counts every `done` condition evaluates against.
 */
export function deriveTutorialState(facts: TutorialShellFacts): TutorialState {
  const lumping = facts.lifecycle.currentLumping
  return {
    projectOpen: facts.project != null,
    cptCount: facts.visibleCpts.length,
    boreholeCount: facts.visibleBoreholes.length,
    sectionCount: facts.sections.sections.length,
    geoModelExists: facts.geoModel.activeGeologicalModel != null,
    contactCount: facts.geoModel.contacts.length,
    // "A lumping exists" = it lumps at least one unit; an empty map is not one.
    lumpingCount: lumping ? Object.keys(lumping.map).length : 0,
    lithoAcceptedCount: facts.geoModel.lithoLayers.filter(l => l.status === 'accepted').length,
    lithoSolidsBuilt: facts.geoModel.hasLithoSolids,
    geotechModelExists: facts.geoModel.activeGeotechModel != null,
    cptOpen: facts.coordinator.selectedId != null,
    boreholeOpen: facts.coordinator.selectedBoreholeId != null,
  }
}
