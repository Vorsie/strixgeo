/**
 * The walker's action policy -- pure, seeded, and driven by live DOM discovery.
 *
 * ``decideAction`` looks at what is ACTUALLY on screen this step (the
 * orchestrator's discovered {@link Candidate}s) plus a little context, and picks
 * the next thing a NOVICE engineer might do. The tutorial's verb testids are a
 * WEIGHTING PRIOR only (owner 2026-09-06: "the tutorial catalogue is only the
 * seed of the verb list, not its limit") -- every discovered element, including
 * ones with no testid, is pickable with real weight, and a large slice of steps
 * are deliberate chaos (right-click anything, drag between unrelated elements,
 * wheel with modifiers, type junk, random shortcuts in the wrong stage, resize,
 * double/triple/hammer clicks, Enter/Escape at random moments).
 *
 * PURITY = REPRODUCIBILITY. Each step draws from its OWN generator seeded from
 * ``(seed, stepIndex)`` (walkerRng.stepRng), so the decision depends only on the
 * seed, the step, and the observed world -- never on earlier draws. The same
 * seed replays the same sequence; that is what makes a printed finding
 * reproducible. Nothing here imports Playwright or the app.
 */

import { pickIndex, pickWeighted, stepRng } from './walkerRng'
import type { ActionPlan, Candidate, CloseChoice, FollowUp, SpineLabel, WalkerContext } from './walkerTypes'

/** The seven spine stages, label plus stage-tab testid (StageSpine.tsx). */
export const SPINE_STAGES: readonly { label: SpineLabel; testid: string }[] = [
  { label: 'Data', testid: 'stage-tab-data' },
  { label: 'Sections', testid: 'stage-tab-sections' },
  { label: 'Stratigraphy', testid: 'stage-tab-geology' },
  { label: 'Litho', testid: 'stage-tab-lithology' },
  { label: 'Geotech', testid: 'stage-tab-geotechnical' },
  { label: 'Parameters', testid: 'stage-tab-parameters' },
  { label: 'Export', testid: 'stage-tab-export' },
]

/**
 * A curated snapshot of the tutorial's verb testids (tutorialCatalogue.ts), used
 * ONLY to weight discovered elements a little higher. It is intentionally a
 * static list, not an import: the catalogue lives under ``src/renderer`` and
 * importing it here would cross ``tsconfig.e2e``'s rootDir. It is a hint, not a
 * gate -- DOM discovery is the real driver, so a drifted entry only changes a
 * weight, never coverage.
 */
export const TUTORIAL_VERB_TESTIDS: readonly string[] = [
  'import-menu-button', 'import-group-cpt', 'import-group-borehole', 'import-verb-cpt-dov',
  'import-verb-cpt-gef', 'data-inspector-search',
  'data-inspector-sort', 'data-row-remove', 'data-filter-testtype-cpt', 'data-filter-testtype-borehole',
  'section-create', 'axis-geology', 'axis-litho', 'axis-geotech', 'section-control-buffer',
  'section-control-spacing', 'section-control-vexag', 'section-control-snap', 'section-dem-line',
  'sections-undo', 'sections-delete', 'sections-toolbar-export', 'inspector-build',
  'suggest-tie-sections', 'geology-fill-from-boreholes-button', 'geology-create-formation-button',
  'geology-dedupe', 'geology-build-model-button', 'model-kind-picker', 'litho-model-create',
  'litho-suggest', 'litho-accept-all', 'correlate-mode', 'litho-bodies-dropdown',
  'litho-admixtures-dropdown', 'litho-build-model-button', 'litho-export-fence-button',
  'resolve-instances-btn', 'geotech-statistic-menu', 'geotech-pipeline', 'geotech-correlate-packing',
  'geotech-display-menu', 'geotech-build-model-button',
  'geotech-export-fence-button', 'geotech-units-roster', 'parameters-unit-list',
  'parameters-group-action', 'export-canvas-dxf', 'export-canvas-plaxis3d',
]

