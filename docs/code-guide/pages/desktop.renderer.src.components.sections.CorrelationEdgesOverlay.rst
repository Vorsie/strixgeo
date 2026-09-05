desktop.renderer.src.components.sections.CorrelationEdgesOverlay
================================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-52

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx
   :language: tsx
   :lines: 1-52
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the large file for the overlay that draws litho correlation edges — the ties an engineer draws linking one column's contact to the next — on a cross-section. The documentation lists its jobs: a per-band body chip, a hover halo across a whole body, a chip right-click menu, the point-to-point tie lines themselves, and the click hit-targets used while correlating. The imports pull in React hooks, the data types, the ghost admixture editor, and geometry and review-flag helpers.

**Why it is here.** A correlation tie is the engineer's explicit statement that two contacts are the same surface; the fill follows these drawn ties, so this overlay is where they are created, shown, accepted, and deleted. Hover state is kept local because no other component needs it; the sticky inspector-select reveal is deferred to a later debt item.

.. CG-EXPLANATION-END id=module-header

``const CONTACT_EDGE_WIDTH``
----------------------------

.. CG-BLOCK id=const:CONTACT_EDGE_WIDTH lines=53-56

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx
   :language: tsx
   :lines: 53-56
   :lineno-match:

.. CG-EXPLANATION-START id=const:CONTACT_EDGE_WIDTH

**What this does.** A constant — the stroke width of a contact-level tie line.

**Why it is here.** It is slightly thicker than a body edge so the two overlay kinds read distinctly when both are present.

.. CG-EXPLANATION-END id=const:CONTACT_EDGE_WIDTH

``const UNAPPROVED_EDGE_COLOR``
-------------------------------

.. CG-BLOCK id=const:UNAPPROVED_EDGE_COLOR lines=57-58

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx
   :language: tsx
   :lines: 57-58
   :lineno-match:

.. CG-EXPLANATION-START id=const:UNAPPROVED_EDGE_COLOR

**What this does.** A constant — the colour of a pending (not-yet-accepted) tie, amber.

**Why it is here.** It is distinct from the solid emerald of an approved tie so the engineer can see at a glance which ties still need accepting.

.. CG-EXPLANATION-END id=const:UNAPPROVED_EDGE_COLOR

``const UNAPPROVED_EDGE_DASH``
------------------------------

.. CG-BLOCK id=const:UNAPPROVED_EDGE_DASH lines=59-66

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx
   :language: tsx
   :lines: 59-66
   :lineno-match:

.. CG-EXPLANATION-START id=const:UNAPPROVED_EDGE_DASH

**What this does.** A constant — the dash pattern for a pending tie.

**Why it is here.** Dashing signals the provisional, not-yet-accepted state.

.. CG-EXPLANATION-END id=const:UNAPPROVED_EDGE_DASH

``const BASE_TIE_COLOR``
------------------------

.. CG-BLOCK id=const:BASE_TIE_COLOR lines=67-69

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx
   :language: tsx
   :lines: 67-69
   :lineno-match:

.. CG-EXPLANATION-START id=const:BASE_TIE_COLOR

**What this does.** A constant — the colour of an interpretive base-side or mixed top-to-base tie, cyan.

**Why it is here.** It is visually distinct from the solid emerald top-to-top seam so the geologist reads 'interpretive continuation' versus 'observed surface correlation' at a glance (spec section 6).

.. CG-EXPLANATION-END id=const:BASE_TIE_COLOR

``const BASE_TIE_DASH``
-----------------------

.. CG-BLOCK id=const:BASE_TIE_DASH lines=70-76

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx
   :language: tsx
   :lines: 70-76
   :lineno-match:

.. CG-EXPLANATION-START id=const:BASE_TIE_DASH

**What this does.** A constant — the dash pattern for an interpretive tie.

**Why it is here.** It distinguishes the interpretive tie from a solid top-to-top ribbon (spec section 6).

.. CG-EXPLANATION-END id=const:BASE_TIE_DASH

``const RIBBON_HALF_HEIGHT_PX``
-------------------------------

.. CG-BLOCK id=const:RIBBON_HALF_HEIGHT_PX lines=77-82

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx
   :language: tsx
   :lines: 77-82
   :lineno-match:

.. CG-EXPLANATION-START id=const:RIBBON_HALF_HEIGHT_PX

**What this does.** A constant — half the height, in pixels, of the seam ribbon drawn above and below a tie line.

**Why it is here.** It is fixed regardless of zoom so the ribbon reads consistently, and kept slim (halved twice on dogfeed) so stacked correlations do not occlude each other or fight the soil stripes for visual weight.

.. CG-EXPLANATION-END id=const:RIBBON_HALF_HEIGHT_PX

``const RIBBON_STRIPES_ENABLED``
--------------------------------

.. CG-BLOCK id=const:RIBBON_STRIPES_ENABLED lines=83-90

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx
   :language: tsx
   :lines: 83-90
   :lineno-match:

