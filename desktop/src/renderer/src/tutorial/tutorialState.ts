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
  /** Two or more cross-sections exist. The second-profile steps read this so
   *  they never ask for a second profile that already exists; true at 2+ makes
   *  them complete instantly (owner ruling 3, 2026-09-06). */
  twoSectionsExist: boolean
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

  // --- owner ruling 1 (2026-09-06): facts that let every do-it step "move on
  // by itself when the user does what it says". Each is derived from real shell
  // state (no DOM polling). ---------------------------------------------------

  /** The project-settings (metadata) dialog is open. */
  projectSettingsOpen: boolean
  /** A horizontal CRS is chosen, either drafted in the open project-settings
   *  dialog or already saved on the project (owner ruling 1, 2026-09-06). */
  crsSet: boolean
  /** A vertical datum is chosen, drafted in the open dialog or already saved. */
  datumSet: boolean
  /** The Data-stage Import menu is open. */
  importMenuOpen: boolean
  /** A lithological model exists (its own active-model handle — distinct from
   *  the geological and geotechnical ones). */
  lithoModelExists: boolean
  /** The sections toolbar axis is on Litho. */
  lithoAxisActive: boolean
  /** The sections toolbar axis is on Geotech. */
  geotechAxisActive: boolean
  /** A cross-section is open (selected on the sections toolbar). */
  sectionOpen: boolean
  /** The geological formation surfaces have been built. */
  geoSurfacesBuilt: boolean
  /** The geotechnical 3-D body solids have been built. */
  geotechSolidsBuilt: boolean
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
    twoSectionsExist: false,
    geoModelExists: false,
    contactCount: 0,
    lumpingCount: 0,
    lithoAcceptedCount: 0,
    lithoSolidsBuilt: false,
    geotechModelExists: false,
    cptOpen: false,
    boreholeOpen: false,
    projectSettingsOpen: false,
    crsSet: false,
    datumSet: false,
    importMenuOpen: false,
    lithoModelExists: false,
    lithoAxisActive: false,
    geotechAxisActive: false,
    sectionOpen: false,
    geoSurfacesBuilt: false,
    geotechSolidsBuilt: false,
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
  /** The active project, or `null` on the welcome gate. Only its default CRS /
   *  datum EPSG codes are read (crsSet / datumSet). */
  project: {
    readonly default_horizontal_epsg: number | null
    readonly default_vertical_epsg: number | null
  } | null
  /** The manifest-filtered visible CPT list. */
  visibleCpts: readonly unknown[]
  /** The manifest-filtered visible borehole list. */
  visibleBoreholes: readonly unknown[]
  /** The cross-sections slice (`sections.sections` is the list). */
  sections: {
    readonly sections: readonly unknown[]
    /** The selected cross-section id, or `null` when none is open. */
    readonly selectedSectionId: string | null
    /** The sections toolbar's active model axis. */
    readonly sectionModelAxis: string
  }
  /** The geological-model slice. */
  geoModel: {
    /** Active geological model handle, or `null`. */
    activeGeologicalModel: unknown
    /** Active lithological model handle, or `null` (distinct axis). */
    activeLithoModel: unknown
    /** Formation contacts. */
    contacts: readonly unknown[]
    /** Litho layers, each carrying a `status`. */
    lithoLayers: readonly { readonly status: string }[]
    /** Whether litho 3-D solids have been built. */
    hasLithoSolids: boolean
    /** Whether geotech 3-D solids have been built. */
    hasGeotechSolids: boolean
    /** Formation surfaces keyed by formation id — non-empty once built. */
    surfacesByFormationId: { readonly size: number }
    /** Active geotechnical model handle, or `null`. */
    activeGeotechModel: unknown
  }
  /** The project lifecycle slice (lumping snapshot + the metadata-dialog flag). */
  lifecycle: {
    readonly currentLumping: { readonly map: Record<string, string> } | null
    /** Whether the project-settings (metadata) dialog is open. */
    readonly metadataEditorOpen: boolean
  }
  /** The selection coordinator slice — a selected CPT / borehole means its
   *  detail view (chart / log) is open (owner ruling 7); `importMenuOpen` is the
   *  Data-stage Import dropdown's open state (owner ruling 1, 2026-09-06). */
  coordinator: {
    readonly selectedId: string | null
    readonly selectedBoreholeId: string | null
    readonly importMenuOpen?: boolean
    /** The draft horizontal CRS EPSG chosen in the OPEN project-settings dialog,
     *  or null when the dialog is closed / no CRS drafted. Lets the CRS step
     *  advance the moment a CRS is selected, before Save (owner ruling 1,
     *  2026-09-06). */
    readonly metadataDraftHorizontalEpsg?: number | null
    /** The draft vertical datum EPSG chosen in the open dialog, same lifecycle. */
    readonly metadataDraftVerticalEpsg?: number | null
  }
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
  const project = facts.project
  return {
    projectOpen: project != null,
    cptCount: facts.visibleCpts.length,
    boreholeCount: facts.visibleBoreholes.length,
    sectionCount: facts.sections.sections.length,
    twoSectionsExist: facts.sections.sections.length >= 2,
    geoModelExists: facts.geoModel.activeGeologicalModel != null,
    contactCount: facts.geoModel.contacts.length,
    // "A lumping exists" = it lumps at least one unit; an empty map is not one.
    lumpingCount: lumping ? Object.keys(lumping.map).length : 0,
    lithoAcceptedCount: facts.geoModel.lithoLayers.filter(l => l.status === 'accepted').length,
    lithoSolidsBuilt: facts.geoModel.hasLithoSolids,
    geotechModelExists: facts.geoModel.activeGeotechModel != null,
    cptOpen: facts.coordinator.selectedId != null,
    boreholeOpen: facts.coordinator.selectedBoreholeId != null,
    projectSettingsOpen: facts.lifecycle.metadataEditorOpen,
    // "chosen" = the OPEN dialog's draft holds the EPSG code, OR the saved
    // project already carries it. Reading the draft is what lets the step move
    // on the moment a CRS / datum is selected, before Save (owner ruling 1,
    // 2026-09-06); the saved-project fallback keeps it done after the dialog
    // closes and on reopen.
    crsSet:
      facts.coordinator.metadataDraftHorizontalEpsg != null ||
      (project != null && project.default_horizontal_epsg != null),
    datumSet:
      facts.coordinator.metadataDraftVerticalEpsg != null ||
      (project != null && project.default_vertical_epsg != null),
    importMenuOpen: facts.coordinator.importMenuOpen === true,
    lithoModelExists: facts.geoModel.activeLithoModel != null,
    lithoAxisActive: facts.sections.sectionModelAxis === 'lithostratigraphic',
    geotechAxisActive: facts.sections.sectionModelAxis === 'geotechnical',
    sectionOpen: facts.sections.selectedSectionId != null,
    geoSurfacesBuilt: facts.geoModel.surfacesByFormationId.size > 0,
    geotechSolidsBuilt: facts.geoModel.hasGeotechSolids,
  }
}
