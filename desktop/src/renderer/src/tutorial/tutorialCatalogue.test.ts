// Integrity pins for the tutorial catalogue (spec §Testing): every anchor testid
// exists somewhere under desktop/src, every copy key exists in both locale
// catalogues, no two steps share an id, and every `done.state` is a real
// TutorialState fact. These catch the failure modes a catalogue silently ships:
// a typo'd anchor (spotlight lands nowhere), a missing key (raw key text on the
// card), a duplicate id (progress collides), a stale done fact (never advances).

import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { EN } from '../i18n/locales/en'
import { NL } from '../i18n/locales/nl'
import { emptyTutorialState, type TutorialState } from './tutorialState'
import { TUTORIAL_CHAPTERS, TUTORIAL_STEPS } from './tutorialCatalogue'
import { advance } from './tutorialMachine'

// --- source scan ----------------------------------------------------------
// The catalogue's own directory is excluded so an anchor is only "found" when a
// REAL control carries it, not because the catalogue lists it. Vitest runs from
// `desktop/` (project rule), so cwd anchors the renderer source root.
const SRC_ROOT = path.join(process.cwd(), 'src', 'renderer', 'src')
const TUTORIAL_DIR = path.join(SRC_ROOT, 'tutorial')

function collectSource(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue
      collectSource(full, out)
    } else if (/\.(ts|tsx)$/.test(entry.name) && !full.startsWith(TUTORIAL_DIR)) {
      out.push(readFileSync(full, 'utf8'))
    }
  }
}

const SOURCE_FILES: string[] = []
collectSource(SRC_ROOT, SOURCE_FILES)
const SOURCE_BLOB = SOURCE_FILES.join('\n')