/** Junk an impatient novice types / pastes into a field. */
export const JUNK_INPUTS: readonly string[] = [
  '', // empty submit
  '-99999', // negative where positive expected
  'abcdef', // letters in a number field
  '0', // a zero
  '999999999999', // absurdly large
  '   ', // whitespace only
  "'; DROP TABLE cpt;--", // injection-shaped
  'a'.repeat(2000), // very long string
  '3,14', // wrong decimal separator
  '❄️ρ 汉字 \u0000', // unicode + a control char
]

/** Keyboard combos a novice fires in the wrong place (from the F1 cheatsheet). */
export const CHAOS_KEYS: readonly string[] = [
  'Escape', 'Enter', 'Delete', 'Backspace', 'F1',
  'Control+z', 'Control+Shift+z', 'Control+y', 'Control+,', 'Control+0',
  'Control+a', 'Control+s', 'p', 'l', 'f', 'ArrowLeft', 'ArrowRight', 'Tab',
]

/** Modifier subsets for a chaotic wheel gesture. */
const WHEEL_MODIFIER_SETS: readonly (readonly string[])[] = [[], ['Control'], ['Shift'], ['Alt'], ['Control', 'Shift']]

/** Small then large, to exercise resize both ways. */
const RESIZE_SIZES: readonly { width: number; height: number }[] = [
  { width: 420, height: 320 },
  { width: 1920, height: 1080 },
  { width: 800, height: 600 },
  { width: 1280, height: 800 },
]

/** Never reopen the project more than this many times in one walk. */
export const REOPEN_CAP = 2

/** Never switch project more than this many times in one walk (owner 2026-10-13). */
export const SWITCH_PROJECT_CAP = 4

/**
 * Steps the walk spends in a project before it may switch again. Spreads the
 * capped switches across a 900-step walk instead of spending them all in the
 * first hundred steps, and gives each project time to load models, open
 * sections and start builds: the state a switch must leave behind cleanly.
 */
export const MIN_STEPS_BETWEEN_PROJECT_SWITCHES = 120

/**
 * Share of steps that take a project-level verb (switch project, undo/redo
 * burst, save, settings, an import dialog). Drawn AFTER the stage-switch band
 * and BEFORE the chaos band.
 */
export const WORKFLOW_P = 0.1

/** Relative weights of the project-level verbs inside the workflow band. */
export const WORKFLOW_ACTION_WEIGHTS = {
  switchProject: 3,
  undoRedoBurst: 4,
  saveProject: 3,
  openSettings: 2,
  openImportDialog: 3,
} as const

/**
 * Every import route of the Data toolbar's Import menu, as the click chain
 * from the menu button to the verb (dataImportActions.ts testids). Each is
 * opened once per walk and cancelled: the e2e harness answers every native
 * file dialog "cancelled" (main/e2eDialogs.ts), the DOV routes start a map
 * draw that Escape ends, and the in-app dialogs close on Escape. A link the
 * build does not show (a flag-gated pdf route) is skipped by the executor.
 */
export const IMPORT_ROUTES: readonly { id: string; chain: readonly string[] }[] = [
  { id: 'cpt-gef', chain: ['import-menu-button', 'import-group-cpt', 'import-verb-cpt-gef'] },
  { id: 'cpt-dov', chain: ['import-menu-button', 'import-group-cpt', 'import-verb-cpt-dov'] },
  { id: 'cpt-pdf', chain: ['import-menu-button', 'import-group-cpt', 'import-verb-cpt-pdf'] },
  { id: 'borehole-xml', chain: ['import-menu-button', 'import-group-borehole', 'import-verb-borehole-xml'] },
  { id: 'borehole-dov', chain: ['import-menu-button', 'import-group-borehole', 'import-verb-borehole-dov'] },
  { id: 'borehole-pdf', chain: ['import-menu-button', 'import-group-borehole', 'import-verb-borehole-pdf'] },
  { id: 'lab', chain: ['import-menu-button', 'import-verb-lab'] },
]

