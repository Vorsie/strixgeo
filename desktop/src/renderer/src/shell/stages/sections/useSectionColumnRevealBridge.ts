/**
 * Publish the section panel's column reveal onto the shell-facing bridge.
 *
 * A few lines of glue with one rule worth its own file: WHAT gets marked
 * follows from HOW MANY columns were named, and nothing else.
 *
 * * ONE column — the Build pre-flight's deep-link — is about a test the
 *   engineer has to subdivide, so the column itself gets the pulse
 *   (``flashColumnId``). Never an edge flash: there is no tie to mark, and
 *   marking one would point at the wrong thing.
 * * TWO columns — the gapless build report's "Show me" — name a GAP, and the
 *   finding is the ground BETWEEN them. ``resolveColumnReveal`` centres on the
 *   midpoint of their span, which is that ground; pulsing either end would
 *   claim the defect is on a column when it is not.
 *
 * Lives outside ``SectionsCanvas``, which is long past the 500-line
 * god-component threshold (debt #201), and outside
 * ``useGeotechPendingTieReveal``, which answers a different question (which of
 * N pending ties comes next).
 */
import { useEffect, type MutableRefObject } from 'react'

import type {
  SectionColumnRevealFn,
  SectionColumnRevealResult,
} from '../../../components/sections/sectionColumnReveal'
import { sectionsRevealColumnCallback } from './sectionColumnRevealBridge'

/**
 * Register a "bring these columns on screen" implementation for the shell.
 *
 * Parameters
 * ----------
 * revealRef : MutableRefObject<SectionColumnRevealFn | null>
 *     The slot ``SectionPanel`` publishes its own reveal into. ``null`` while
 *     no panel is mounted, in which case the bridge answers "not revealed"
 *     rather than throwing at a caller that asked a beat too early.
 */
export function useSectionColumnRevealBridge(
  revealRef: MutableRefObject<SectionColumnRevealFn | null>,
): void {
  useEffect(() => {
    sectionsRevealColumnCallback.current = (
      investigationIds: readonly string[],
    ): SectionColumnRevealResult => {
      const reveal = revealRef.current
      if (reveal === null) {
        return { revealed: false, missingInvestigationIds: [...investigationIds] }
      }
      return reveal({
        investigationIds,
        // One column is a test to mark; two are a gap, and the gap is between
        // them — see this module's own doc for why the second case marks
        // nothing.
        ...(investigationIds.length === 1 && { flashColumnId: investigationIds[0] }),
      })
    }
    return () => {
      sectionsRevealColumnCallback.current = null
    }
  }, [revealRef])
}
