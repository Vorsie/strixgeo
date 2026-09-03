// The guided tutorial as data — chapters and steps (spec §Architecture).
//
// A step is a pure record: which control to spotlight (`anchor` = a
// `data-testid`), how it completes (`done`), where its copy lives (`titleKey` /
// `bodyKey`), and which stage owns the anchor (`stage`, so the card can say
// "open the … tab" when the control is off-screen).
//
// Chapters 1-3 carry full drafted copy; chapters 4-8 carry step skeletons with
// one-sentence drafts, so the walk runs end to end and the owner's review is a
// copy pass (spec §"Chapters and steps"). All wording is a DRAFT for the owner.
//
// This module is pure and side-effect free — `tutorialCatalogue.test.ts` asserts
// every anchor testid exists under `desktop/src`, every copy key exists in both
// locale catalogues, ids are unique, and every `done.state` is a `TutorialState`
// key.

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
  /** The `data-testid` the spotlight targets. */
  readonly anchor: string
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
 * Build a step; the copy keys follow one scheme (`tutorial.<id>.title|body`) so
 * the id is the single source of truth for a step's identity and its copy.
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
 * The ordered steps — one flat list the machine walks linearly.
 *
 * Chapters 1-3 carry full drafted copy; 4-8 carry skeletons (one-sentence
 * drafts) so the walk runs end to end. Anchors are real `data-testid`s (see
 * `tutorialCatalogue.test.ts`, which asserts each exists under desktop/src). A
 * do-it step's `done` names the observable fact that proves the user did it; an
 * explain step is `'next'`.
 */
