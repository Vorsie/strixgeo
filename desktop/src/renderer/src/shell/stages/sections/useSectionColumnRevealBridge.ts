/**
 * Publish the section panel's column reveal onto the shell-facing bridge.
 *
 * Two lines of glue with one rule worth its own file: the request it composes
 * asks for a COLUMN pulse (``flashColumnId``), not an edge flash. A deep-link
 * from the Build pre-flight is about one test the engineer has to subdivide —
 * there is no tie to mark, and marking one would point at the wrong thing.
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
 * Register a "centre this test's column" implementation for the shell.
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
      investigationId: string,
    ): SectionColumnRevealResult => {
      const reveal = revealRef.current
      if (reveal === null) {
        return { revealed: false, missingInvestigationIds: [investigationId] }
      }
      return reveal({
        investigationIds: [investigationId],
        flashColumnId: investigationId,
      })
    }
    return () => {
      sectionsRevealColumnCallback.current = null
    }
  }, [revealRef])
}
