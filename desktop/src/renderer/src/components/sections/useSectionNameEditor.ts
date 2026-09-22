// One inline name editor for a cross-section, shared by every place the name
// is shown: the section header strip, the inspector's section list row and the
// inspector's properties block (owner 2026-09-22: "I want to be able to change
// it there too").
//
// The rule that made this a hook rather than three copies: the editor opens
// with the name the engineer SEES. The stored ``section.name`` is the English
// canonical default ("Cross-section 1"), translated only on display
// (``sectionDisplayName`` → "Dwarsprofiel 1"); seeding the draft from the raw
// name showed the English text the moment the field opened ("it changes back
// to English when I click it"). Leaving the field unchanged (equal to the
// displayed name or to the stored one) saves nothing, so an untouched default
// keeps translating.
import { useEffect, useRef, useState } from 'react'
import type React from 'react'

export interface SectionNameEditor {
  /** Whether the text field is open. */
  editing: boolean
  /** The text in the field. */
  draft: string
  setDraft: (next: string) => void
  /** Open the field, seeded with the displayed name. No-op without a rename handler. */
  start: () => void
  /** Close the field; rename when the trimmed text is new and not blank. */
  commit: () => void
  /** Close the field and drop the edit. */
  cancel: () => void
  /** Enter commits (via blur), Escape cancels. */
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  inputRef: React.RefObject<HTMLInputElement>
  /** False when no rename handler was given — the name is then plain text. */
  canEdit: boolean
}

/**
 * Inline-edit state for a section name.
 *
 * @param section - The section (only ``id`` and ``name`` are read).
 * @param displayName - The name as shown to the user (``sectionDisplayName``).
 * @param onRename - Receives the new trimmed name; ``undefined`` disables editing.
 * @returns The editor state and handlers for the field and its trigger.
 */
export function useSectionNameEditor(
  section: { id: string; name: string },
  displayName: string,
  onRename: ((name: string) => void) | undefined,
): SectionNameEditor {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(displayName)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setEditing(false)
    setDraft(displayName)
    // reason: reset ONLY when the section identity changes (switching
    // sections), never on a server echo of the same id with a patched name —
    // that would clobber an edit in progress. ``start`` re-seeds the draft
    // from the displayed name every time the field opens, so it cannot go
    // stale across a rename round-trip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section.id])

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  function start(): void {
    if (!onRename) return
    setDraft(displayName)
    setEditing(true)
  }

  function cancel(): void {
    setDraft(displayName)
    setEditing(false)
  }

  function commit(): void {
    const trimmed = draft.trim()
    setEditing(false)
    // Blank keeps the old name (docs/ux.md: no blank names); unchanged saves
    // nothing, so a translated default stays a default.
    if (trimmed === '' || trimmed === displayName || trimmed === section.name) {
      setDraft(displayName)
      return
    }
    setDraft(trimmed)
    onRename?.(trimmed)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') {
      e.currentTarget.blur()
    } else if (e.key === 'Escape') {
      cancel()
    }
  }

  return {
    editing,
    draft,
    setDraft,
    start,
    commit,
    cancel,
    onKeyDown,
    inputRef,
    canEdit: onRename !== undefined,
  }
}
