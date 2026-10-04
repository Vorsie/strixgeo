// The guided tutorial as data — chapters and steps (spec §Architecture).
//
// A step is a pure record: which control to spotlight, how it completes
// (`done`), where its copy lives (`titleKey` / `bodyKey`), and which stage owns
// the anchor (`stage`).
//
// ANCHOR CHAINS (owner ruling 2, 2026-09-05). A step spotlights a control by a
// CHAIN of `data-testid`s, ordered from the outermost trigger to the final
// control — e.g. `['stage-tab-data', 'import-menu-button', 'import-group-cpt',
// 'import-verb-cpt-dov']`. The overlay highlights the first link that exists whose
// successor does not yet exist (stage tab when off the stage, the menu button when
// the menu is closed, the group row while its submenu is closed, the item once it
// is open), so the user is always led to the next click and the
// old "the button is not visible yet" fallback is rare. `anchor` is the FINAL
// link, kept as a plain field so the integrity test and the docked-card fallback
// keep working; single-anchor steps leave `anchors` unset.
//
// EVERY BUTTON EXPLAINED (owner ruling, 2026-09-05). Each stage the tutorial
// walks (Data, Profielen, Stratigrafie, Litho, Geotech, Parameters, Export) has
// a step for every toolbar button and right-pane control, one short step per
// button or tight group. Do-it steps double as the button's explanation.
//
// This module is pure and side-effect free — `tutorialCatalogue.test.ts` asserts
// every anchor (and every chain link) exists under `desktop/src`, every copy key
// exists in both locale catalogues, ids are unique, and every `done.state` is a
// `TutorialState` key.

import type { TutorialState } from './tutorialState'

/**
 * How a step completes.
 *
 * `'next'` — an explanation step; the user clicks Next.
 * `{ state }` — a do-it step; it auto-completes when that observable fact is
 * truthy (a flag turns true, or a count rises above zero).
 */
export type TutorialDone = 'next' | { readonly state: keyof TutorialState }

/**
 * Which stage tab owns a step's anchor. `'welcome'` is the pre-project welcome
 * screen (no stage tab); the rest map to the shell's stage-tab testids.
 */
export type TutorialStage =
  | 'welcome'
  | 'data'
  | 'sections'
  | 'geology'
  | 'lithology'
  | 'geotechnical'
  | 'parameters'
  | 'export'

/** One tutorial step. */
export interface CatalogueStep {
  /** Stable unique id (also the localStorage progress key). */
  readonly id: string
  /** 1-based chapter number this step belongs to. */
  readonly chapter: number
  /** The `data-testid` the spotlight targets — the FINAL link of the chain. */
  readonly anchor: string
  /**
   * The ordered anchor chain (outermost trigger first, final control last). When
   * set, the overlay resolves the chain per owner ruling 2; when unset the step
   * is a plain single anchor (equivalent to `[anchor]`).
   */
  readonly anchors?: readonly string[]
  /** How the step completes. */
  readonly done: TutorialDone
  /** i18n key for the step title (`tutorial.<chapter>.<step>.title`). */
  readonly titleKey: string
  /** i18n key for the step body (`tutorial.<chapter>.<step>.body`). */
  readonly bodyKey: string
  /** The stage that must be open for `anchor` to be on screen. */
  readonly stage: TutorialStage
}

/** Chapter-level metadata — its title and an optional worked-example clip. */
export interface TutorialChapter {
  /** 1-based chapter number. */
  readonly chapter: number
  /** i18n key for the chapter name (`tutorial.chapter.<n>`). */
  readonly titleKey: string
  /**
   * A7 (owner, 2026-09-02): the owner records tutorial clips on the worked-example
   * project. When set, the coach card shows a "Watch the clip" button that opens
   * the URL in the system browser. Unset today — no URLs exist yet, and the app is
   * offline-first (videos are never bundled or fetched).
   */
  readonly videoUrl?: string
}

/** The chapters, in order. Titles are drafts for the owner. */
export const TUTORIAL_CHAPTERS: readonly TutorialChapter[] = [
  { chapter: 1, titleKey: 'tutorial.chapter.1' },
  { chapter: 2, titleKey: 'tutorial.chapter.2' },
  { chapter: 3, titleKey: 'tutorial.chapter.3' },
  { chapter: 4, titleKey: 'tutorial.chapter.4' },
  { chapter: 5, titleKey: 'tutorial.chapter.5' },
  { chapter: 6, titleKey: 'tutorial.chapter.6' },
  { chapter: 7, titleKey: 'tutorial.chapter.7' },
  { chapter: 8, titleKey: 'tutorial.chapter.8' },
]