/** Stable comparator so an identical world sorts identically across runs. */
function candidateSortKey(c: Candidate): string {
  return [c.testid ?? '~', c.role ?? '~', c.text, c.tag, c.box.x, c.box.y].join('|')
}

/** Weight a candidate: everything is pickable; tutorial verbs and enabled
 *  buttons lean higher, but an unknown untestid'd element still gets real
 *  weight (owner 2026-09-06). */
function candidateWeight(c: Candidate): number {
  let w = 1
  if (c.enabled) w += 1
  if (c.testid !== null && TUTORIAL_VERB_TESTIDS.includes(c.testid)) w += 3
  if (c.kind === 'button' || c.kind === 'menuitem') w += 1
  if (c.kind === 'canvas') w += 2
  return w
}

/** Pick a candidate by weight, optionally restricted to a kind. Null when none. */
function pickCandidate(
  rng: () => number,
  cands: readonly Candidate[],
  kind?: Candidate['kind'],
): Candidate | null {
  const pool = kind === undefined ? cands : cands.filter(c => c.kind === kind)
  const use = pool.length > 0 ? pool : cands
  if (use.length === 0) return null
  const idx = pickWeighted(rng, use.map(candidateWeight))
  return use[idx] ?? null
}

/** Pick any element from an array by one draw. */
function pickFrom<T>(rng: () => number, arr: readonly T[]): T {
  return arr[pickIndex(rng, arr.length)]
}

/** A novice tail, sometimes: repeat via undo/redo, or bail with Escape/Enter. */
function maybeFollowUp(rng: () => number): FollowUp {
  const r = rng()
  if (r < 0.08) return 'undo'
  if (r < 0.13) return 'redo'
  if (r < 0.18) return 'escape'
  if (r < 0.21) return 'enter'
  return null
}

/** Choose a stage to switch to, biased toward stages not yet visited. */
function planStageSwitch(rng: () => number, ctx: WalkerContext): ActionPlan {
  const unvisited = SPINE_STAGES.filter(s => !ctx.visitedStages.includes(s.label))
  const pool = unvisited.length > 0 ? unvisited : SPINE_STAGES
  const stage = pickFrom(rng, pool).label
  return { kind: 'switchStage', stage, note: `switch stage -> ${stage}` }
}

