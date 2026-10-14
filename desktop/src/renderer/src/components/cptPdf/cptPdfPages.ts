// Page numbers of a PDF report as the CPT import dialog names them.

/**
 * "231" or "231–232" for a run of pages (first to last).
 *
 * @param pages - 1-based page numbers in print order.
 * @returns The span, or an empty string for no pages.
 */
export function pageSpan(pages: readonly number[]): string {
  if (pages.length === 0) return ''
  const first = pages[0]
  const last = pages[pages.length - 1]
  return first === last ? `${first}` : `${first}–${last}`
}

/**
 * The table pages of a printed-table sounding: its pages that are not one of
 * its graph sheets (owner 2026-10-14: only a graph sheet has axes to set).
 *
 * @param pages - Every page of the sounding.
 * @param graphPages - Its graph sheets.
 * @returns The other pages, in print order.
 */
export function tableSheetPages(pages: readonly number[], graphPages: readonly number[]): number[] {
  const graph = new Set(graphPages)
  return pages.filter(p => !graph.has(p))
}
