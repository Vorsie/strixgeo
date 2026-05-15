// Small Set<string> helpers used with React state setters that hold
// localStorage-backed sets (``usePersistedSet``). Promoted out of
// inline duplications per the "extract on the second copy" rule —
// the ``addAllToSet`` shape appears 5+ times across App.tsx import
// handlers and the discard-rollback path.

import type { Dispatch, SetStateAction } from 'react'

// Functional setter that adds ids to an existing Set without mutating
// it. Returns ``prev`` unchanged when there's nothing new to add so
// React skips a re-render in the no-op case.
export function addAllToSet(
  setter: Dispatch<SetStateAction<Set<string>>>,
  ids: Iterable<string>,
): void {
  setter(prev => {
    let next: Set<string> | null = null
    for (const id of ids) {
      if (!prev.has(id)) {
        if (next === null) next = new Set(prev)
        next.add(id)
      }
    }
    return next ?? prev
  })
}

// Functional dual of ``addAllToSet`` — removes ids from an existing Set
// without mutating it, and returns ``prev`` unchanged when nothing was
// present (so React skips the no-op re-render). Used by the
// ``removeFromSessionImports`` bridge so deleting a created-but-unsaved
// formation/contact clears its dirty signal — the inverse of the
// add-on-create path.
export function removeAllFromSet(
  setter: Dispatch<SetStateAction<Set<string>>>,
  ids: Iterable<string>,
): void {
  setter(prev => {
    let next: Set<string> | null = null
    for (const id of ids) {
      if (prev.has(id)) {
        if (next === null) next = new Set(prev)
        next.delete(id)
      }
    }
    return next ?? prev
  })
}
