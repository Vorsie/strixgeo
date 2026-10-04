// The import-summary line for a GEF whose declared pre-drill (#MEASUREMENTVAR=
// 13) the depth column was NOT shifted by — backend code PRE_DRILL_NOT_APPLIED
// (camz-001 soundings 39 and 42: 0.35 m declared, data from 0.02 m). The
// depths are kept as read, so the engineer is told which CPT, the declared
// pre-drill and the first depth, and checks them against the report.

import type { ImportCptResponse } from '../api/clients/cpt'
import type { Translator } from '../i18n/translate'

/** The backend finding code this line renders. */
export const PRE_DRILL_NOT_APPLIED = 'PRE_DRILL_NOT_APPLIED'

/**
 * The warning line for one imported CPT, or null when it has no such finding.
 *
 * @param issues - The parse findings the import endpoint returned.
 * @param name - Display name of the CPT (persisted name or file name).
 * @param t - Translator of the active UI language.
 * @returns The translated line, the backend's English message when the
 *   finding carries no numbers (a backend that predates ``details``), or null.
 */
export function preDrillImportWarning(
  issues: ImportCptResponse['issues'],
  name: string,
  t: Translator,
): string | null {
  const issue = issues.find(i => i.code === PRE_DRILL_NOT_APPLIED)
  if (!issue) return null
  const declared = issue.details?.pre_drill_m
  const first = issue.details?.first_depth_m
  if (declared === undefined || first === undefined) return `${name}: ${issue.message}`
  return t('data.import.preDrillNotApplied', {
    name,
    preDrill: declared.toFixed(2),
    firstDepth: first.toFixed(2),
  })
}
