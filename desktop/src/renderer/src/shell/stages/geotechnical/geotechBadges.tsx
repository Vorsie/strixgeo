// The two badges the geotech roster puts on a packing-body leaf: where the
// packing class came from, and how much the model trusts it.
//
// Own module because the tree builder (geotechUnitTree.ts) supplies the
// per-body provenance / confidence, and the leaf renderer (geotechRosterRows.tsx)
// draws them — keeping the vocabulary in one place so the value the builder
// computes and the badge the leaf shows can never drift apart.

import type { LithoLayerConfidence } from '../../../api/client'
import { useT } from '../../../i18n/translate'
import type { MessageKey } from '../../../i18n/locales/en'
import type { ClassProvenance } from './geotechUnitTree'

/**
 * Tailwind classes for each confidence tier.
 *
 * B2 (WCAG): amber is reserved for unsaved-state markers (memory
 * project_dirty_amber_color); red is reserved for errors. Neutral slate for
 * medium and orange for low give attention without the error connotation.
 */
const CONFIDENCE_BADGE_CLASS: Record<LithoLayerConfidence, string> = {
  high: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  medium: 'bg-slate-100 text-slate-600 dark:bg-slate-800/50 dark:text-slate-300',
  low: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
}

/** Message-catalogue key for each confidence tier's capitalised label. */
const CONFIDENCE_LABEL_KEYS: Record<LithoLayerConfidence, MessageKey> = {
  high: 'geotech.confidenceHigh',
  medium: 'geotech.confidenceMedium',
  low: 'geotech.confidenceLow',
}

/**
 * Badge text, tooltip, test-id stem and colour per provenance value.
 *
 * The NORM carries no badge (owner, 2026-08-27: *"CPT est. die flag mag
 * eruit, bijna alle packingsklassen zijn altijd uit sonderingen afgeleid"*) —
 * cone-derived is what almost every class is, so ``'cpt'`` maps to ``null``
 * and only the EXCEPTIONS are marked.
 *
 * The exception wording is load-bearing. A non-null NAD class does NOT imply
 * a cone touched the soil: the borehole packing fill also emits ``body_min``
 * (the weakest class seen elsewhere in the body) and ``absolute_min`` (a
 * lithology floor from ``geotech_subdivision_constants``). Both persist as
 * confidence 'low' (``divide_boreholes._BOREHOLE_CONFIDENCE_MAP``), while
 * CPT-derived bands persist 'high' / 'medium'. Presenting one of those
 * unmarked would present an invented value as a measured one (Data Integrity
 * rules 1 and 2) — and calling a unit with 141 cone bands and one fill band
 * "No CPT" is its own untrue statement, which is why the mixture keeps a
 * badge of its own rather than being rounded to either end.
 *
 * Neither tooltip says "fallback": owner, 2026-08-15, *"I don't really like
 * the word fallback, this just means the model isn't ready."*
 */
const PROVENANCE_BADGES: Record<
  ClassProvenance,
  { textKey: MessageKey; titleKey: MessageKey; testIdStem: string; className: string } | null
> = {
  cpt: null,
  partial: {
    textKey: 'geotech.badgeCptEstPartial',
    titleKey: 'geotech.badgePartialHint',
    testIdStem: 'partial-cpt-badge',
    className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  },
  none: {
    textKey: 'geotech.badgeNoCpt',
    titleKey: 'geotech.badgeNoCptHint',
    testIdStem: 'no-cpt-badge',
    className: 'bg-slate-100 text-slate-600 dark:bg-slate-800/50 dark:text-slate-300',
  },
}

/**
 * Provenance badge for a class row or a unit instance.
 *
 * Suppressed when the row has no packing class (there is no classification to
 * state a provenance for, and the row's own label already says so) and for
 * fully cone-derived rows (the norm is unlabelled — only exceptions badge).
 *
 * Parameters
 * ----------
 * provenance
 *     Where the class came from — ``'cpt'`` / ``'partial'`` / ``'none'``.
 * nadClass
 *     The row's NAD class; ``null`` suppresses the badge.
 * idKey
 *     Test-id suffix — the formation id for a single-unit row, the class key
 *     otherwise.
 *
 * Returns
 * -------
 * JSX.Element | null
 *     The badge, or ``null`` when there is no class to describe.
 */
export function ProvenanceBadge({
  provenance,
  nadClass,
  idKey,
}: {
  provenance: ClassProvenance
  nadClass: number | null
  idKey: string
}): JSX.Element | null {
  const t = useT()
  if (nadClass === null) return null
  const badge = PROVENANCE_BADGES[provenance]
  if (badge === null) return null
  return (
    <span
      className={`text-[10px] rounded px-1 py-0 flex-shrink-0 ${badge.className}`}
      title={t(badge.titleKey)}
      data-testid={`${badge.testIdStem}-${idKey}`}
    >
      {t(badge.textKey)}
    </span>
  )
}

/**
 * Confidence badge for a class row or a unit instance.
 *
 * Parameters
 * ----------
 * confidence
 *     Aggregated confidence, or ``null`` to render nothing.
 * idKey
 *     Test-id suffix — see ``ProvenanceBadge``.
 *
 * Returns
 * -------
 * JSX.Element | null
 *     The badge, or ``null`` when no layer backs the row.
 */
export function ConfidenceBadge({
  confidence,
  idKey,
}: {
  confidence: LithoLayerConfidence | null
  idKey: string
}): JSX.Element | null {
  const t = useT()
  if (confidence === null) return null
  return (
    <span
      className={`text-[10px] rounded px-1 py-0 flex-shrink-0 ${CONFIDENCE_BADGE_CLASS[confidence]}`}
      title={t('geotech.badgeConfidence')}
      data-testid={`confidence-badge-${idKey}`}
    >
      {t(CONFIDENCE_LABEL_KEYS[confidence])}
    </span>
  )
}