.. CG-EXPLANATION-START id=const:RIBBON_STRIPES_ENABLED

**What this does.** A constant on/off switch, set off, for the soil-coloured stripes along a tie ribbon.

**Why it is here.** The stripes were drawn along the raw tie line, which does not follow the fill's band edges, so a stripe bled a different soil colour over the partition fill (owner dogfeed 2026-07-10, proven with an overlap log). They are disabled; the tie stays visible through the seam line instead.

.. CG-EXPLANATION-END id=const:RIBBON_STRIPES_ENABLED

``const RIBBON_MIN_WIDTH_PX``
-----------------------------

.. CG-BLOCK id=const:RIBBON_MIN_WIDTH_PX lines=91-92

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx
   :language: tsx
   :lines: 91-92
   :lineno-match:

.. CG-EXPLANATION-START id=const:RIBBON_MIN_WIDTH_PX

**What this does.** A constant — the smallest on-screen width a tie ribbon is allowed to shrink to.

**Why it is here.** Closely-spaced columns leave only a few-pixel gap between their inner edges, and zooming cannot widen it because the gap is a fixed-pixel constant; below this width the ribbon is expanded about its midpoint so it stays visible and grabbable (dogfeed 2026-06-04).

.. CG-EXPLANATION-END id=const:RIBBON_MIN_WIDTH_PX

``const RIBBON_APPROVED_OPACITY``
---------------------------------

.. CG-BLOCK id=const:RIBBON_APPROVED_OPACITY lines=93-95

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx
   :language: tsx
   :lines: 93-95
   :lineno-match:

.. CG-EXPLANATION-START id=const:RIBBON_APPROVED_OPACITY

**What this does.** A constant — the fill opacity of an approved correlation ribbon.

**Why it is here.** An accepted tie reads at near-full strength.

.. CG-EXPLANATION-END id=const:RIBBON_APPROVED_OPACITY

``const RIBBON_PENDING_OPACITY``
--------------------------------

.. CG-BLOCK id=const:RIBBON_PENDING_OPACITY lines=96-98

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx
   :language: tsx
   :lines: 96-98
   :lineno-match:

.. CG-EXPLANATION-START id=const:RIBBON_PENDING_OPACITY

**What this does.** A constant — the fill opacity of a pending correlation ribbon, faded.

**Why it is here.** A section full of auto-proposed ties stays readable when the un-accepted ones are faded.

.. CG-EXPLANATION-END id=const:RIBBON_PENDING_OPACITY

``const RIBBON_SEAM_COLOR``
---------------------------

.. CG-BLOCK id=const:RIBBON_SEAM_COLOR lines=99-101

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx
   :language: tsx
   :lines: 99-101
   :lineno-match:

.. CG-EXPLANATION-START id=const:RIBBON_SEAM_COLOR

**What this does.** A constant — the near-black colour of the seam line through an approved ribbon.

**Why it is here.** It matches the litho contact line colour so the boundary reads against the soil fills.

.. CG-EXPLANATION-END id=const:RIBBON_SEAM_COLOR

``const CONTACT_HIT_HEIGHT``
----------------------------

.. CG-BLOCK id=const:CONTACT_HIT_HEIGHT lines=102-103

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx
   :language: tsx
   :lines: 102-103
   :lineno-match:

.. CG-EXPLANATION-START id=const:CONTACT_HIT_HEIGHT

**What this does.** A constant — the clickable height around each contact top line while correlate mode is active.

**Why it is here.** It gives the boundary a comfortable target to click when arming a correlation.

.. CG-EXPLANATION-END id=const:CONTACT_HIT_HEIGHT

``const CONTACT_ARM_COLOR``
---------------------------

.. CG-BLOCK id=const:CONTACT_ARM_COLOR lines=104-106

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx
   :language: tsx
   :lines: 104-106
   :lineno-match:

.. CG-EXPLANATION-START id=const:CONTACT_ARM_COLOR

**What this does.** A constant — the colour of an armed contact boundary line, emerald.

**Why it is here.** It marks the source boundary the engineer has armed and is about to correlate from.

.. CG-EXPLANATION-END id=const:CONTACT_ARM_COLOR

``const LENS_CANDIDATE_COLOR``
------------------------------

.. CG-BLOCK id=const:LENS_CANDIDATE_COLOR lines=107-114

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx
   :language: tsx
   :lines: 107-114
   :lineno-match:

.. CG-EXPLANATION-START id=const:LENS_CANDIDATE_COLOR

**What this does.** A constant — the amber colour of a lens-candidate marker.

**Why it is here.** It marks an enclosed contact that correlates to neither neighbour — a layer that pinches out rather than continues.

.. CG-EXPLANATION-END id=const:LENS_CANDIDATE_COLOR

``const EDGE_HIT_STROKE_WIDTH``
-------------------------------