/**
 * Build a single-anchor step; the copy keys follow one scheme
 * (`tutorial.<id>.title|body`) so the id is the single source of truth for a
 * step's identity and its copy.
 */
function mk(
  id: string,
  chapter: number,
  anchor: string,
  done: TutorialDone,
  stage: TutorialStage,
): CatalogueStep {
  return { id, chapter, anchor, done, titleKey: `tutorial.${id}.title`, bodyKey: `tutorial.${id}.body`, stage }
}

/**
 * Build a chained-anchor step (owner ruling 2). `anchors` is the ordered chain
 * from the outermost trigger to the final control; `anchor` is set to the last
 * link so the integrity test and the docked fallback keep working.
 */
function mkc(
  id: string,
  chapter: number,
  anchors: readonly string[],
  done: TutorialDone,
  stage: TutorialStage,
): CatalogueStep {
  return {
    id,
    chapter,
    anchor: anchors[anchors.length - 1],
    anchors,
    done,
    titleKey: `tutorial.${id}.title`,
    bodyKey: `tutorial.${id}.body`,
    stage,
  }
}

/**
 * The ordered steps — one flat list the machine walks linearly.
 *
 * Anchors are real `data-testid`s (see `tutorialCatalogue.test.ts`, which asserts
 * each — and each chain link — exists under desktop/src). A do-it step's `done`
 * names the observable fact that proves the user did it; an explain step is `'next'`.
 */
