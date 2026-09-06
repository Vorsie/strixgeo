/**
 * Shared types for the scenario-pass "walker" (owner ruling 2026-09-06).
 *
 * The walker plays a NOVICE engineer through the worked-example project before
 * every installer build, so the owner has less dogfeeding to do. This module
 * carries only the data shapes the three pure modules (walkerPolicy,
 * walkerInvariants, walkerReport) and the Playwright orchestrator all share, so
 * every one of them stays free of Playwright and app imports and can be unit
 * tested on its own.
 *
 * Nothing here imports Playwright, Electron, or renderer code. Keeping it pure
 * is what lets ``walkerPolicy.test.ts`` and ``walkerInvariants.test.ts`` run
 * under Vitest without the app, and keeps the whole ``tests/e2e/walker`` tree
 * inside ``tsconfig.e2e``'s rootDir (no cross-boundary import into ``src/``).
 */

/** The seven workflow-spine stages, by their stable visible label. */
export type SpineLabel =
  | 'Data'
  | 'Sections'
  | 'Stratigraphy'
  | 'Litho'
  | 'Geotech'
  | 'Parameters'
  | 'Export'

/** What kind of control a discovered DOM element is, for interaction choice. */
export type CandidateKind =
  | 'button'
  | 'input'
  | 'checkbox'
  | 'menuitem'
  | 'canvas'
  | 'link'
  | 'select'
  | 'generic'

/**
 * One interactive element found on screen by the DOM-discovery pass.
 *
 * Every field is a plain serialisable value so the whole array survives
 * ``page.evaluate`` and can be handed to the pure policy. ``key`` is a
 * ``data-walker-target`` marker the discovery pass stamps on the live element,
 * so the orchestrator can re-locate exactly this element to act on it.
 */
export interface Candidate {
  /** Resolvable marker, e.g. ``wt:42`` -> ``[data-walker-target="wt:42"]``. */
  readonly key: string
  /** The element's ``data-testid`` when it has one, else null. */
  readonly testid: string | null
  /** The element's ARIA role when it has one, else null. */
  readonly role: string | null
  /** Lowercased tag name (``button``, ``input``, ``canvas``, ...). */
  readonly tag: string
  /** Trimmed, length-capped visible text (for the report and for weighting). */
  readonly text: string
  /** False when disabled / aria-disabled -- the policy may still poke it. */
  readonly enabled: boolean
  /** Coarse interaction category derived in the browser. */
  readonly kind: CandidateKind
  /** Viewport box (CSS px) -- the orchestrator clicks / drags at its centre. */
  readonly box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
}

/** Every action the policy can propose and the orchestrator can execute. */
export type ActionKind =
  | 'click'
  | 'multiClick'
  | 'rightClick'
  | 'hover'
  | 'typeJunk'
  | 'pressKey'
  | 'wheel'
  | 'dragBetween'
  | 'canvasGesture'
  | 'switchStage'
  | 'resizeWindow'
  | 'toggleTwice'
  | 'reopenProject'

/** A small tail a novice tacks onto an action (repeat it, undo, escape...). */
export type FollowUp = 'undo' | 'redo' | 'escape' | 'enter' | null

/**
 * A fully-decided action. The policy returns these; the orchestrator executes
 * them. All target references are candidate ``key``s so the plan stays a plain
 * value (testable) and the orchestrator owns the DOM resolution.
 */
export interface ActionPlan {
  readonly kind: ActionKind
  /** Primary candidate key (click / type / wheel / drag start / gesture). */
  readonly targetKey?: string
  /** Secondary candidate key (drag end). */
  readonly secondaryKey?: string
  /** Text to type / paste for ``typeJunk``. */
  readonly text?: string
  /** Key combo for ``pressKey`` (e.g. ``Escape``, ``Control+z``, ``F1``). */
  readonly pressKey?: string
  /** Modifier set for ``wheel`` / modified clicks (``Control``/``Shift``/``Alt``). */
  readonly modifiers?: readonly string[]
  /** Wheel delta (signed) for ``wheel``. */
  readonly deltaY?: number
  /** Target stage for ``switchStage``. */
  readonly stage?: SpineLabel
  /** Window size for ``resizeWindow``. */
  readonly size?: { readonly width: number; readonly height: number }
  /** Click repeat count for ``multiClick`` (2 = double, 3 = triple, more = hammer). */
  readonly repeat?: number
  /** Optional novice tail run after the main action. */
  readonly followUp?: FollowUp
  /** One-line human description, verbatim in the report's repro trail. */
  readonly note: string
}

/**
 * Everything the policy needs to decide the next action. Assembled by the
 * orchestrator each step (mostly from a DOM-discovery ``page.evaluate``), then
 * handed to the pure ``decideAction``.
 */
export interface WalkerContext {
  /** 0-based step number. Also seeds the per-step RNG, so it drives replay. */
  readonly stepIndex: number
  /** The stage whose tab is currently pressed, or null when undetectable. */
  readonly currentStage: SpineLabel | null
  /** Stages entered so far (drives coverage-biased stage switching). */
  readonly visitedStages: readonly SpineLabel[]
  /** Steps since the last stage switch (nudges an eventual switch). */
  readonly stepsSinceStageSwitch: number
  /** Live interactive elements, already stable-sorted by the orchestrator. */
  readonly candidates: readonly Candidate[]
  /** True when a floating menu or modal dialog is open. */
  readonly openMenu: boolean
  /** How many ``reopenProject`` actions have already run (the policy self-caps). */
  readonly reopenCount: number
}

/** A refused request the response hook captured. */
export interface BadResponse {
  readonly method: string
  readonly url: string
  readonly status: number
}