/** A deliberate chaos interaction -- the unforeseen things a novice does. */
function planChaos(rng: () => number, ctx: WalkerContext): ActionPlan {
  const cands = ctx.candidates
  // Weighted menu of chaos kinds. reopenProject only when under the cap.
  const kinds: { name: string; weight: number }[] = [
    { name: 'rightClick', weight: cands.length > 0 ? 4 : 0 },
    { name: 'dragBetween', weight: cands.length > 1 ? 3 : 0 },
    { name: 'wheel', weight: 3 },
    { name: 'typeJunk', weight: 3 },
    { name: 'pressKey', weight: 4 },
    { name: 'resizeWindow', weight: 2 },
    { name: 'multiClick', weight: cands.length > 0 ? 3 : 0 },
    { name: 'toggleTwice', weight: 2 },
    { name: 'reopenProject', weight: ctx.reopenCount < REOPEN_CAP ? 1 : 0 },
  ]
  const chosen = kinds[pickWeighted(rng, kinds.map(k => k.weight))]?.name ?? 'pressKey'

  switch (chosen) {
    case 'rightClick': {
      const c = pickCandidate(rng, cands)
      if (c) return { kind: 'rightClick', targetKey: c.key, note: `right-click ${describe(c)}` }
      break
    }
    case 'dragBetween': {
      const a = pickCandidate(rng, cands)
      const b = pickCandidate(rng, cands)
      if (a && b) {
        return {
          kind: 'dragBetween',
          targetKey: a.key,
          secondaryKey: b.key,
          note: `drag from ${describe(a)} to ${describe(b)}`,
        }
      }
      break
    }
    case 'wheel': {
      const c = pickCandidate(rng, cands)
      const modifiers = pickFrom(rng, WHEEL_MODIFIER_SETS)
      const deltaY = rng() < 0.5 ? -300 : 300
      return {
        kind: 'wheel',
        targetKey: c?.key,
        modifiers,
        deltaY,
        note: `wheel ${deltaY} ${modifiers.join('+') || 'no-mod'} on ${c ? describe(c) : 'viewport'}`,
      }
    }
    case 'typeJunk': {
      const c = pickCandidate(rng, cands, 'input')
      const text = pickFrom(rng, JUNK_INPUTS)
      const followUp: FollowUp = rng() < 0.4 ? 'enter' : null
      return {
        kind: 'typeJunk',
        targetKey: c?.key,
        text,
        followUp,
        note: `type ${JSON.stringify(text.slice(0, 24))}${text.length > 24 ? '…' : ''} into ${c ? describe(c) : 'focused element'}`,
      }
    }
    case 'resizeWindow': {
      const size = pickFrom(rng, RESIZE_SIZES)
      return { kind: 'resizeWindow', size, note: `resize window to ${size.width}x${size.height}` }
    }
    case 'multiClick': {
      const c = pickCandidate(rng, cands)
      const repeat = rng() < 0.5 ? 2 : rng() < 0.7 ? 3 : 5
      if (c) return { kind: 'multiClick', targetKey: c.key, repeat, note: `${repeat}x rapid click ${describe(c)}` }
      break
    }
    case 'toggleTwice': {
      const c = pickCandidate(rng, cands, 'checkbox') ?? pickCandidate(rng, cands)
      if (c) return { kind: 'toggleTwice', targetKey: c.key, note: `toggle twice ${describe(c)}` }
      break
    }
    case 'reopenProject':
      return { kind: 'reopenProject', note: 'close and reopen the project' }
  }
  // Fallback for any branch that could not find a target.
  return { kind: 'pressKey', pressKey: pickFrom(rng, CHAOS_KEYS), note: 'press a random key (chaos fallback)' }
}

/**
 * A project-level verb: what an engineer does between and around the stage
 * work. Null when none is eligible (all capped / done), so the caller falls
 * through to chaos.
 */
function planWorkflow(rng: () => number, ctx: WalkerContext): ActionPlan | null {
  const remainingImports = IMPORT_ROUTES.filter(r => !ctx.importRoutesDone.includes(r.id))
  const canSwitch =
    ctx.canSwitchProject &&
    ctx.projectSwitchCount < SWITCH_PROJECT_CAP &&
    ctx.stepsSinceProjectSwitch >= MIN_STEPS_BETWEEN_PROJECT_SWITCHES
  const W = WORKFLOW_ACTION_WEIGHTS
  const kinds: { name: keyof typeof WORKFLOW_ACTION_WEIGHTS; weight: number }[] = [
    { name: 'switchProject', weight: canSwitch ? W.switchProject : 0 },
    { name: 'undoRedoBurst', weight: W.undoRedoBurst },
    { name: 'saveProject', weight: W.saveProject },
    { name: 'openSettings', weight: W.openSettings },
    { name: 'openImportDialog', weight: remainingImports.length > 0 ? W.openImportDialog : 0 },
  ]
  const chosen = kinds[pickWeighted(rng, kinds.map(k => k.weight))]
  if (!chosen || chosen.weight === 0) return null
  switch (chosen.name) {
    case 'switchProject': {
      const closeChoice: CloseChoice = rng() < 0.5 ? 'discard' : 'save'
      return {
        kind: 'switchProject',
        closeChoice,
        note: `close this project and open the other one (unsaved prompt -> ${closeChoice})`,
      }
    }
    case 'undoRedoBurst': {
      const repeat = 1 + pickIndex(rng, 5)
      return { kind: 'undoRedoBurst', repeat, note: `Ctrl+Z x${repeat} then Ctrl+Y x${repeat}` }
    }
    case 'saveProject':
      return { kind: 'saveProject', note: 'save the project (File > Save, Ctrl+S)' }
    case 'openSettings':
      return { kind: 'openSettings', pick: rng(), note: 'open Settings, flip one switch twice, close it' }
    case 'openImportDialog': {
      const route = pickFrom(rng, remainingImports)
      return { kind: 'openImportDialog', importRoute: route.id, note: `open the ${route.id} import and cancel it` }
    }
  }
  return null
}

