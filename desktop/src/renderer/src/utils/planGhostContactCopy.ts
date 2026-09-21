/**
 * The pure decision behind "Shift-drag a ghost boundary onto another test"
 * (installer #42 owner ask, verbatim: *"copying litho's on cptm is still clunky
 * (can we drag copy ghosts also?)"*).
 *
 * The accepted-litho copy (``planLithoContactCopy``) works only on ACCEPTED
 * boundaries and lands ACCEPTED layers. This is its sibling for PENDING
 * suggestions: dragging a ghost boundary from a source test onto another test
 * gives the target a GHOST column (suggestions the user still has to accept),
 * carrying the SAME units the source ghost holds. The user then accepts on the
 * target as usual, so no server row is written by the copy itself.
 *
 * The rules, mirroring the accepted copy where they overlap:
 *
 * - **Same units, same depth below the collar.** Each copied unit keeps its
 *   depth below the source collar (a CPTM dropped-on at a different elevation
 *   gets a same-depth copy, not same-elevation), and its composition. Unlike the
 *   accepted copy, the deepest unit is NOT extended to the target terminal — a
 *   ghost column is a set of suggestions, not a gap-free accepted stack, so the
 *   units are copied verbatim.
 * - **Clip a shallow target, don't refuse (owner 2026-09-16, the accepted-copy
 *   rule).** A unit whose top sits at/below the target's own depth is dropped;
 *   the deepest unit that still fits has its base clamped to the target depth.
 *   ``droppedBelowTerminalCount`` rides the plan so the success toast can report
 *   it. Only a drop where NOTHING fits is refused.
 * - **A source column that mixes accepted and pending boundaries is refused.**
 *   The gesture cannot be both an accepted copy and a ghost copy at once (owner:
 *   "an accepted and a ghost boundary in one drag are refused"). Rejected
 *   suggestions are excluded entirely — they neither copy nor count as a mix.
 * - **A target that already holds a PENDING suggestion is refused.** A ghost
 *   column is renderer-only, and the valuable case is a bare test the segmenter
 *   left empty; overwriting a user's pending suggestions would be a silent
 *   surprise. The segmenter leaves a record on every column it ran on even when
 *   it suggested nothing, so "occupied" is specifically "has a suggestion that
 *   is neither accepted nor rejected" — this predicate lives here in the planner
 *   so every copy rule sits in one tested module (owner, installer #44: "this
 *   test already has suggestions when it clearly does not"). (The alternative —
 *   split-and-recompose like the accepted copy — is murky on a free-form
 *   suggestion stack; refusing keeps the workspace predictable.)
 * - **A drop on the source column is a no-op.**
 *
 * Pure — no React, no I/O — so the owner's rules are pinned as plain data.
 */

/**
 * Match tolerance (m) for clipping a unit against the target's own depth. A
 * suggestion top within this of the target depth is treated as sitting at it
 * (dropped); 1 mm mirrors ``planLithoContactCopy`` and never swallows a real
 * layer (litho layers are at least 1 cm thick).
 */
const DEPTH_MATCH_TOLERANCE_M = 1e-3

/** One admixture on a copied suggestion. */
export interface GhostCopyAdmixture {
  soil_code: string
  amount: string
  locally: boolean
}

/** One suggestion on the SOURCE ghost column the planner reads (effective depths
 *  + composition, with any user edit already applied by the caller). */
export interface GhostCopySourceSuggestion {
  depthTopM: number
  depthBaseM: number
  lithology: string
  admixtures: readonly GhostCopyAdmixture[]
  /** The user accepted this suggestion (it became a committed litho layer). */
  accepted: boolean
  /** The user rejected this suggestion (excluded from the copy AND the mix check). */
  rejected: boolean
}

/** One suggestion the TARGET column already holds, reduced to the two flags the
 *  "is the target occupied?" rule reads. The segmenter leaves a record on every
 *  column it ran on (also when it suggested nothing), so the planner — not the
 *  caller — decides what counts as occupied: a PENDING suggestion, one neither
 *  accepted nor rejected. */
export interface GhostCopyTargetSuggestion {
  /** The user accepted this suggestion (it became a committed litho layer). */
  accepted: boolean
  /** The user rejected this suggestion. */
  rejected: boolean
}

/** One unit the copy places on the target ghost column (depths below the target
 *  collar; the target's own surface elevation is applied by the caller). */
export interface PlannedGhostSuggestion {
  depthTopM: number
  depthBaseM: number
  lithology: string
  admixtures: readonly GhostCopyAdmixture[]
}

/** The decision the ghost drop resolves to.
 *
 *  ``droppedBelowTerminalCount`` (create) counts the units that sat below the
 *  target's own depth and were CLIPPED off; ``0`` when everything fit. */
