// Supported horizontal CRS for cross-sections (debt #31).
//
// Mirrors the backend's
// infrastructure/codelists/horizontal_crs.py — keep both lists in
// sync when adding a country. A cross-section's along-distance is a
// Euclidean distance in the section's CRS units, so only a projected
// METRIC CRS is valid. A geographic CRS (EPSG:4326 — degrees) would
// silently produce ~1e-4-scale geometry in every export, so section
// creation is gated on this allowlist (with a tooltip naming the CRS)
// rather than only on "a CRS is set".

export const SUPPORTED_SECTION_HORIZONTAL_EPSGS: ReadonlySet<number> = new Set([
  31370, // Belgian Lambert 72
  3812, // ETRS89 / Belgian Lambert 2008
  28992, // Amersfoort / RD New (NL)
  25831, // ETRS89 / UTM zone 31N
  32631, // WGS 84 / UTM zone 31N
])

const HCRS_LABEL_BY_EPSG: Record<number, string> = {
  31370: 'Belgian Lambert 72 (EPSG:31370)',
  3812: 'Belgian Lambert 2008 (EPSG:3812)',
  28992: 'Amersfoort / RD New (EPSG:28992)',
  25831: 'ETRS89 / UTM 31N (EPSG:25831)',
  32631: 'WGS 84 / UTM 31N (EPSG:32631)',
}

/** Whether a section may be created / exported in this horizontal CRS.
 *  `null`/`undefined` (no CRS resolved) is unsupported. */
export function isSupportedSectionCrs(
  epsg: number | null | undefined,
): boolean {
  return epsg != null && SUPPORTED_SECTION_HORIZONTAL_EPSGS.has(epsg)
}

/** Human-readable label for a horizontal EPSG. Honest over wrong:
 *  `"EPSG:<n>"` for an unmapped code, `"no CRS"` when absent. */
export function horizontalCrsLabel(
  epsg: number | null | undefined,
): string {
  if (epsg == null) return 'no CRS'
  return HCRS_LABEL_BY_EPSG[epsg] ?? `EPSG:${epsg}`
}

/**
 * Why section creation is blocked for this CRS, or `null` if it's fine.
 *
 * Single source of truth for the create-gate tooltip so the Sections
 * toolbar and the empty-state CTA stay in lockstep (debt #31). The
 * message names the actual CRS so the engineer knows *what* to fix,
 * not just *that* it's broken.
 */
export function sectionCrsBlockReason(
  epsg: number | null | undefined,
): string | null {
  if (isSupportedSectionCrs(epsg)) return null
  if (epsg == null) {
    return (
      'No horizontal CRS resolved. Set a metric Default horizontal CRS ' +
      '(e.g. Belgian Lambert 72) in Project metadata to create sections.'
    )
  }
  return (
    `${horizontalCrsLabel(epsg)} is not a projected metric CRS. ` +
    'Cross-section geometry needs metres. Set a metric Default ' +
    'horizontal CRS in Project metadata.'
  )
}
