import type { Translator } from '../i18n/translate'

// The canonical English default names the create-time generator writes
// (``Cross-section N`` / ``Tie-section N`` in ``hooks/useSections.ts``). Only
// these exact, untouched defaults are translated at the presentation boundary; a
// user-renamed section carries an arbitrary name and is shown verbatim.
const CROSS_SECTION_DEFAULT = /^Cross-section (\d+)$/
const TIE_SECTION_DEFAULT = /^Tie-section (\d+)$/

/**
 * The section name to SHOW in the pane, translated at the presentation boundary.
 *
 * The stored ``section.name`` stays the English canonical default
 * ("Cross-section 1" / "Tie-section 1") — no data migration — and this helper
 * translates just those two defaults for display. A section the user renamed
 * (anything that is not an exact default) is returned unchanged, so custom names
 * survive untouched. This fixes EXISTING sections without rewriting any row, and
 * gives the inspector row, the delete dialog and the header strip one consistent
 * label producer.
 *
 * @param section - The section whose display label is wanted (only ``name`` is read).
 * @param t - The active-language translator (from ``useT``).
 * @returns The translated default label, or the raw name for a custom section.
 */
export function sectionDisplayName(section: { name: string }, t: Translator): string {
  const cross = section.name.match(CROSS_SECTION_DEFAULT)
  if (cross) return t('sections.kindLabel.cross', { n: cross[1] })
  const tie = section.name.match(TIE_SECTION_DEFAULT)
  if (tie) return t('sections.kindLabel.tie', { n: tie[1] })
  return section.name
}
