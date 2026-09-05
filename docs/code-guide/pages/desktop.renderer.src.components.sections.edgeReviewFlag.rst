desktop.renderer.src.components.sections.edgeReviewFlag
=======================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/edgeReviewFlag.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/edgeReviewFlag.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-26

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/edgeReviewFlag.tsx
   :language: tsx
   :lines: 1-26
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file. The ``.tsx`` extension marks a file that mixes TypeScript with JSX, the markup React uses to describe screen elements. This module presents a correlation edge that is awaiting the engineer's confirmation. It imports React and the correlation-edge type.

**Why it is here.** The docstring records the situation: a re-subdivide can leave an accepted geotech tie attached to a band that is no longer obviously the one it was drawn on, and such ties are carried and stamped with a review reason rather than deleted, because an accepted edge never disappears without the user deleting it. Two styling rules follow — not amber (amber already means auto-proposed and pending) and not colour alone (WCAG 2.2 AA and the no-info-by-colour-alone rule) — and the file lives beside the overlay because that overlay is past 1400 lines and under the god-component watch (debt #201).

.. CG-EXPLANATION-END id=module-header

``const REVIEW_FLAG_COLOR``
---------------------------

.. CG-BLOCK id=const:REVIEW_FLAG_COLOR lines=27-29

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/edgeReviewFlag.tsx
   :language: tsx
   :lines: 27-29
   :lineno-match:

.. CG-EXPLANATION-START id=const:REVIEW_FLAG_COLOR

**What this does.** The review-flag colour, violet.

**Why it is here.** The comment records it is distinct from approved emerald, pending amber and base-tie cyan.

.. CG-EXPLANATION-END id=const:REVIEW_FLAG_COLOR

``const REVIEW_FLAG_DASH``
--------------------------

.. CG-BLOCK id=const:REVIEW_FLAG_DASH lines=30-32

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/edgeReviewFlag.tsx
   :language: tsx
   :lines: 30-32
   :lineno-match:

.. CG-EXPLANATION-START id=const:REVIEW_FLAG_DASH

**What this does.** The review-flag dash pattern — a long dash and a short gap.

**Why it is here.** The comment records it is readable at section zoom without reading as 'pending' (which uses a different dash).

.. CG-EXPLANATION-END id=const:REVIEW_FLAG_DASH

``const BADGE_RADIUS``
----------------------

.. CG-BLOCK id=const:BADGE_RADIUS lines=33-35

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/edgeReviewFlag.tsx
   :language: tsx
   :lines: 33-35
   :lineno-match:

.. CG-EXPLANATION-START id=const:BADGE_RADIUS

**What this does.** The radius of the badge disc, 6.5 screen pixels.

**Why it is here.** Why: not recorded — ask the owner

.. CG-EXPLANATION-END id=const:BADGE_RADIUS

``function isFlaggedForReview``
-------------------------------

.. CG-BLOCK id=function:isFlaggedForReview lines=36-45

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/edgeReviewFlag.tsx
   :language: tsx
   :lines: 36-45
   :lineno-match:

.. CG-EXPLANATION-START id=function:isFlaggedForReview

**What this does.** Answers whether an edge has a review reason set, meaning it needs the engineer to confirm it.

**Why it is here.** A one-line predicate the overlay uses to decide whether to draw the badge.

.. CG-EXPLANATION-END id=function:isFlaggedForReview

``function reviewFlagLabel``
----------------------------

.. CG-BLOCK id=function:reviewFlagLabel lines=46-67

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/edgeReviewFlag.tsx
   :language: tsx
   :lines: 46-67
   :lineno-match:

.. CG-EXPLANATION-START id=function:reviewFlagLabel

**What this does.** Turns a review-reason token into a human sentence — separate wording for class-changed, ambiguous-band, band-absorbed and frame-mismatch, with a default for anything else.

**Why it is here.** The docstring records that the raw token 'class_changed' on its own does not tell the engineer whether to keep the tie, so each case says what happened and what is being asked; the comments cite the owner's wording of 2026-08-10 for the absorbed case and the owner order of 2026-08-21 for the frame-mismatch case.

.. CG-EXPLANATION-END id=function:reviewFlagLabel

``interface EdgeReviewBadgeProps``
----------------------------------

.. CG-BLOCK id=interface:EdgeReviewBadgeProps lines=68-85

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/edgeReviewFlag.tsx
   :language: tsx
   :lines: 68-85
   :lineno-match:

.. CG-EXPLANATION-START id=interface:EdgeReviewBadgeProps

**What this does.** Describes the inputs the badge component takes — the flagged edge, its centre X and Y in screen pixels, and an optional right-click handler. Props are the inputs a React component is given.

**Why it is here.** The comment records the edge's id keys the test id, and the right-click handler opens the same edge menu the tie itself opens.

.. CG-EXPLANATION-END id=interface:EdgeReviewBadgeProps

``function EdgeReviewBadge``
----------------------------

.. CG-BLOCK id=function:EdgeReviewBadge lines=86-122

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/edgeReviewFlag.tsx
   :language: tsx
   :lines: 86-122
   :lineno-match:

.. CG-EXPLANATION-START id=function:EdgeReviewBadge

**What this does.** A React component — a function that returns a piece of screen — that draws a small violet disc with a bold '!' marking a tie awaiting confirmation. It renders an SVG group with a title tooltip, a circle, and the '!' glyph, and becomes interactive on right-click when a handler is supplied.

**Why it is here.** The docstring records it is interactive on right-click so the badge is a target in its own right — a flagged tie can be thin or hidden under a ribbon, and hunting for a sub-two-pixel line to resolve a warning is the kind of friction that makes people ignore warnings.

.. CG-EXPLANATION-END id=function:EdgeReviewBadge

