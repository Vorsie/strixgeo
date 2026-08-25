/**
 * Module-ref bridge from the Sections TOOLBAR to the Sections CANVAS.
 *
 * ``SectionsToolbar`` and ``SectionsCanvas`` are sibling zone components of the
 * stage shell: they share the ShellContext bus and nothing else. The pending-tie
 * chip lives in the toolbar; every input a press needs — the geotech packing
 * edges, the placed columns, the pan — lives under the canvas. Same shape, and
 * the same solution, as ``sectionsDividePartitionCallback`` in
 * ``hooks/useProjectBodyRecompute.ts``, which the "4 · Divide boreholes" verb
 * already reaches the canvas through.
 *
 * ``null`` whenever the canvas is not mounted; the chip stays PASSIVE in that
 * state rather than advertising an affordance nothing can honour.
 *
 * @module shell/stages/sections/pendingTieRevealBridge
 */

import type { PendingTieRevealOutcome } from './useGeotechPendingTieReveal'

/**
 * Centre and highlight the next pending packing tie on the open section.
 *
 * Registered by ``useGeotechPendingTieReveal`` under ``SectionsCanvas``; called
 * by the toolbar's pending chip, which turns the outcome into a toast.
 */
export const sectionsRevealPendingTieCallback: {
  current: (() => PendingTieRevealOutcome) | null
} = {
  current: null,
}
