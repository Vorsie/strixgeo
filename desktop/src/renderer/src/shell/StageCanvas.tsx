// Center canvas zone — flex-fill area between StageSpine and Inspector.
//
// Renders the active stage's ``CanvasComponent`` and owns the
// ``SectionScrubBar`` bottom slot.  The ScrubBar slot is scaffolded but
// empty in S3; it is wired to the Sections stage in S5 when the full
// SectionPanel migrates.
//
// Stage canvas switches trigger a subtle opacity cross-fade (150 ms,
// ease-out) under ``motion-safe:``. React's unmount/mount cycle handles
// the component swap; the opacity animation is applied to the outer
// wrapper so all stage canvases fade uniformly.
//
// Semantic tokens only on the shell chrome. Stage canvas components
// themselves use their own existing classes.

import { useRef } from 'react'
import type { StageId } from './StageDescriptor'
import { STAGE_REGISTRY } from './StageRegistry'

export interface StageCanvasProps {
  /** Currently active stage id. */
  activeStageId: StageId
}

/**
 * Center canvas zone of the workflow-spine shell.
 *
 * Takes all remaining horizontal space (``flex-1``, ``overflow-hidden``)
 * in the body row.  The active stage's ``CanvasComponent`` fills the area.
 * A reserved ``SectionScrubBar`` slot at the bottom is scaffolded as an
 * empty ``<div>`` in S3 — it gains content when SectionPanel migrates in S5.
 *
 * The ``key`` on the canvas wrapper causes React to unmount the previous
 * stage and mount the new one cleanly on every stage switch, preventing
 * stale state from leaking between stages.
 *
 * Parameters
 * ----------
 * activeStageId
 *     The stage whose ``CanvasComponent`` should fill the center.
 *
 * Returns
 * -------
 * JSX.Element
 *     The canvas zone element.
 */
export default function StageCanvas({ activeStageId }: StageCanvasProps): JSX.Element {
  // Track previous stage id to drive the opacity-fade class. When the
  // active stage changes, the wrapper fades from 0 → 1 so the transition
  // is visible on the incoming canvas (outgoing is already unmounted by
  // the React key change).
  const prevStageRef = useRef<StageId>(activeStageId)
  const stageChanged = prevStageRef.current !== activeStageId
  if (stageChanged) prevStageRef.current = activeStageId

  const descriptor = STAGE_REGISTRY.get(activeStageId)
  const CanvasComponent = descriptor?.CanvasComponent ?? null

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-surface-app">
      {/* Main canvas — flex-1 so it fills above any scrub bar. The key
          forces a fresh mount on every stage switch, preventing cross-
          stage state leakage. */}
      <div
        key={activeStageId}
        className={[
          'flex-1 overflow-hidden',
          // Opacity cross-fade on stage change (150 ms ease-out, reduced-
          // motion safe). The animation runs only on the incoming canvas
          // (we key the div so React unmounts the outgoing stage).
          stageChanged
            ? 'motion-safe:animate-[fadeIn_150ms_ease-out]'
            : '',
        ].join(' ')}
      >
        {CanvasComponent !== null && <CanvasComponent />}
      </div>

      {/* SectionScrubBar slot — empty in S3; SectionPanel wires it in S5. */}
      <div id="section-scrub-bar-slot" />
    </div>
  )
}
