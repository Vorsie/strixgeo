/**
 * Tolerant date parser for investigation start dates.
 *
 * Borehole and CPT list items carry start_date as strings from two different
 * backends:
 *   - Borehole: ISO date (``"YYYY-MM-DD"``) — always well-formed when present
 *     because BoreholeListItem.start_date is a Python ``date | None``.
 *   - CPT: raw ``file_date`` string from the GEF/DOV parser (String(20) column).
 *     May be ``"YYYY-MM-DD"``, ``"YYYY/MM/DD"``, a 4-digit year only, or
 *     something unparseable (old GEF files, missing field).
 *
 * Both arrive as ``string | null`` in the frontend (Borehole serialises the
 * Python date to ISO; CPT is already a raw string).
 */

/**
 * Parse a raw investigation date string to a ``Date`` object.
 *
 * Accepts:
 * - ``null`` / empty string → null (treated as "no date").
 * - ISO ``YYYY-MM-DD`` or ``YYYY/MM/DD`` → parsed to that calendar day.
 * - Year-only ``YYYY`` → 1 January of that year (best-effort floor).
 * - Anything else → null (treated as unparseable / no date).
 *
 * All accepted strings are interpreted as UTC midnight so comparisons between
 * dates from different sources are not skewed by local timezone offsets.
 * The Date objects are used only for < / > comparison, not for display.
 *
 * @param raw - Raw date string from the API, or null.
 * @returns A Date at UTC midnight for the inferred calendar day, or null when
 *          the input is absent or unparseable.
 */
export function parseInvestigationDate(raw: string | null | undefined): Date | null {
  // Normalise null / undefined / whitespace-only to "no date".
  if (!raw || raw.trim() === '') return null

  const s = raw.trim()

  // ISO date: YYYY-MM-DD or YYYY/MM/DD (DOV uses hyphens; GEF may use slashes).
  // We normalise slashes to hyphens before the regex so both variants match.
  const normalised = s.replace(/\//g, '-')
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalised)
  if (isoMatch) {
    // Construct as UTC midnight to avoid timezone drift.
    const y = parseInt(isoMatch[1], 10)
    const m = parseInt(isoMatch[2], 10) - 1 // month is 0-indexed in Date
    const d = parseInt(isoMatch[3], 10)
    const date = new Date(Date.UTC(y, m, d))
    // Guard against out-of-range values (e.g. month 13) that Date would
    // silently roll over rather than reject.
    if (
      date.getUTCFullYear() !== y ||
      date.getUTCMonth() !== m ||
      date.getUTCDate() !== d
    ) {
      return null
    }
    return date
  }

  // Year-only: YYYY → 1 January, best-effort floor for coarse filter/sort.
  // Treat as "this CPT is from some time in year Y" — Jan 1 is the safest
  // floor (never excludes items by having a later-than-real date).
  const yearMatch = /^(\d{4})$/.exec(s)
  if (yearMatch) {
    const y = parseInt(yearMatch[1], 10)
    // Sanity-check: years outside 1800–2100 are almost certainly garbage.
    if (y < 1800 || y > 2100) return null
    return new Date(Date.UTC(y, 0, 1))
  }

  // Anything else is unparseable.
  return null
}

/**
 * True if ``itemDate`` falls within the inclusive ``[fromBound, toBound]``
 * range. Pure — takes raw strings so callers can depend only on stable
 * primitive inputs (no per-render ``Date`` identity leaking into memo
 * dep arrays).
 *
 * Semantics (shared by the CPT and Borehole list filters so the two
 * tabs cannot diverge):
 *   - No bound set (both unparseable/empty) → every item passes (the
 *     filter is inactive; the caller need not special-case it).
 *   - A bound IS set but the item has no parseable date → excluded.
 *     A dateless investigation can't be placed in a range; surfacing it
 *     anyway would be surprising once the user has constrained dates.
 *   - Bounds are inclusive on both ends.
 */
export function isWithinDateRange(
  itemDate: string | null,
  fromBound: string | null,
  toBound: string | null,
): boolean {
  const from = parseInvestigationDate(fromBound)
  const to = parseInvestigationDate(toBound)
  if (from === null && to === null) return true
  const d = parseInvestigationDate(itemDate)
  if (d === null) return false
  if (from !== null && d.getTime() < from.getTime()) return false
  if (to !== null && d.getTime() > to.getTime()) return false
  return true
}