// One pass over the blob indexes every kebab-case token and every template
// prefix (`stage-tab-` right before `${`), so the ~200 anchor lookups below are
// set hits instead of ~200 full scans of a multi-megabyte string. Under a loaded
// full-suite run the scans took 11-18 s and tripped the 5 s timeout (the known
// load flake). The blob search stays as the fallback for a miss, so the verdict
// is exactly what the scan gave: only the speed changes.
const KEBAB_TOKENS = new Set<string>()
const TEMPLATE_PREFIXES = new Set<string>()
for (const m of SOURCE_BLOB.matchAll(/[a-z0-9]+(?:-[a-z0-9]+)+/g)) KEBAB_TOKENS.add(m[0])
for (const m of SOURCE_BLOB.matchAll(/([a-z0-9][a-z0-9-]*-)\$\{/g)) TEMPLATE_PREFIXES.add(m[1])

/**
 * Whether a real control carries this anchor. A literal testid appears verbatim;
 * a template-generated one (e.g. `stage-tab-${id}`) appears as its static prefix
 * followed by the template opener `${`.
 */
function anchorExists(anchor: string): boolean {
  if (KEBAB_TOKENS.has(anchor) || SOURCE_BLOB.includes(anchor)) return true
  const templatePrefix = anchor.replace(/[^-]+$/, '') // drop the last "-segment"
  if (templatePrefix === anchor) return false
  return TEMPLATE_PREFIXES.has(templatePrefix) || SOURCE_BLOB.includes(`${templatePrefix}\${`)
}

const STATE_KEYS = new Set(Object.keys(emptyTutorialState()))

describe('tutorialCatalogue integrity', () => {
  it('every anchor testid is carried by a real control under desktop/src', () => {
    const missing = TUTORIAL_STEPS.filter(s => !anchorExists(s.anchor)).map(s => `${s.id} → ${s.anchor}`)
    expect(missing).toEqual([])
  })

  it('every link of every anchor CHAIN is carried by a real control (owner ruling 2)', () => {
    // A chained step leads the user through several controls; each link must
    // resolve to a real element, or the spotlight would land nowhere at one of
    // the intermediate steps (menu button, item, control).
    const missing: string[] = []
    for (const step of TUTORIAL_STEPS) {
      const chain = step.anchors ?? [step.anchor]
      for (const link of chain) {
        if (!anchorExists(link)) missing.push(`${step.id} → ${link}`)
      }
      // The final link of a chain is the plain `anchor` (docked fallback + this
      // catalogue's identity contract).
      if (step.anchors) expect(step.anchor).toBe(step.anchors[step.anchors.length - 1])
    }
    expect(missing).toEqual([])
  })

  it('no two steps share an id', () => {
    const ids = TUTORIAL_STEPS.map(s => s.id)
    expect(ids).toHaveLength(new Set(ids).size)
  })

  it('every step copy key exists in the EN and NL catalogues', () => {
    const missingEn: string[] = []
    const missingNl: string[] = []
    for (const step of TUTORIAL_STEPS) {
      for (const key of [step.titleKey, step.bodyKey]) {
        if (!(key in EN)) missingEn.push(key)
        if (!(key in NL)) missingNl.push(key)
      }
    }
    expect(missingEn).toEqual([])
    expect(missingNl).toEqual([])
  })

  it('every chapter title key exists in the EN and NL catalogues', () => {
    for (const chapter of TUTORIAL_CHAPTERS) {
      expect(chapter.titleKey in EN).toBe(true)
      expect(chapter.titleKey in NL).toBe(true)
    }
  })

  it('every step references a chapter that has metadata', () => {
    const chapters = new Set(TUTORIAL_CHAPTERS.map(c => c.chapter))
    const orphans = TUTORIAL_STEPS.filter(s => !chapters.has(s.chapter)).map(s => s.id)
    expect(orphans).toEqual([])
  })

  it('every done.state names a real TutorialState fact', () => {
    const bad: string[] = []
    for (const step of TUTORIAL_STEPS) {
      if (step.done !== 'next' && !STATE_KEYS.has(step.done.state)) {
        bad.push(`${step.id} → ${step.done.state}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('no chapter carries a videoUrl yet (A7: the owner sets them later)', () => {
    // The type allows `videoUrl`; today every chapter leaves it unset (no clips
    // exist, the app is offline-first). This pins that default so a stray URL is
    // a deliberate change, not an accident.
    expect(TUTORIAL_CHAPTERS.every(c => c.videoUrl === undefined)).toBe(true)
  })
})

// --- owner-walk rulings (dogfeed 2026-09-03) ------------------------------
// Pins for the specific fixes the owner asked for after walking the Dutch
// tutorial on the packaged build. Each is phrased in his words. The generic
// integrity block above cannot catch these: a template-prefix anchor
// (`section-control-borehole-${key}`) passes `anchorExists` for ANY suffix,
// so the phantom `-geo` (which renders no element and docks the card
// bottom-right) looks valid to it — these fix the SUFFIX to the value the
// control actually renders.
const stepById = (id: string) => TUTORIAL_STEPS.find(s => s.id === id)
const indexOf = (id: string) => TUTORIAL_STEPS.findIndex(s => s.id === id)

describe('tutorialCatalogue owner-walk rulings', () => {
  it('finding 5: the borehole-stream step spotlights the real toggle, not a phantom key', () => {
    // Owner: the card "sits bottom-right and it is not clear how you change it".
    // The toggle renders `section-control-borehole-${key}` with key `geotech`
    // (SectionHeader BOREHOLE_CHANNEL_BUTTONS), so `-geo` matched nothing and the
    // spotlight fell back to the (already-active) sections tab → docked card.
    expect(stepById('section-boreholes')?.anchor).toBe('section-control-borehole-geotech')
  })

  it('finding 10: the packing flow lives on the sections toolbar geotech axis, not the geotech pane', () => {
    // Owner: "dit hoort bij geotech stage in cross section niet in geotech pane".
    // The pipeline dropdown is `geotech-pipeline` in sectionsGeotechToolbarItems.
    const step = stepById('geotech-subdivide')
    expect(step?.stage).toBe('sections')
    expect(step?.anchor).toBe('geotech-pipeline')
  })

  it('finding 6 / ruling 8: the fill step points at the Stratigrafie toolbar button via a chain', () => {
    // Owner ruling 8 (2026-09-05): "Vullen vanuit boringen" must highlight the
    // toolbar button on the Stratigrafie stage, reached by a chain (stage tab →
    // the button), not the sections-inspector seed verb it used to point at.
    const step = stepById('geo-seed')
    expect(step?.stage).toBe('geology')
    expect(step?.anchors).toEqual(['stage-tab-geology', 'geology-fill-from-boreholes-button'])
  })

  it('finding 1: chapter 1 shows WHERE the project settings live before the CRS field', () => {
    // Owner: "doesn't highlight where projectgegevens are". A step opens the
    // metadata dialog (its button carries project-metadata-open) before the CRS.
    const lead = stepById('project-metadata')
    expect(lead?.anchor).toBe('project-metadata-open')
    expect(indexOf('project-metadata')).toBeLessThan(indexOf('project-crs'))
  })

  it('finding 8: chapter 5 creates a litho model and switches to the litho axis', () => {
    // The chain runs through the model-kind picker and ends at the create
    // button (owner ruling 3, 2026-09-06 extended the final link).
    expect(stepById('litho-create')?.anchors).toContain('model-kind-picker')
    expect(stepById('litho-create')?.anchor).toBe('litho-model-create')
    expect(stepById('litho-axis')?.anchor).toBe('axis-litho')
  })

  it('finding 9: chapter 5 points at Correlate before Build', () => {
    // Owner: "dit moet wijzen naar correleren bovenaan. bouwen is nog iets te snel".
    expect(stepById('litho-correlate')?.anchor).toBe('correlate-mode')
    expect(indexOf('litho-correlate')).toBeLessThan(indexOf('litho-build'))
  })

  it('finding 11: chapter 7 shows the path from a cross-section to the Parameters stage', () => {
    // Owner: "je laat ook niet zien hoe je de parameter stage kan bereiken vanaf de CS".
    expect(stepById('params-jump')?.anchor).toBe('body-ctx-unit-statistics')
    expect(indexOf('params-jump')).toBeLessThan(indexOf('params-stats'))
  })
})

// --- owner rulings (2026-09-05, walk + every-button gate) -----------------
describe('tutorialCatalogue owner rulings 2026-09-05', () => {
  it('ruling 2 / 1: every stage step (chapters 2-8) leads the click through a chain', () => {
    // No bare single anchor for a control that sits behind a tab / axis / menu:
    // each such step declares an anchor chain so the overlay always resolves to
    // a visible link and the "not visible yet" fallback stays rare.
    const bare = TUTORIAL_STEPS.filter(s => s.chapter >= 2 && s.anchors === undefined).map(s => s.id)
    expect(bare).toEqual([])
  })

  it('ruling 5: the DOV import steps chain through the Import menu and its group row', () => {
    // Owner 2026-10-04: "one button for cpt's with suboptions, same for
    // drillings" - each route now sits behind its group row, so the chain
    // walks menu button -> group row -> route.
    expect(stepById('import-cpt-dov')?.anchors).toEqual([
      'stage-tab-data',
      'import-menu-button',
      'import-group-cpt',
      'import-verb-cpt-dov',
    ])
    expect(stepById('import-gef')?.anchors).toEqual([
      'stage-tab-data',
      'import-menu-button',
      'import-group-cpt',
      'import-verb-cpt-gef',
    ])
    expect(stepById('import-borehole-dov')?.anchors).toEqual([
      'stage-tab-data',
      'import-menu-button',
      'import-group-borehole',
      'import-verb-borehole-dov',
    ])
    // DMT stays a top-level row: no group hop.
    expect(stepById('import-more')?.anchors).toEqual([
      'stage-tab-data',
      'import-menu-button',
      'import-verb-dmt',
    ])
  })

  it('ruling 6: a step removes the mechanical cones via the map CPTM filter', () => {
    const step = stepById('import-remove-cptm')
    expect(step?.anchors).toContain('map-filter-cpt-CPTM')
    // Before "Boringen importeren" (owner: new step BEFORE borehole import).
    expect(indexOf('import-remove-cptm')).toBeLessThan(indexOf('import-borehole-dov'))
  })

  it('ruling 7: look at the data first — open a CPT, then a borehole, before creating a section', () => {
    expect(stepById('data-open-cpt')?.done).toEqual({ state: 'cptOpen' })
    expect(stepById('data-open-borehole')?.done).toEqual({ state: 'boreholeOpen' })
    expect(indexOf('data-open-cpt')).toBeLessThan(indexOf('section-create'))
    expect(indexOf('data-open-borehole')).toBeLessThan(indexOf('section-create'))
  })

  it('ruling 9: carry the borehole stratigraphy onto the CPTs before building the surfaces', () => {
    const step = stepById('geo-carry-strat')
    expect(step?.stage).toBe('sections')
    expect(step?.anchor).toBe('sections-canvas')
    expect(indexOf('geo-carry-strat')).toBeLessThan(indexOf('geo-surfaces'))
  })

  it('2026-09-06: draw the canal bed on the Data stage before building the surfaces', () => {
    const step = stepById('geo-bed')
    expect(step?.stage).toBe('data')
    expect(step?.anchor).toBe('data-toolbar-bed-level')
    expect(step?.done).toEqual({ state: 'bedOverrideExists' })
    expect(indexOf('geo-bed')).toBeLessThan(indexOf('geo-surfaces'))
  })

  it('litho + geotech editing chains through the sections axis pill (axis switch)', () => {
    expect(stepById('litho-suggest')?.anchors).toContain('axis-litho')
    expect(stepById('litho-correlate')?.anchors).toContain('axis-litho')
    expect(stepById('geotech-subdivide')?.anchors).toContain('axis-geotech')
    expect(stepById('geotech-correlate')?.anchors).toContain('axis-geotech')
  })
})

// --- owner ruling 1 (2026-09-06): every do-it step auto-advances ------------
// "If a user clicks 'Open de projectgegevens' the tutorial should automatically
// go to the next step, same for steps further down the road." A step whose copy
// tells the user to click / do something completes by itself on an observable
// fact; explanation-only steps stay 'next'.
describe('tutorialCatalogue owner ruling 1 (2026-09-06): do-it steps auto-advance', () => {
  // Each entry: the step's copy tells the user to DO something, so its `done`
  // is the observable fact that proves they did it (not a Next click).
  const DO_IT_FACTS: ReadonlyArray<[string, keyof TutorialState]> = [
    ['project-metadata', 'projectSettingsOpen'],
    ['project-crs', 'crsSet'],
    ['project-datum', 'datumSet'],
    ['import-open', 'importMenuOpen'],
    ['litho-create', 'lithoModelExists'],
    ['litho-axis', 'lithoAxisActive'],
    ['geo-bed', 'bedOverrideExists'],
    ['geo-surfaces', 'geoSurfacesBuilt'],
    ['geotech-build', 'geotechSolidsBuilt'],
  ]

  it.each(DO_IT_FACTS)('%s completes on its observable fact, not a Next click', (id, fact) => {
    expect(stepById(id)?.done).toEqual({ state: fact })
  })

  it('the machine moves on by itself when the user does what a do-it step says', () => {
    // Owner's words: "when the user does what the step says, the tutorial moves
    // on by itself." Position the walk on project-metadata (a do-it step), turn
    // its fact true, and assert advance() steps past it with no Next.
    const idx = indexOf('project-metadata')
    const progress = {
      stepId: 'project-metadata',
      completed: TUTORIAL_STEPS.slice(0, idx).map(s => s.id),
    }
    const state: TutorialState = {
      ...emptyTutorialState(),
      projectOpen: true,
      projectSettingsOpen: true,
    }
    const next = advance(progress, state, TUTORIAL_STEPS)
    expect(next.completed).toContain('project-metadata')
    expect(next.stepId).not.toBe('project-metadata')
  })

  it('explanation-only steps keep done: "next" (no phantom auto-advance)', () => {
    // A representative control-tour / intro step from each stage that describes
    // a control rather than instructing a specific observable action.
    for (const id of ['project-name', 'section-buffer', 'geo-open', 'litho-adjust', 'params-stats']) {
      expect(stepById(id)?.done).toBe('next')
    }
  })
})

// --- owner ruling 3 (2026-09-06): do not lead to the litho axis before a
// litho model exists. litho-create is a do-it step on lithoModelExists, and it
// comes before the litho-axis steps, so the walk cannot reach the (greyed)
// axis pill without a model.
describe('tutorialCatalogue owner ruling 3 (2026-09-06): model gates the axis', () => {
  it('litho-create completes on lithoModelExists and chains to the pane create button', () => {
    const step = stepById('litho-create')
    expect(step?.done).toEqual({ state: 'lithoModelExists' })
    // The chain ends at the litho-model create button (owner ruling 3: "the
    // pane's create button has a testid in the chain"), reached through the
    // model-kind picker.
    expect(step?.anchors).toEqual([
      'stage-tab-lithology',
      'model-kind-picker',
      'litho-model-create',
    ])
  })

  it('litho-create comes before every litho-axis step (the axis unlocks only after the model)', () => {
    const createAt = indexOf('litho-create')
    for (const id of ['litho-axis', 'litho-suggest', 'litho-accept', 'litho-correlate']) {
      expect(indexOf(id)).toBeGreaterThan(createAt)
    }
  })

  it('the whole geotech chapter comes after the litho model is built (its axis is then enabled)', () => {
    // The geotech axis pill enables once a LITHO model exists (subdivide, which
    // CREATES the geotech model, lives on that axis). Chapter 5 gates on
    // litho-create + litho-build, so by chapter 6 the pill is never greyed.
    const lithoBuiltAt = indexOf('litho-build')
    const firstGeotechAxisStep = indexOf('geotech-statistic')
    expect(firstGeotechAxisStep).toBeGreaterThan(lithoBuiltAt)
  })
})

// --- owner ruling 2 (2026-09-06): adapt the suggestions before accepting ----
// Owner: "shouldn't we show how to adapt voorstellen before accepting?
// dragging, merging, deleting, admixtures and so on?" The adjust-gestures step
// and the admixtures step move BEFORE the accept step.
describe('tutorialCatalogue owner ruling 2 (2026-09-06): adapt before accept', () => {
  it('the adjust and admixtures steps come before the accept step', () => {
    expect(indexOf('litho-adjust')).toBeLessThan(indexOf('litho-accept'))
    expect(indexOf('litho-admixtures')).toBeLessThan(indexOf('litho-accept'))
  })

  it('litho-accept is still the do-it step that ticks on the first accepted layer', () => {
    // Reordering must not turn Accept into an explanation-only step.
    expect(stepById('litho-accept')?.done).toEqual({ state: 'lithoAcceptedCount' })
  })
})

// --- owner ruling 3 (2026-09-06): the second-profile steps + tie order ------
// "Een tweede profiel voor 3D" must not ask for a second profile that already
// exists, and the tie-sections step comes AFTER the second profile in the walk.
describe('tutorialCatalogue owner ruling 3 (2026-09-06): second profile + tie order', () => {
  it('both second-profile steps are do-it steps on twoSectionsExist', () => {
    expect(stepById('geo-second-section')?.done).toEqual({ state: 'twoSectionsExist' })
    expect(stepById('litho-second-section')?.done).toEqual({ state: 'twoSectionsExist' })
  })

  it('the tie-sections step comes AFTER the second profile is drawn, never before', () => {
    expect(indexOf('section-tie')).toBeGreaterThan(indexOf('geo-second-section'))
  })
})