export const TUTORIAL_STEPS: readonly CatalogueStep[] = [
  // 1 · Your project ---------------------------------------------------------
  mk('project-name', 1, 'welcome-project-name-input', 'next', 'welcome'),
  mk('project-create', 1, 'welcome-new-project-button', { state: 'projectOpen' }, 'welcome'),
  // Lead the user to WHERE the project settings live before the CRS field
  // (owner walk 2026-09-03: "doesn't highlight where projectgegevens are").
  // The project-name button in the shell toolbar opens the metadata dialog that
  // carries both CRS fields.
  mk('project-metadata', 1, 'project-metadata-open', 'next', 'data'),
  mk('project-crs', 1, 'project-crs-horizontal', 'next', 'data'),
  mk('project-datum', 1, 'project-crs-vertical', 'next', 'data'),

  // 2 · Import ---------------------------------------------------------------
  mk('import-open', 2, 'import-menu-button', 'next', 'data'),
  mk('import-cpt-dov', 2, 'import-verb-cpt-dov', { state: 'cptCount' }, 'data'),
  mk('import-filter-date', 2, 'data-filter-date', 'next', 'data'),
  mk('import-filter-type', 2, 'data-filter-testtype-cpt', 'next', 'data'),
  mk('import-hide', 2, 'data-row-remove', 'next', 'data'),
  mk('import-borehole-dov', 2, 'import-verb-borehole-dov', { state: 'boreholeCount' }, 'data'),
  mk('import-gef', 2, 'import-verb-cpt-gef', 'next', 'data'),
  mk('import-more', 2, 'import-verb-dmt', 'next', 'data'),
  mk('import-closing', 2, 'import-menu-button', 'next', 'data'),

  // 3 · Cross-sections -------------------------------------------------------
  mk('section-create', 3, 'section-create', { state: 'sectionCount' }, 'sections'),
  mk('section-buffer', 3, 'section-control-buffer', 'next', 'sections'),
  mk('section-spacing', 3, 'section-control-spacing', 'next', 'sections'),
  mk('section-vexag', 3, 'section-control-vexag', 'next', 'sections'),
  mk('section-channels', 3, 'section-control-channel-qc', 'next', 'sections'),
  // The borehole interpretation-stream toggles render `section-control-borehole-${key}`;
  // the default-ON stream's key is `geotech` (SectionHeader BOREHOLE_CHANNEL_BUTTONS).
  // The old `-geo` matched no element and docked the card bottom-right (owner walk).
  mk('section-boreholes', 3, 'section-control-borehole-geotech', 'next', 'sections'),
  mk('section-axis', 3, 'axis-geology', 'next', 'sections'),
  mk('section-snap', 3, 'section-control-snap', 'next', 'sections'),
  mk('section-dem', 3, 'section-dem-line', 'next', 'sections'),
  mk('section-persist', 3, 'section-view-reset', 'next', 'sections'),

  // 4 · Geological model (skeleton) -----------------------------------------
  mk('geo-open', 4, 'stage-tab-geology', 'next', 'geology'),
  // Fill the model's first contacts from the boreholes (owner: "Vullen vanuit
  // boringen"). Anchored on the real seed/fill button in the section inspector.
  mk('geo-seed', 4, 'inspector-seed', { state: 'contactCount' }, 'sections'),
  mk('geo-lumping', 4, 'stage-tab-geology', { state: 'lumpingCount' }, 'geology'),
  // Suggest a second cross-section BEFORE building surfaces, so the TINs have
  // 3-D data (owner walk: "best een 2de profiel trekken eerst").
  mk('geo-second-section', 4, 'section-create', 'next', 'sections'),
  mk('geo-surfaces', 4, 'inspector-build', 'next', 'sections'),

  // 5 · Lithostratigraphic model (skeleton) ---------------------------------
  mk('litho-open', 5, 'stage-tab-lithology', 'next', 'lithology'),
  // A litho model must exist before you can pick litho contacts (owner walk).
  mk('litho-create', 5, 'model-kind-picker', 'next', 'lithology'),
  // Switch the section to the litho axis to edit the litho model.
  mk('litho-axis', 5, 'axis-litho', 'next', 'sections'),
  mk('litho-accept', 5, 'stage-tab-lithology', { state: 'lithoAcceptedCount' }, 'lithology'),
  // How to merge / adjust accepted layers + the drag-boundary gestures.
  mk('litho-adjust', 5, 'axis-litho', 'next', 'sections'),
  // Point at Correlate (top of the litho toolbar) BEFORE Build — the owner
  // found Build "iets te snel"; mention auto-correlate here.
  mk('litho-correlate', 5, 'correlate-mode', 'next', 'sections'),
  // Again suggest a second section so the litho bodies get 3-D data (owner).
  mk('litho-second-section', 5, 'section-create', 'next', 'sections'),
  mk('litho-build', 5, 'inspector-build', { state: 'lithoSolidsBuilt' }, 'sections'),

  // 6 · Geotechnical model (skeleton) ---------------------------------------
  mk('geotech-open', 6, 'stage-tab-geotechnical', 'next', 'geotechnical'),
  // The packing flow lives on the sections toolbar's geotech axis, not the
  // geotech pane (owner walk: "dit hoort bij geotech stage in cross section
  // niet in geotech pane"). The four-step Pakkingsstroom is `geotech-pipeline`.
  mk('geotech-subdivide', 6, 'geotech-pipeline', { state: 'geotechModelExists' }, 'sections'),
  mk('geotech-bodies', 6, 'sections-recompute-bodies', 'next', 'sections'),

  // 7 · Parameters & statistics (skeleton) ----------------------------------
  mk('params-open', 7, 'stage-tab-parameters', 'next', 'parameters'),
  // The path FROM a cross-section into the Parameters stage: right-click a body
  // band → "Unit statistics…" (owner walk). The menu item is body-ctx-unit-statistics.
  mk('params-jump', 7, 'body-ctx-unit-statistics', 'next', 'sections'),
  mk('params-stats', 7, 'stage-tab-parameters', 'next', 'parameters'),

  // 8 · Export (skeleton) ----------------------------------------------------
  mk('export-open', 8, 'stage-tab-export', 'next', 'export'),
  mk('export-dxf', 8, 'export-section-dxf', 'next', 'sections'),
  mk('closing', 8, 'stage-tab-export', 'next', 'export'),
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
