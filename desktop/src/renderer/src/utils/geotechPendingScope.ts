/**
 * How the geotech toolbar talks about pending packing ties once steps 2 and 3
 * are section-scoped.
 *
 * Owner ruling (dogfeed 2026-08-15): *"I also see that this is model wide and
 * not per section, i don't like that"*.  Steps 2 (auto-correlate) and 3
 * (accept) now act on the section he has open.  Step 4 (divide boreholes) does
 * NOT: it TIN-divides every borehole column of the model and so rewrites every
 * section, which is why its gate still demands the whole model be clear.
 *
 * That asymmetry is only fair if the toolbar explains it.  A bare "12 pending"
 * beside a disabled button, on a section where the engineer has just accepted
 * everything he can see, reads as a bug.  "accept 12 on 2 sections" reads as a
 * workflow.  These are the sentences that say it, kept as pure functions so
 * the wording is testable without mounting the 2 000-line ``SectionsToolbar``.
 */

/** Raw counts the summary is built from. */
export interface PendingTieCounts {
  /** Pending ties across the WHOLE geotech model — what step 4 is gated on. */
  modelPending: number
  /**
   * ``section_id → pending count`` from ``GET .../geotech/tie-status``.
   * ``undefined`` when the answer carried no breakdown (an older backend, or a
   * request that has not landed) — never treated as "no section is pending".
   */
  pendingBySection: Readonly<Record<string, number>> | undefined
  /** The section the engineer has open; ``null`` when none is selected. */
  activeSectionId: string | null
}

/** The three numbers every sentence below is phrased from. */
export interface PendingTieScope {
  /** Pending ties across the whole model. */
  modelPending: number
  /**
   * Pending ties on the OPEN section.  ``null`` means "not knowable" — either
   * no section is open or the breakdown is missing — and every caller must
   * fall back to the model total rather than print a confident zero.
   */
  sectionPending: number | null
  /** Sections carrying at least one pending tie; ``null`` when not knowable. */
  sectionsWithPending: number | null
}

/**
 * Fold the tie-status counts into the model / section / sections triple.
 *
 * @param counts - Model total, the per-section breakdown, and the open section.
 * @returns The scope summary the label helpers below read.
 */
export function summarisePendingTies(counts: PendingTieCounts): PendingTieScope {
  const { modelPending, pendingBySection, activeSectionId } = counts
  if (pendingBySection === undefined) {
    // Unknown, not empty. Claiming "0 sections pending" next to a disabled
    // button would read as "nothing is blocking you".
    return { modelPending, sectionPending: null, sectionsWithPending: null }
  }
  const sectionsWithPending = Object.values(pendingBySection).filter(count => count > 0).length
  return {
    modelPending,
    sectionPending: activeSectionId === null ? null : (pendingBySection[activeSectionId] ?? 0),
    sectionsWithPending,
  }
}

/** ``1 section`` / ``3 sections``. */
function sectionsPhrase(count: number): string {
  return `${count} section${count === 1 ? '' : 's'}`
}

/** ``1 packing tie`` / ``4 packing ties``. */
function tiesPhrase(count: number): string {
  return `${count} packing tie${count === 1 ? '' : 's'}`
}

/**
 * The amber chip's text — the OPEN section's count when it is knowable.
 *
 * @param scope - Summary from {@link summarisePendingTies}.
 * @returns Chip label; the model total when no section scope is available.
 */
export function pendingChipLabel(scope: PendingTieScope): string {
  if (scope.sectionPending === null) return `${scope.modelPending} pending`
  return `${scope.sectionPending} pending here`
}

/**
 * The chip's tooltip — where the model total and the neighbours live.
 *
 * @param scope - Summary from {@link summarisePendingTies}.
 * @param acceptedModelWide - Accepted ties across the model, for context.
 * @returns The full sentence.
 */
export function pendingChipTitle(scope: PendingTieScope, acceptedModelWide: number): string {
  if (scope.sectionPending === null || scope.sectionsWithPending === null) {
    return (
      `${tiesPhrase(scope.modelPending)} proposed and not yet accepted ` +
      `(${acceptedModelWide} accepted).`
    )
  }
  const elsewhere = scope.modelPending - scope.sectionPending
  const rest =
    elsewhere > 0
      ? ` The other ${elsewhere} sit on ${sectionsPhrase(
          scope.sectionsWithPending - (scope.sectionPending > 0 ? 1 : 0),
        )}, which “4 · Divide boreholes” also needs clear.`
      : ' Nothing is pending anywhere else in the model.'
  return (
    `${scope.sectionPending} of ${tiesPhrase(scope.modelPending)} proposed on this ` +
    `section (${acceptedModelWide} accepted model-wide).${rest}`
  )
}

/**
 * The visible tag pill on the disabled "4 · Divide boreholes" item.
 *
 * A disabled menu item fires no mouse events in Chromium, so the gate's reason
 * has to be SHOWN, not hovered.
 *
 * @param scope - Summary from {@link summarisePendingTies}.
 * @returns Short tag text.
 */
export function dividePendingTag(scope: PendingTieScope): string {
  if (scope.sectionsWithPending === null) return `accept ${scope.modelPending} first`
  return `accept ${scope.modelPending} on ${sectionsPhrase(scope.sectionsWithPending)}`
}

/**
 * The gate's full sentence — why a section-scoped workflow has a model-wide step.
 *
 * @param scope - Summary from {@link summarisePendingTies}.
 * @returns The title attribute for the disabled item.
 */
export function dividePendingTitle(scope: PendingTieScope): string {
  if (scope.sectionsWithPending === null) {
    return `${tiesPhrase(scope.modelPending)} still proposed — accept or delete them first`
  }
  return (
    `${tiesPhrase(scope.modelPending)} still proposed on ` +
    `${sectionsPhrase(scope.sectionsWithPending)}. Dividing the boreholes rewrites ` +
    `every section, so the whole model has to be clear — accept or delete them first.`
  )
}
