/**
 * Keyboard-event helpers shared across components that listen for
 * global shortcuts (Esc / arrows / Delete / Ctrl-modifier combos).
 *
 * Currently exports ``isTypingTarget`` only — extracted after a third
 * copy landed in BoreholeLog / Sidebar / LabTestPanel (CLAUDE.md
 * "extract on the third copy" rule). When more keyboard helpers
 * accumulate (e.g. a ``useGlobalShortcut`` hook, modifier-key
 * normalisation between Mac and Windows), they belong here.
 */

/**
 * True when ``target`` is a typing surface — used by global keyboard
 * shortcuts to bow out gracefully when the user is actually editing
 * text. Pressing arrow keys inside a text field should move the
 * caret, not the sample-nav cursor; the same rule applies to Delete
 * (delete a character, not bulk-remove a list selection).
 *
 * Returns true for ``<input>`` / ``<textarea>`` / ``<select>`` / any
 * element with ``contentEditable`` set. Defensive against
 * ``EventTarget`` instances that aren't HTMLElements (Document,
 * Window) — those fall through to false.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return target.isContentEditable
}
