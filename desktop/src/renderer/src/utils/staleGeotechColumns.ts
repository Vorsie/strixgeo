/**
 * The one answer to "are this column's packing bands out of date?" (debt #266).
 *
 * Two independent signals say a column's bands no longer describe the ground,
 * and the engineer must not have to reconcile them:
 *
 * 1. **Fit** — {@link ../utils/geotechParentFit}: a band pokes out of the litho
 *    unit it subdivides. Derived in the renderer from the layers already
 *    loaded, so it is instant, but it is CPT-only and it can only see a unit
 *    that SHRANK. A unit that grew, was re-classified to another soil, or was
 *    deleted leaves every band still fitting.
 * 2. **Provenance** — the server compares the litho digest each column's bands
 *    were stamped with against the litho under it now (`GET
 *    .../geotech/litho-staleness`). Covers boreholes as well as CPTs and every
 *    kind of change, including the ones fit cannot see, and it is the same
 *    answer the coming export-completeness guard reads.
 *
 * Neither subsumes the other, so this module unions them. One marker per
 * column, one count on one chip: two overlapping amber warnings about the same
 * column is the alarm-fatigue failure #266 exists to avoid, and the engineer's
 * action is identical either way — re-run the subdivision on that column.
 *
 * @module utils/staleGeotechColumns
 */
import type { StaleGeotechColumn } from '../api/clients/geology.types'
import type { Translator } from '../i18n/translate'

/**
 * Merge the provenance answer with the geometric fit answer.
 *
 * @param provenanceStale - Columns the server reports as standing on edited
 *   litho, already labelled and sorted.
 * @param fitStaleIds - Investigation ids whose bands overhang their litho
 *   parent (``columnsNeedingRederive``). Unlabelled — CPT ids only.
 * @param labelFor - Resolves an investigation id to its display name; falls
 *   back to the id so a column is never dropped for want of a name.
 * @returns Every out-of-date column exactly once, sorted by label so two reads
 *   present the same list.
 */
export function unionStaleGeotechColumns(
  provenanceStale: readonly StaleGeotechColumn[],
  fitStaleIds: readonly string[],
  labelFor: (investigationId: string) => string | undefined,
): StaleGeotechColumn[] {
  const byId = new Map<string, StaleGeotechColumn>()
  for (const column of provenanceStale) byId.set(column.investigation_id, column)
  for (const id of fitStaleIds) {
    if (byId.has(id)) continue
    byId.set(id, { investigation_id: id, label: labelFor(id) ?? id })
  }
  return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label))
}

/**
 * Label for the toolbar chip.
 *
 * Short enough to sit beside the pending-tie count; the tooltip carries the
 * names and the instruction.
 *
 * @param t - Active-language translator.
 * @param count - How many columns are out of date.
 */
export function staleGeotechChipLabel(t: Translator, count: number): string {
  return t('sections.geotech.staleChipLabel', { n: count })
}

/**
 * Tooltip: which columns, what happened, and what to do about it.
 *
 * Names the columns rather than only counting them — a warning the engineer
 * cannot trace to a column is one he cannot act on. Long lists are summarised
 * so the tooltip stays readable on a model with many columns.
 *
 * @param t - Active-language translator.
 * @param columns - The out-of-date columns, sorted by label.
 * @param maxNamed - How many to name before summarising the rest.
 */
export function staleGeotechChipTitle(
  t: Translator,
  columns: readonly StaleGeotechColumn[],
  maxNamed = 6,
): string {
  if (columns.length === 0) return t('sections.geotech.staleTitleNone')
  const named = columns.slice(0, maxNamed).map(c => c.label)
  const rest = columns.length - named.length
  const list =
    rest > 0
      ? t('sections.geotech.staleAndMore', { named: named.join(', '), rest })
      : named.join(', ')
  return t(
    columns.length === 1 ? 'sections.geotech.staleTitleOne' : 'sections.geotech.staleTitleMany',
    { list },
  )
}
