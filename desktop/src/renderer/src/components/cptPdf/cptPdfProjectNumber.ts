// The "Projectnummer" field of the PDF CPT import dialog (owner ruling
// 2026-10-05 a). A sheet that prints no project number (every CAMZ-005 sheet)
// was stored under the campaign code, so a later GEF import of the same
// sounding ("CPT, 23.15-006") never met it on the Replace path. One field at
// the top of the triage list fills the project number of every listed
// sounding whose own header has none. Precedence, highest first: a project
// number typed for that one row (header edit), the row's own printed number,
// the field. Nothing is persisted beyond the import.

import type { CptPdfDigest, CptPdfHeaderEdit, CptPdfSounding } from '../../api/clients/cptPdf'

/** A sounding number printed bare ("110", "28A"): shown as "<project>-S<number>".
 *  Twin of ``BARE_SOUNDING_NUMBER`` in ``domain/services/cpt_display_name_constants.py``. */
const BARE_SOUNDING_NUMBER = /^\d+[A-Za-z]?$/
/** Twin of ``SOUNDING_SEPARATOR`` in the same Python module. */
const SOUNDING_SEPARATOR = '-S'

/** The trimmed text, or null when it is empty. */
function present(text: string | null | undefined): string | null {
  const trimmed = (text ?? '').trim()
  return trimmed === '' ? null : trimmed
}

/**
 * The field's starting value: the project number most campaign sheets print
 * (owner ruling 2026-10-07, "can't we suggest a standard?"). On CAMZ-001 sheet
 * 14A prints 24.13-005 and the other 74 print 23.15-002, so the field suggests
 * 23.15-002. It stays a suggestion: the user can edit it, and it only fills
 * rows that print no number of their own (see ``fieldFillFor``).
 *
 * @param digest - The triage digest; ``campaign`` is in page order.
 * @returns The most common printed number, ties going to the one met first in
 *   page order; '' when no sheet prints a number.
 */
export function reportProjectNumber(digest: CptPdfDigest): string {
  // A Map keeps insertion order, so the first-met number wins a tie below.
  const counts = new Map<string, number>()
  for (const s of digest.campaign) {
    const number = present(s.project_number)
    if (number !== null) counts.set(number, (counts.get(number) ?? 0) + 1)
  }
  let best = ''
  let bestCount = 0
  for (const [number, count] of counts) {
    if (count > bestCount) {
      best = number
      bestCount = count
    }
  }
  return best
}

/**
 * The project number the field adds to a row's header edit, or null when the
 * row prints its own, has one typed, or the field is empty.
 *
 * @param sounding - The listed sounding.
 * @param field - The "Projectnummer" field value.
 * @param header - The per-row header edit, if any.
 * @returns The trimmed field value to send, or null.
 */
export function fieldFillFor(
  sounding: CptPdfSounding,
  field: string,
  header?: CptPdfHeaderEdit,
): string | null {
  if (present(header?.project_number) !== null || present(sounding.project_number) !== null) return null
  return present(field)
}

/**
 * The name a row is shown under, with the project number it will be imported under.
 *
 * Mirrors ``cpt_display_name`` (Python): a bare sounding number under a project
 * reads "<project>-S<number>" ("23.15-006-S85"); any other id reads as itself.
 *
 * @param sounding - The listed sounding.
 * @param field - The "Projectnummer" field value.
 * @param header - The per-row header edit, if any.
 * @returns The row label.
 */
export function rowLabel(sounding: CptPdfSounding, field: string, header?: CptPdfHeaderEdit): string {
  const fill = present(header?.project_number) ?? fieldFillFor(sounding, field, header)
  if (fill === null) return sounding.display_name ?? sounding.sounding_id ?? sounding.key
  const number = (sounding.sounding_id ?? sounding.key).trim()
  return BARE_SOUNDING_NUMBER.test(number) ? `${fill}${SOUNDING_SEPARATOR}${number}` : number
}