export const TUTORIAL_STEPS: readonly CatalogueStep[] = [
  // 1 · Your project ---------------------------------------------------------
  mk('project-name', 1, 'welcome-project-name-input', 'next', 'welcome'),
  mk('project-create', 1, 'welcome-new-project-button', { state: 'projectOpen' }, 'welcome'),
  // The project-name button in the shell toolbar opens the project settings that
  // carry both CRS fields (owner walk 2026-09-03). Do-it: ticks once the dialog
  // opens (owner ruling 1, 2026-09-06).
  mk('project-metadata', 1, 'project-metadata-open', { state: 'projectSettingsOpen' }, 'data'),
  // CRS + datum live INSIDE that dialog: chain the settings button → the field
  // (owner ruling 2). Dialog closed → highlight the settings button; open →
  // highlight the field. Do-it: ticks once the project carries the chosen CRS /
  // datum (owner ruling 1).
  mkc('project-crs', 1, ['project-metadata-open', 'project-crs-horizontal'], { state: 'crsSet' }, 'data'),
  mkc('project-datum', 1, ['project-metadata-open', 'project-crs-vertical'], { state: 'datumSet' }, 'data'),

  // 2 · Import ---------------------------------------------------------------
  // Do-it: ticks once the Import menu is open (owner ruling 1).
  mkc('import-open', 2, ['stage-tab-data', 'import-menu-button'], { state: 'importMenuOpen' }, 'data'),
  // Data > Import > CPT > From DOV (owner ruling 5): menu button → the CPT
  // group row → the DOV route (the routes sit in a submenu since 2026-10-04).
  mkc('import-cpt-dov', 2, ['stage-tab-data', 'import-menu-button', 'import-group-cpt', 'import-verb-cpt-dov'], { state: 'cptCount' }, 'data'),
  mkc('import-gef', 2, ['stage-tab-data', 'import-menu-button', 'import-group-cpt', 'import-verb-cpt-gef'], 'next', 'data'),
  mkc('import-more', 2, ['stage-tab-data', 'import-menu-button', 'import-verb-dmt'], 'next', 'data'),
  // Right-pane controls, in on-screen order: tabs, search, date filter, sort.
  mkc('import-filter-type', 2, ['stage-tab-data', 'data-filter-testtype-cpt'], 'next', 'data'),
  mkc('import-search', 2, ['stage-tab-data', 'data-inspector-search'], 'next', 'data'),
  mkc('import-filter-date', 2, ['stage-tab-data', 'data-filter-date'], 'next', 'data'),
  mkc('import-sort', 2, ['stage-tab-data', 'data-inspector-sort'], 'next', 'data'),
  // Remove the mechanical cones (owner ruling 6): uncheck CPTM in the map's
  // test-type filter, then delete the greyed rows in the CPT pane.
  mkc('import-remove-cptm', 2, ['stage-tab-data', 'map-cpt-category', 'map-filter-cpt-CPTM'], 'next', 'data'),
  mkc('import-hide', 2, ['stage-tab-data', 'data-row-remove'], 'next', 'data'),
  // DOV boreholes (owner ruling 5): menu button → the DOV borehole item.
  mkc('import-borehole-dov', 2, ['stage-tab-data', 'import-menu-button', 'import-group-borehole', 'import-verb-borehole-dov'], { state: 'boreholeCount' }, 'data'),
  mkc('import-closing', 2, ['stage-tab-data', 'import-menu-button'], 'next', 'data'),

  // 3 · Cross-sections -------------------------------------------------------
  // Look at the data first (owner ruling 7): open a CPT, then a borehole.
  mkc('data-open-cpt', 3, ['stage-tab-data', 'data-filter-testtype-cpt'], { state: 'cptOpen' }, 'data'),
  mkc('data-open-borehole', 3, ['stage-tab-data', 'data-filter-testtype-borehole'], { state: 'boreholeOpen' }, 'data'),
  mkc('section-create', 3, ['stage-tab-sections', 'section-create'], { state: 'sectionCount' }, 'sections'),
  mkc('section-axis', 3, ['stage-tab-sections', 'axis-geology'], 'next', 'sections'),
  mkc('section-buffer', 3, ['stage-tab-sections', 'section-control-buffer'], 'next', 'sections'),
  mkc('section-spacing', 3, ['stage-tab-sections', 'section-control-spacing'], 'next', 'sections'),
  mkc('section-vexag', 3, ['stage-tab-sections', 'section-control-vexag'], 'next', 'sections'),
  mkc('section-channels', 3, ['stage-tab-sections', 'section-control-channel-qc'], 'next', 'sections'),
  // The default-ON borehole stream key is `geotech` (SectionHeader BOREHOLE_CHANNEL_BUTTONS).
  mkc('section-boreholes', 3, ['stage-tab-sections', 'section-control-borehole-geotech'], 'next', 'sections'),
  mkc('section-snap', 3, ['stage-tab-sections', 'section-control-snap'], 'next', 'sections'),
  mkc('section-dem', 3, ['stage-tab-sections', 'section-dem-line'], 'next', 'sections'),
  mkc('section-persist', 3, ['stage-tab-sections', 'section-view-reset'], 'next', 'sections'),
  // Sections toolbar verbs the flow does not otherwise touch.
  mkc('section-undo', 3, ['stage-tab-sections', 'sections-undo'], 'next', 'sections'),
  // section-tie moved to chapter 4 (owner ruling 3, 2026-09-06): the tie-sections
  // explanation must come AFTER the second profile is drawn, never before.
  mkc('section-delete', 3, ['stage-tab-sections', 'sections-delete'], 'next', 'sections'),
  mkc('section-export', 3, ['stage-tab-sections', 'sections-toolbar-export'], 'next', 'sections'),
  // The sections right pane: the section list + its Build / Seed / Dedupe verbs.
  mkc('section-inspector', 3, ['stage-tab-sections', 'inspector-build'], 'next', 'sections'),

  // 4 · Geological / stratigraphic model -------------------------------------
  mkc('geo-open', 4, ['stage-tab-geology'], 'next', 'geology'),
  // Fill the model's contacts from boreholes — the Stratigrafie toolbar button
  // (owner ruling 8): stage tab → the "Vullen vanuit boringen" button.
  mkc('geo-seed', 4, ['stage-tab-geology', 'geology-fill-from-boreholes-button'], { state: 'contactCount' }, 'geology'),
  mkc('geo-lumping', 4, ['stage-tab-geology', 'geology-fill-from-boreholes-button'], { state: 'lumpingCount' }, 'geology'),
  mkc('geo-add-formation', 4, ['stage-tab-geology', 'geology-create-formation-button'], 'next', 'geology'),
  mkc('geo-boreholes-in-model', 4, ['stage-tab-geology', 'geology-boreholes-in-model'], 'next', 'geology'),
  mkc('geo-dedupe', 4, ['stage-tab-geology', 'geology-dedupe'], 'next', 'geology'),
  mkc('geo-reset-delete', 4, ['stage-tab-geology', 'geology-delete-stratigraphy'], 'next', 'geology'),
  // Draw a second cross-section so the surfaces have 3-D data (owner walk).
  // Do-it on twoSectionsExist (owner ruling 3, 2026-09-06) so it completes the
  // instant a second profile exists and never asks for one that already exists.
  mkc('geo-second-section', 4, ['stage-tab-sections', 'section-create'], { state: 'twoSectionsExist' }, 'sections'),
  // Tie-sections come AFTER the second profile (owner ruling 3): only with two
  // profiles can the walk suggest the links where they cross.
  mkc('section-tie', 4, ['stage-tab-sections', 'suggest-tie-sections'], 'next', 'sections'),
  // Carry the borehole stratigraphy onto the CPTs before building (owner ruling 9).
  mkc('geo-carry-strat', 4, ['stage-tab-sections', 'sections-canvas'], 'next', 'sections'),
  // Draw the canal bed BEFORE building the surfaces (owner ruling 2026-09-06):
  // the DEM over water is the water surface, so a bed polygon tells the model
  // where the ground really is. Do-it on bedOverrideExists.
  mkc('geo-bed', 4, ['stage-tab-data', 'data-toolbar-bed-level'], { state: 'bedOverrideExists' }, 'data'),
  // Do-it: ticks once the formation surfaces are built (owner ruling 1).
  mkc('geo-surfaces', 4, ['stage-tab-geology', 'geology-build-model-button'], { state: 'geoSurfacesBuilt' }, 'geology'),

  // 5 · Lithological model ---------------------------------------------------
  mkc('litho-open', 5, ['stage-tab-lithology'], 'next', 'lithology'),
  // Do-it, and the GATE for the litho axis (owner ruling 3, 2026-09-06): the
  // walk cannot reach the litho-axis steps until a litho model exists, so the
  // Litho / Geotech axis pills are never greyed when the user gets there.
  mkc('litho-create', 5, ['stage-tab-lithology', 'model-kind-picker', 'litho-model-create'], { state: 'lithoModelExists' }, 'lithology'),
  // Litho editing lives on the sections toolbar's litho axis: chain the sections
  // tab → the Litho axis segment (owner ruling: axis switch). Do-it: ticks once
  // the axis is on Litho (owner ruling 1).
  mkc('litho-axis', 5, ['stage-tab-sections', 'axis-litho'], { state: 'lithoAxisActive' }, 'sections'),
  mkc('litho-suggest', 5, ['stage-tab-sections', 'axis-litho', 'litho-suggest'], 'next', 'sections'),
  // Adapt the suggestions BEFORE accepting them (owner ruling 2, 2026-09-06):
  // the adjust-gestures step and the admixtures step both come before Accept, and
  // the accept step's copy tells the user to adjust first, accept after.
  mkc('litho-adjust', 5, ['stage-tab-sections', 'axis-litho'], 'next', 'sections'),
  mkc('litho-admixtures', 5, ['stage-tab-sections', 'axis-litho', 'litho-admixtures-dropdown'], 'next', 'sections'),
  mkc('litho-accept', 5, ['stage-tab-sections', 'axis-litho', 'litho-accept-all'], { state: 'lithoAcceptedCount' }, 'sections'),
  mkc('litho-correlate', 5, ['stage-tab-sections', 'axis-litho', 'correlate-mode'], 'next', 'sections'),
  mkc('litho-bodies', 5, ['stage-tab-sections', 'axis-litho', 'litho-bodies-dropdown'], 'next', 'sections'),
  // Do-it on twoSectionsExist (owner ruling 3, 2026-09-06): by chapter 5 a second
  // profile usually exists already, so this completes instantly and never asks
  // for a profile the user has drawn.
  mkc('litho-second-section', 5, ['stage-tab-sections', 'section-create'], { state: 'twoSectionsExist' }, 'sections'),
  // Do the litho flow on EVERY profile before building (owner ruling 2026-09-07):
  // suggest, adjust, accept and correlate on the second cross-section and on every
  // tie-section, not just the first. Anchored at the Litho Suggest verb (the
  // per-section entry point) on the sections axis; 'next' rather than a state
  // fact because "every section that carries tests has accepted layers" needs the
  // per-section corridor→layer mapping, which is not on the tutorial bus.
  mkc('litho-every-section', 5, ['stage-tab-sections', 'axis-litho', 'litho-suggest'], 'next', 'sections'),
  mkc('litho-build', 5, ['stage-tab-lithology', 'litho-build-model-button'], { state: 'lithoSolidsBuilt' }, 'lithology'),
  mkc('litho-fence', 5, ['stage-tab-lithology', 'litho-export-fence-button'], 'next', 'lithology'),
  // The litho right pane: model picker, roster, resolve, boreholes-in-model.
  mkc('litho-pane', 5, ['stage-tab-lithology', 'resolve-instances-btn'], 'next', 'lithology'),

  // 6 · Geotechnical model ---------------------------------------------------
  mkc('geotech-open', 6, ['stage-tab-geotechnical'], 'next', 'geotechnical'),
  // The packing flow lives on the sections toolbar's geotech axis (owner walk).
  mkc('geotech-statistic', 6, ['stage-tab-sections', 'axis-geotech', 'geotech-statistic-menu'], 'next', 'sections'),
  mkc('geotech-subdivide', 6, ['stage-tab-sections', 'axis-geotech', 'geotech-pipeline'], { state: 'geotechModelExists' }, 'sections'),
  mkc('geotech-correlate', 6, ['stage-tab-sections', 'axis-geotech', 'geotech-correlate-packing'], 'next', 'sections'),
  // Pipeline step 4 — Divide boreholes (owner ruling 2026-09-07: "je slaat de
  // divide-boreholes stap over in de geotech stage tutorial?"). Carries the
  // packing classes from the CPTs onto the boreholes. The verb lives inside the
  // packing pipeline dropdown on the sections geotech axis. 'next' — there is no
  // observable "boreholes divided" fact on the tutorial bus.
  mkc('geotech-divide', 6, ['stage-tab-sections', 'axis-geotech', 'geotech-pipeline', 'geotech-divide-boreholes'], 'next', 'sections'),
  mkc('geotech-display', 6, ['stage-tab-sections', 'axis-geotech', 'geotech-display-menu'], 'next', 'sections'),
  mkc('geotech-bodies', 6, ['stage-tab-sections', 'axis-geotech', 'sections-recompute-bodies'], 'next', 'sections'),
  // Do the packing pipeline on EVERY profile before building (owner ruling
  // 2026-09-07: "here you should say the user should do all cross and tie
  // sections"). Anchored at the pipeline dropdown on the geotech axis.
  mkc('geotech-every-section', 6, ['stage-tab-sections', 'axis-geotech', 'geotech-pipeline'], 'next', 'sections'),
  // Do-it: ticks once the geotech 3-D solids are built (owner ruling 1).
  mkc('geotech-build', 6, ['stage-tab-geotechnical', 'geotech-build-model-button'], { state: 'geotechSolidsBuilt' }, 'geotechnical'),
  mkc('geotech-fence', 6, ['stage-tab-geotechnical', 'geotech-export-fence-button'], 'next', 'geotechnical'),
  mkc('geotech-pane', 6, ['stage-tab-geotechnical', 'geotech-units-roster'], 'next', 'geotechnical'),

  // 7 · Parameters & statistics ----------------------------------------------
  mkc('params-open', 7, ['stage-tab-parameters'], 'next', 'parameters'),
  // The path FROM a cross-section into the Parameters stage: right-click a body
  // band → "Unit statistics…" (owner walk). Chain: sections tab → canvas →
  // the (right-click-revealed) menu item.
  mkc('params-jump', 7, ['stage-tab-sections', 'sections-canvas', 'body-ctx-unit-statistics'], 'next', 'sections'),
  mkc('params-units', 7, ['stage-tab-parameters', 'parameters-unit-list'], 'next', 'parameters'),
  mkc('params-group', 7, ['stage-tab-parameters', 'parameters-group-bar', 'parameters-group-action'], 'next', 'parameters'),
  // Owner 2026-09-13: "where does one adjust the groundwater table" — the line
  // only exists once a CPT row is selected in the per-test table, so the card
  // points at that table until it is.
  mkc(
    'params-water-table',
    7,
    ['stage-tab-parameters', 'parameters-panel-per-test', 'parameters-water-table-line'],
    'next',
    'parameters',
  ),
  mkc('params-stats', 7, ['stage-tab-parameters'], 'next', 'parameters'),

  // 8 · Export ---------------------------------------------------------------
  mkc('export-open', 8, ['stage-tab-export'], 'next', 'export'),
  mkc('export-dxf', 8, ['stage-tab-export', 'export-canvas-dxf'], 'next', 'export'),
  mkc('export-plaxis3d', 8, ['stage-tab-export', 'export-canvas-plaxis3d'], 'next', 'export'),
  mkc('closing', 8, ['stage-tab-export'], 'next', 'export'),
]

/**
 * Look up a chapter's metadata.
 *
 * @param chapter  1-based chapter number.
 * @returns  The chapter record, or `undefined` if out of range.
 */
export function chapterMeta(chapter: number): TutorialChapter | undefined {
  return TUTORIAL_CHAPTERS.find(c => c.chapter === chapter)
}