.. CG-BLOCK id=const:EDGE_HIT_STROKE_WIDTH lines=115-119

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx
   :language: tsx
   :lines: 115-119
   :lineno-match:

.. CG-EXPLANATION-START id=const:EDGE_HIT_STROKE_WIDTH

**What this does.** A constant — the minimum half-height of the invisible right-click hit band over each tie.

**Why it is here.** It keeps the right-click target usable when the ribbon has no soil stripes and would otherwise collapse to a zero-height seam (#163e).

.. CG-EXPLANATION-END id=const:EDGE_HIT_STROKE_WIDTH

``const EDGE_DRAG_HIT_WIDTH``
-----------------------------

.. CG-BLOCK id=const:EDGE_DRAG_HIT_WIDTH lines=120-124

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx
   :language: tsx
   :lines: 120-124
   :lineno-match:

.. CG-EXPLANATION-START id=const:EDGE_DRAG_HIT_WIDTH

**What this does.** A constant — the stroke width of each grabbable half-seam drag zone.

**Why it is here.** It is wider than the visible seam so the tie is an easy drag target, but kept modest so it does not blanket the bands above and below; the seam is split at its midpoint so each half drags its nearer end (#31).

.. CG-EXPLANATION-END id=const:EDGE_DRAG_HIT_WIDTH

``const EDGE_HIT_END_INSET``
----------------------------

.. CG-BLOCK id=const:EDGE_HIT_END_INSET lines=125-136

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx
   :language: tsx
   :lines: 125-136
   :lineno-match:

.. CG-EXPLANATION-START id=const:EDGE_HIT_END_INSET

**What this does.** A constant — a small horizontal inset at each end of the tie's right-click hit band.

**Why it is here.** It lets a left-drag of the committed contact at either column end still win over the tie band (dogfeed 2026-05-29).

.. CG-EXPLANATION-END id=const:EDGE_HIT_END_INSET

``interface ContactGestureState``
---------------------------------

.. CG-BLOCK id=interface:ContactGestureState lines=137-187

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx
   :language: tsx
   :lines: 137-187
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ContactGestureState

**What this does.** The shape of the correlate gesture's state: whether boundary-click mode is on, the armed source contact and which side of it (top or base), the last successful target investigation, and the callbacks to arm, clear, correlate, and request a delete.

**Why it is here.** It is a small state machine — idle, then armed, then fire the correlation, then idle. The side is tracked because a tie can join top-to-top, base-to-base, or top-to-base, and the API needs to know which. The last target drives the lens pinch-out gesture (debt #135): a second click in the same target investigation fires a second correlation from the still-armed source instead of clearing.

.. CG-EXPLANATION-END id=interface:ContactGestureState

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=188-398

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx
   :language: tsx
   :lines: 188-398
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** The inputs to the overlay: the section's contacts and formations, the placed columns and coordinate converters, the plot bounds, the pinch-out candidates, the pulse and flash cues, the contact-level tie list and the gesture state, the drag-to-retarget callbacks and live drag state, the accept/delete/confirm callbacks and their wording, and the set of ties currently in a crossing conflict.

**Why it is here.** The pulse and flash cues give the engineer a visual 'your correlation succeeded' and 'here is the tie I centred' signal (dogfeed 2026-05-23, owner ask 2026-08-25). The crossing-conflict set arrives from the fill engine via the partition overlay rather than being re-derived here, because only the engine knows which two ties cross and suspend each other — re-deriving it would let the mark disagree with the chip that counts the same conflicts, the one failure this feature cannot have (owner ruling 2026-08-26).

.. CG-EXPLANATION-END id=interface:Props

``function CorrelationEdgesOverlay``
------------------------------------

.. CG-BLOCK id=function:CorrelationEdgesOverlay lines=399-1666

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx
   :language: tsx
   :lines: 399-1666
   :lineno-match:

.. CG-EXPLANATION-START id=function:CorrelationEdgesOverlay

**What this does.** The whole overlay component — a large render plus gesture handling. It maps contacts to on-screen band positions, draws each correlation tie as a ribbon or line (approved solid emerald, pending amber dashed, interpretive cyan), draws the body ordinal chips with their hover halos, renders the click hit-targets while correlate mode is active, shows the drag-to-retarget ghost line, marks crossing-conflict and rebuild-flagged ties, and opens the body and edge right-click menus.

**Why it is here.** Every tie position uses the warp-aware transform because column spacing is stretched. The tie's appearance encodes its state (approved, pending, interpretive, flagged, conflicting) so the engineer reads the correlation model at a glance. Crossing ties are marked but neither is silently chosen the winner — the owner ruled a crossing is a hard conflict that suspends both until one is deleted (partition-engine section 8, Q4). The chip and halo make same-body membership visible before the lines animate in.

.. CG-EXPLANATION-END id=function:CorrelationEdgesOverlay

