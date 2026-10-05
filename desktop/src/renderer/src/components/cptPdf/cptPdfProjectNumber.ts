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
 * The field's starting value: the project number every campaign sheet prints.
 *
 * @param digest - The triage digest.
 * @returns The shared printed number; '' when a sheet prints none or two sheets
 *   print different numbers (the field then fills nothing until typed).
 */
export function reportProjectNumber(digest: CptPdfDigest): string {
  const numbers = new Set(digest.campaign.map(s => present(s.project_number)))
  if (numbers.size !== 1) return ''
  const [only] = numbers
  return only ?? ''
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
