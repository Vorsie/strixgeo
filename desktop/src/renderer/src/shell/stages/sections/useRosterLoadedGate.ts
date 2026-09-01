// The #279 body-menu arming gate — owner ruling 2026-08-31 ("fix it now").
//
// A body recompute rewrites every layer's ``body_id`` stamp, so the body roster
// in hand is stale the instant the recompute nonce bumps. The body menu must
// arm ONLY while the roster is CURRENT for the active model — before that, the
// stats menu is the deliberate answer (not a race).
//
// The gate STAMPS the nonce the roster was loaded at, so ``bodiesLoaded`` goes
// false SYNCHRONOUSLY during the render where the nonce bumps (no effect lag —
// the menu is not armed for even one frame across the recompute window). The
// stamp also makes it robust to overlapping refetches: a stale refetch that
// finishes late marks itself with an old nonce, which no longer matches, so it
// cannot falsely re-arm the menu.

import { useCallback, useState } from 'react'

/** The gate's state + the "roster is now current" signal. */
export interface RosterLoadedGate {
  /** True only when the roster has been marked loaded for the ACTIVE model at the CURRENT nonce. */
  bodiesLoaded: boolean
  /** Call after a successful roster fetch, with the model it loaded — stamps the current nonce. */
  markLoaded: (modelId: string) => void
}

/**
 * Track whether the body roster is current for the active model.
 *
 * Parameters
 * ----------
 * activeModelId : string | null
 *     The litho model whose roster gates the menu; ``null`` off the litho axis
 *     (never loaded → menu withheld, which is correct there).
 * recomputeNonce : number
 *     Bumped by every body recompute. A change makes the last stamp stale, so
 *     ``bodiesLoaded`` is false until ``markLoaded`` re-stamps the fresh roster.
 *
 * Returns
 * -------
 * RosterLoadedGate
 *     ``bodiesLoaded`` for the menu gate + ``markLoaded`` to call post-fetch.
 */
export function useRosterLoadedGate(
  activeModelId: string | null,
  recomputeNonce: number,
): RosterLoadedGate {
  const [loaded, setLoaded] = useState<{ modelId: string; nonce: number } | null>(null)

  const markLoaded = useCallback(
    (modelId: string) => setLoaded({ modelId, nonce: recomputeNonce }),
    [recomputeNonce],
  )

  // Current only when the stamp names the active model AND the live nonce — a
  // roster loaded before the last recompute, or for a model the axis has since
  // left, is stale. Computed during render, so a nonce bump drops it at once.
  const bodiesLoaded =
    activeModelId !== null &&
    loaded !== null &&
    loaded.modelId === activeModelId &&
    loaded.nonce === recomputeNonce

  return { bodiesLoaded, markLoaded }
}
