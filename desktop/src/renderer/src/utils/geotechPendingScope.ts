/**
 * How the geotech toolbar talks about pending packing ties once steps 2 and 3
 * are section-scoped.
 *
 * Owner ruling (dogfeed 2026-08-15): *"I also see that this is model wide and
 * not per section, i don't like that"*.  Steps 2 (auto-correlate) and 3
 * (accept) act on the section he has open — and reading the menu afterwards he
 * closed the set: *"i'm reading divide boreholes (whole model), no that should
 * also be section scoped"*.  So step 4 follows the open section too, and its
 * gate counts the ties on the section it divides.
 *
 * The model total does not disappear: a bare "5 pending here" with nothing else
 * said would hide that the MODEL is not finished.  It moves to the chip's
 * tooltip, where it is context rather than a blocker.  These are the sentences
 * that say it, kept as pure functions so the wording is testable without
 * mounting the 2 000-line ``SectionsToolbar``.
 */

import type { Translator } from '../i18n/translate'

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
  /**
   * Section names by id, so the tooltip can NAME the other sections carrying
   * pending ties (owner 2026-09-04: a chip that says "elsewhere" without
   * saying where reads as a flag with no reason). Optional: without it the
   * sentence falls back to the count.
   */
  sectionNames?: Readonly<Record<string, string>>
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
  /**
   * Names of the OTHER sections (not the open one) carrying pending ties, in
   * the order the counts came; ``null`` when names were not supplied or the
   * per-section counts are unknown.
   */
  sectionNamesWithPending: readonly string[] | null
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
    return { modelPending, sectionPending: null, sectionsWithPending: null, sectionNamesWithPending: null }
  }
  const sectionsWithPending = Object.values(pendingBySection).filter(count => count > 0).length
  const sectionNamesWithPending =
    counts.sectionNames === undefined
      ? null
      : Object.entries(pendingBySection)
          .filter(([id, count]) => count > 0 && id !== activeSectionId)
          .map(([id]) => counts.sectionNames?.[id] ?? id)
  return {
    modelPending,
    sectionPending: activeSectionId === null ? null : (pendingBySection[activeSectionId] ?? 0),
    sectionsWithPending,
    sectionNamesWithPending,
  }
}

/** ``1 section`` / ``3 sections``. */
function sectionsPhrase(t: Translator, count: number): string {
  return t(count === 1 ? 'sections.geotech.sectionsOne' : 'sections.geotech.sectionsMany', {
    n: count,
  })
}

/** ``1 packing tie`` / ``4 packing ties``. */
function tiesPhrase(t: Translator, count: number): string {
  return t(count === 1 ? 'sections.geotech.tiesOne' : 'sections.geotech.tiesMany', { n: count })
}

/**
 * The amber chip's text — the OPEN section's count when it is knowable.
 *
 * @param t - Active-language translator.
 * @param scope - Summary from {@link summarisePendingTies}.
 * @returns Chip label; the model total when no section scope is available.
 */
export function pendingChipLabel(t: Translator, scope: PendingTieScope): string {
  if (scope.sectionPending === null)
    return t('sections.geotech.pendingModel', { n: scope.modelPending })
  return t('sections.geotech.pendingHere', { n: scope.sectionPending })
}

/**
 * The chip's tooltip — where the model total and the neighbours live.
 *
 * @param t - Active-language translator.
 * @param scope - Summary from {@link summarisePendingTies}.
 * @param acceptedModelWide - Accepted ties across the model, for context.
 * @returns The full sentence.
 */
export function pendingChipTitle(
  t: Translator,
  scope: PendingTieScope,
  acceptedModelWide: number,
): string {
  if (scope.sectionPending === null || scope.sectionsWithPending === null) {
    return t('sections.geotech.pendingTitleModel', {
      ties: tiesPhrase(t, scope.modelPending),
      accepted: acceptedModelWide,
    })
  }
  const elsewhere = scope.modelPending - scope.sectionPending
  const rest =
    elsewhere > 0
      ? t('sections.geotech.pendingElsewhere', {
          elsewhere,
          // Name the sections when the caller supplied names (owner 2026-09-04);
          // the count phrase is the fallback.
          sections:
            scope.sectionNamesWithPending && scope.sectionNamesWithPending.length > 0
              ? scope.sectionNamesWithPending.join(', ')
              : sectionsPhrase(t, scope.sectionsWithPending - (scope.sectionPending > 0 ? 1 : 0)),
        })
      : t('sections.geotech.pendingNowhereElse')
  return t('sections.geotech.pendingTitleSection', {
    sectionPending: scope.sectionPending,
    ties: tiesPhrase(t, scope.modelPending),
    accepted: acceptedModelWide,
    rest,
  })
}

/**
 * The visible tag pill on the disabled "4 · Divide boreholes" item.
 *
 * A disabled menu item fires no mouse events in Chromium, so the gate's reason
 * has to be SHOWN, not hovered.
 *
 * Counts the OPEN section (owner ruling 2026-08-15: *"i'm reading divide
 * boreholes (whole model), no that should also be section scoped"*) — the
 * press divides this section's boreholes, so this section's proposals are the
 * only evidence it could throw away. The model total moves to the chip's
 * tooltip, where it is context rather than a blocker.
 *
 * @param t - Active-language translator.
 * @param scope - Summary from {@link summarisePendingTies}.
 * @returns Short tag text.
 */
export function dividePendingTag(t: Translator, scope: PendingTieScope): string {
  if (scope.sectionPending === null)
    return t('sections.geotech.divideTagModel', { n: scope.modelPending })
  return t('sections.geotech.divideTagSection', { n: scope.sectionPending })
}

/**
 * The gate's full sentence — what is holding THIS section's divide shut.
 *
 * @param t - Active-language translator.
 * @param scope - Summary from {@link summarisePendingTies}.
 * @returns The title attribute for the disabled item.
 */
export function dividePendingTitle(t: Translator, scope: PendingTieScope): string {
  if (scope.sectionPending === null) {
    return t('sections.geotech.divideTitleModel', { ties: tiesPhrase(t, scope.modelPending) })
  }
  return t('sections.geotech.divideTitleSection', {
    ties: tiesPhrase(t, scope.sectionPending),
  })
}
