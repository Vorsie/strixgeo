// Per-card, per-project memory of where the engineer last saved an export
// (installer #35 — the Export hub shows each card's last export path).
//
// This is per-viewer UI chrome, not a project decision, so it lives in
// localStorage (never the .strix bundle — see the localStorage-vs-bundle rule in
// docs/desktop.md). Keyed by project + card so switching projects, or exporting
// a different target, shows the right path. Every access is wrapped: a private
// window or cleared site data can throw or return null, and the card must render
// with no remembered path in that case.

const PREFIX = 'strix.export.lastPath'

/** The localStorage key for one card's last path in one project. */
function keyFor(projectId: string, cardId: string): string {
  return `${PREFIX}.${projectId}.${cardId}`
}

/**
 * Remember where a card's export was just written.
 *
 * Parameters
 * ----------
 * projectId : string
 *     The open project's id.
 * cardId : string
 *     The export card's stable id.
 * path : string
 *     The absolute file path the engineer chose in the save dialog.
 */
export function rememberExportPath(projectId: string, cardId: string, path: string): void {
  try {
    localStorage.setItem(keyFor(projectId, cardId), path)
  } catch {
    // Storage disabled / full — the last-path hint is a convenience, never load-bearing.
  }
}

/**
 * Recall where a card's export was last written, or ``null`` when unknown.
 *
 * Parameters
 * ----------
 * projectId : string
 *     The open project's id.
 * cardId : string
 *     The export card's stable id.
 *
 * Returns
 * -------
 * string | null
 *     The remembered path, or ``null`` when nothing is stored (or storage is
 *     unavailable).
 */
export function recallExportPath(projectId: string, cardId: string): string | null {
  try {
    return localStorage.getItem(keyFor(projectId, cardId))
  } catch {
    return null
  }
}