export type GhostContactCopyPlan =
  | {
      kind: 'create'
      suggestions: readonly PlannedGhostSuggestion[]
      droppedBelowTerminalCount: number
    }
  | { kind: 'noop'; reason: 'same_column' }
  | {
      kind: 'refused'
      reason:
        | 'target_has_ghost'
        | 'mixed_accepted_ghost'
        | 'no_pending_ghost'
        | 'below_terminal'
    }

/**
 * Decide what a Shift-drag of a source ghost column onto another test does.
 *
 * @param params.sourceInvestigationId - The column the ghost was dragged from.
 * @param params.targetInvestigationId - The column dropped on.
 * @param params.sourceSuggestions - The source column's suggestions (effective
 *   depths + composition), each flagged accepted / rejected.
 * @param params.targetSuggestions - The suggestions the target column already
 *   holds (accepted / rejected flags only). The planner derives whether the
 *   target is occupied from these — an empty array is a bare test.
 * @param params.targetTerminalDepthM - The target investigation's terminal depth
 *   (CPT ``max_depth_m`` / borehole ``total_depth_m``), or null when unknown.
 * @returns The plan the caller applies (create / no-op / refused).
 */
export function planGhostContactCopy(params: {
  sourceInvestigationId: string
  targetInvestigationId: string
  sourceSuggestions: readonly GhostCopySourceSuggestion[]
  targetSuggestions: readonly GhostCopyTargetSuggestion[]
  targetTerminalDepthM: number | null
}): GhostContactCopyPlan {
  const {
    sourceInvestigationId,
    targetInvestigationId,
    sourceSuggestions,
    targetSuggestions,
    targetTerminalDepthM,
  } = params

  // A drop on the source column itself does nothing.
  if (sourceInvestigationId === targetInvestigationId) {
    return { kind: 'noop', reason: 'same_column' }
  }

  // A target is "occupied" only when it holds a PENDING suggestion — one neither
  // accepted nor rejected. The segmenter leaves a record on every column it ran
  // on even when it suggested nothing, so "has a record" is NOT "occupied"; a
  // column with no suggestions, or one whose suggestions are all accepted or all
  // rejected, is a free target. Overwriting live pending suggestions would be a
  // silent surprise, so that case is refused.
  const targetHasPendingSuggestion = targetSuggestions.some(s => !s.accepted && !s.rejected)
  if (targetHasPendingSuggestion) {
    return { kind: 'refused', reason: 'target_has_ghost' }
  }

  // Rejected suggestions are out of the picture entirely.
  const visible = sourceSuggestions.filter(s => !s.rejected)
  const pending = visible.filter(s => !s.accepted)
  const acceptedVisible = visible.filter(s => s.accepted)

  // Mixed accepted + pending → the drag cannot be both an accepted copy and a
  // ghost copy (owner: "an accepted and a ghost boundary in one drag are refused").
  if (pending.length > 0 && acceptedVisible.length > 0) {
    return { kind: 'refused', reason: 'mixed_accepted_ghost' }
  }
  if (pending.length === 0) {
    // Nothing pending to ghost-copy (an all-accepted column is the accepted-copy
    // path, an all-rejected/empty one has nothing to place).
    return { kind: 'refused', reason: 'no_pending_ghost' }
  }

  const sorted = [...pending].sort((a, b) => a.depthTopM - b.depthTopM)

  // Unknown target depth → copy verbatim; there is nothing to clip against.
  if (targetTerminalDepthM === null) {
    return {
      kind: 'create',
      suggestions: sorted.map(toPlanned),
      droppedBelowTerminalCount: 0,
    }
  }

  // Clip against the target's own depth (owner 2026-09-16): a unit whose top
  // sits at/below the target depth is dropped; the deepest kept unit's base is
  // clamped to the target depth so it does not overshoot.
  const fitting = sorted.filter(
    s => s.depthTopM < targetTerminalDepthM - DEPTH_MATCH_TOLERANCE_M,
  )
  const droppedBelowTerminalCount = sorted.length - fitting.length
  if (fitting.length === 0) {
    return { kind: 'refused', reason: 'below_terminal' }
  }
  const suggestions = fitting.map(s =>
    toPlanned({
      ...s,
      depthBaseM: Math.min(s.depthBaseM, targetTerminalDepthM),
    }),
  )
  return { kind: 'create', suggestions, droppedBelowTerminalCount }
}

/** Project a source suggestion onto the target column's ghost unit. */
function toPlanned(s: GhostCopySourceSuggestion): PlannedGhostSuggestion {
  return {
    depthTopM: s.depthTopM,
    depthBaseM: s.depthBaseM,
    lithology: s.lithology,
    admixtures: s.admixtures.map(a => ({ ...a })),
  }
}