/** The "meaningful verb" path: weighted pick of a live control, acted on
 *  in the way its kind invites, sometimes with a novice tail. */
function planNormal(rng: () => number, ctx: WalkerContext): ActionPlan {
  const c = pickCandidate(rng, ctx.candidates)
  if (c === null) {
    // Nothing on screen to click -- a novice presses a key or switches stage.
    return rng() < 0.5
      ? { kind: 'pressKey', pressKey: pickFrom(rng, CHAOS_KEYS), note: 'nothing to click; press a key' }
      : planStageSwitch(rng, ctx)
  }
  const followUp = maybeFollowUp(rng)
  switch (c.kind) {
    case 'input': {
      const text = pickFrom(rng, JUNK_INPUTS)
      return {
        kind: 'typeJunk',
        targetKey: c.key,
        text,
        followUp: rng() < 0.5 ? 'enter' : followUp,
        note: `type ${JSON.stringify(text.slice(0, 24))} into ${describe(c)}`,
      }
    }
    case 'checkbox':
      return { kind: 'toggleTwice', targetKey: c.key, followUp, note: `toggle twice ${describe(c)}` }
    case 'canvas':
      return {
        kind: 'canvasGesture',
        targetKey: c.key,
        followUp,
        note: `canvas gesture on ${describe(c)}`,
      }
    default: {
      // Buttons / menu items / links: usually a click, sometimes a double.
      if (rng() < 0.25) {
        return { kind: 'multiClick', targetKey: c.key, repeat: 2, followUp, note: `double-click ${describe(c)}` }
      }
      return { kind: 'click', targetKey: c.key, followUp, note: `click ${describe(c)}` }
    }
  }
}

/** Short human label for a candidate, for the report's repro trail. */
function describe(c: Candidate): string {
  const id = c.testid ? `#${c.testid}` : ''
  const txt = c.text ? ` "${c.text.slice(0, 24)}"` : ''
  return `<${c.tag}${id}${txt}>`
}

/**
 * Decide the next action for this step.
 *
 * @param ctx - The observed world plus step / stage context.
 * @param seed - The run's base seed. Combined with ``ctx.stepIndex`` so the
 *   decision is a pure function of (seed, step, world) and replays exactly.
 * @returns The action the orchestrator should execute.
 */
export function decideAction(ctx: WalkerContext, seed: number): ActionPlan {
  const rng = stepRng(seed, ctx.stepIndex)
  // Defensive stable sort: an identical world yields an identical order here
  // regardless of the order the orchestrator discovered elements in.
  const sorted = [...ctx.candidates].sort((a, b) =>
    candidateSortKey(a) < candidateSortKey(b) ? -1 : candidateSortKey(a) > candidateSortKey(b) ? 1 : 0,
  )
  const local: WalkerContext = { ...ctx, candidates: sorted }

  // Band 1: switch stage. Bias rises the longer we have sat on one stage, so
  // the whole spine gets walked within the budget even amid chaos.
  const switchBias = Math.min(0.5, 0.05 + local.stepsSinceStageSwitch * 0.03)
  const r = rng()
  if (r < switchBias) return planStageSwitch(rng, local)

  // Band 2: a project-level verb (switch project, undo/redo burst, save,
  // settings, an import dialog). Falls through to chaos when none is eligible.
  if (r < switchBias + WORKFLOW_P) return planWorkflow(rng, local) ?? planChaos(rng, local)

  // Band 3: deliberate chaos (unforeseen interactions).
  const CHAOS_P = 0.38
  if (r < switchBias + WORKFLOW_P + CHAOS_P) return planChaos(rng, local)

  // Band 4: a meaningful verb, done badly.
  return planNormal(rng, local)
}
