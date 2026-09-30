// A tiny app-wide "lab-series data changed" signal.
//
// The import flow (Data toolbar) and the borehole detail's Lab tests list live
// in different subtrees; routing a nonce through the ShellContext bus for one
// reader is heavier than the problem. The writer calls
// ``notifyLabSeriesChanged()`` after an import; every mounted list re-reads.

import { useEffect, useState } from 'react'

const listeners = new Set<() => void>()

/** Tell every mounted lab-series list that stored tests changed. */
export function notifyLabSeriesChanged(): void {
  for (const listener of [...listeners]) listener()
}

/**
 * A number that grows every time lab-series data changes.
 *
 * @returns The current revision (use it as an effect dependency).
 */
export function useLabSeriesRevision(): number {
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const bump = (): void => setRevision(r => r + 1)
    listeners.add(bump)
    return () => {
      listeners.delete(bump)
    }
  }, [])
  return revision
}
