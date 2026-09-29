/**
 * Borehole-tracks revision — a tiny module store the section view listens to.
 *
 * The section view fetches its own borehole details (``useSectionData``, one
 * batch per section open) and never reads the Data stage's detail cache, so a
 * track saved in the borehole's Tracks panel would not reach an open or cached
 * section. Every successful track save / delete / undo bumps this revision;
 * ``useSectionData`` lists it in its borehole-detail effect so the columns
 * refetch and the section redraws with the new track.
 *
 * A module store (not React state threaded through the shell) because the
 * writer (the Data stage) and the reader (the Sections stage) share no
 * component ancestor below the shell, and the signal carries no data.
 */
import { useSyncExternalStore } from 'react'

let revision = 0
const listeners = new Set<() => void>()

/** Current revision (monotonic, starts at 0). */
export function getBoreholeTracksRevision(): number {
  return revision
}

/** Announce that some borehole's tracks changed on the server. */
export function bumpBoreholeTracksRevision(): void {
  revision += 1
  for (const listener of listeners) listener()
}

/**
 * Subscribe to revision bumps (``useSyncExternalStore`` shape).
 *
 * @param listener - Called after every bump.
 * @returns The unsubscribe function.
 */
export function subscribeBoreholeTracksRevision(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** React hook: the current revision, re-rendering on every bump. */
export function useBoreholeTracksRevision(): number {
  return useSyncExternalStore(subscribeBoreholeTracksRevision, getBoreholeTracksRevision)
}
