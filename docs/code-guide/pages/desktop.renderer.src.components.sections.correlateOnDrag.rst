desktop.renderer.src.components.sections.correlateOnDrag
========================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/correlateOnDrag.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/correlateOnDrag.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-39

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/correlateOnDrag.ts
   :language: typescript
   :lines: 1-39
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and its job: it is the bridge between the app and the fill engine for the gesture where dragging an un-correlated boundary between two soil bands both correlates it and bends it to the cursor in one motion. It is a pure module — no React, no clock, no randomness — and it imports the correlation-edge type, the interior-pinch fraction constant, and the partition column and unit types from the shared partition code.

**Why it is here.** The docstring records the proofs behind it. An un-correlated two-band boundary draws as a pinch/wedge, because under the owner's 2/1/0 rule zero ties means a lens. A correlation, or tie, is a line the engineer draws joining one column's contact to the next; the engine only bends a shared contact when an active tie sits on it. So an untied override does nothing. The fix, owner-decided 2026-07-24, is to create a real tie on the grabbed boundary first — which snaps the wedge to a flat band, a snap the owner accepts — and then bend the now-tied contact through the cursor.

.. CG-EXPLANATION-END id=module-header

``const CONTACT_MATCH_M``
-------------------------

.. CG-BLOCK id=const:CONTACT_MATCH_M lines=40-42

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/correlateOnDrag.ts
   :language: typescript
   :lines: 40-42
   :lineno-match:

.. CG-EXPLANATION-START id=const:CONTACT_MATCH_M

**What this does.** A fixed tolerance, 1 millimetre, within which two contact elevations count as the same contact.

**Why it is here.** The comment records that these units are measured before the arrangement's snap-to-grid step, whose grid is 1 millimetre — so the same tolerance is used to decide two elevations coincide.

.. CG-EXPLANATION-END id=const:CONTACT_MATCH_M

``function unitBaseElev``
-------------------------

.. CG-BLOCK id=function:unitBaseElev lines=43-47

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/correlateOnDrag.ts
   :language: typescript
   :lines: 43-47
   :lineno-match:

.. CG-EXPLANATION-START id=function:unitBaseElev

**What this does.** Converts a soil unit's base depth into its absolute elevation in metres TAW (the Belgian height datum), by subtracting the depth from the column's surface elevation.

**Why it is here.** The engine reasons in absolute elevation rather than depth-below-collar, so this one-line helper does that conversion for the base contact.

.. CG-EXPLANATION-END id=function:unitBaseElev

``function unitTopElev``
------------------------

.. CG-BLOCK id=function:unitTopElev lines=48-75

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/correlateOnDrag.ts
   :language: typescript
   :lines: 48-75
   :lineno-match:

.. CG-EXPLANATION-START id=function:unitTopElev

**What this does.** The top-contact version of the helper above — converts a unit's top depth into its absolute elevation.

**Why it is here.** Same reason as the base helper, for the top contact.

.. CG-EXPLANATION-END id=function:unitTopElev

``function boundaryHasTie``
---------------------------

.. CG-BLOCK id=function:boundaryHasTie lines=76-121

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/correlateOnDrag.ts
   :language: typescript
   :lines: 76-121
   :lineno-match:

.. CG-EXPLANATION-START id=function:boundaryHasTie

**What this does.** Checks whether an approved correlation tie already sits on the shared boundary between an upper band and the lower band directly beneath it, across a gap. It returns true when either a base-to-base tie joins the two columns' upper-band layers, or a top-to-top tie joins the two columns' lower-band layers.

**Why it is here.** The comment records that the side of a tie matters: only those two shapes actually sit ON this shared contact, because the shared boundary is the upper band's base and the lower band's top at once. A top-to-top tie on the UPPER band would tie the ground surface instead, leaving the bend engine unable to act — so it must not count as already tied, or the drag would skip the tie it needs to inject.

.. CG-EXPLANATION-END id=function:boundaryHasTie

``function contactTieLayers``
-----------------------------

.. CG-BLOCK id=function:contactTieLayers lines=122-150

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/correlateOnDrag.ts
   :language: typescript
   :lines: 122-150
   :lineno-match:

.. CG-EXPLANATION-START id=function:contactTieLayers

**What this does.** Returns the two litho-layer ids — the upper band's layer on the left column and on the right column — that a persisted correlation between them would reference.

**Why it is here.** The upper band's base contact IS the shared boundary, and a layer's id is the stable identity a correlation edge points at. Returning the two upper-band layer ids gives the caller exactly the pair a base-to-base tie connects while keeping the upper band above the lower one.

.. CG-EXPLANATION-END id=function:contactTieLayers

``function synthesizeContactTie``
---------------------------------

.. CG-BLOCK id=function:synthesizeContactTie lines=151-179

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/correlateOnDrag.ts
   :language: typescript
   :lines: 151-179
   :lineno-match:

.. CG-EXPLANATION-START id=function:synthesizeContactTie

**What this does.** Builds the correlation edge that makes an un-correlated boundary bendable — a base-to-base tie on the upper band across the gap, matching the current fill lithologies with no flip.

**Why it is here.** The docstring records that this tie makes the shared boundary count as a real band boundary the engine will bend, while leaving the upper band above the lower one so the lithology order is unchanged. Injecting it into the engine's edge list produces the same fill the persisted correlation will produce on the next rebuild, and it snaps the wedge to a flat band, which the owner accepted on 2026-07-24.

.. CG-EXPLANATION-END id=function:synthesizeContactTie

``function resolveTwoBandBoundary``
-----------------------------------

.. CG-BLOCK id=function:resolveTwoBandBoundary lines=180-233

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/correlateOnDrag.ts
   :language: typescript
   :lines: 180-233
   :lineno-match:

.. CG-EXPLANATION-START id=function:resolveTwoBandBoundary

**What this does.** Resolves the upper and lower band units by their body ids, one on each column, and returns them only when both bands run full-width across the gap and the lower band sits directly beneath the upper one on both columns.

**Why it is here.** The comment records that checking the left column alone would wrongly pass a gap where a third body separates the two bands on the right column — synthesizing a tie between non-adjacent bands would flip the lithology, so both columns are checked (guard B1).

.. CG-EXPLANATION-END id=function:resolveTwoBandBoundary

``function reclassifyStackedBandGrab``
--------------------------------------

.. CG-BLOCK id=function:reclassifyStackedBandGrab lines=234-311

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/correlateOnDrag.ts
   :language: typescript
   :lines: 234-311
   :lineno-match:

.. CG-EXPLANATION-START id=function:reclassifyStackedBandGrab

**What this does.** Takes a grabbed region that reports itself as a lens but is actually a full-width band, and reclassifies it into the two-band contact it bounds. It finds the full-width neighbour above or below that is adjacent on BOTH columns and picks the boundary nearest the cursor as the one being grabbed.

**Why it is here.** This is the S103 fix for the lens-hijack: an un-correlated two-full-band boundary reports itself as a lens, but a body present on both columns is a band, not a real lens. The docstring records the S106 both-column adjacency guard — resolving from the left column alone would grab a non-adjacent pair when an onlap intervenes on the right, and correlating that pair would absorb the intervening onlap; requiring adjacency on both columns makes that grab return nothing so the onlap survives.

.. CG-EXPLANATION-END id=function:reclassifyStackedBandGrab

``interface OnlapInterveningGrab``
----------------------------------

.. CG-BLOCK id=interface:OnlapInterveningGrab lines=312-361

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/correlateOnDrag.ts
   :language: typescript
   :lines: 312-361
   :lineno-match:

.. CG-EXPLANATION-START id=interface:OnlapInterveningGrab

**What this does.** Describes the result of grabbing a boundary while an onlap intervenes. An onlap is a band that laps in from one column and pinches to a tip inside the gap. This shape carries the full-width upper band, the full-width lower band beneath it, and the intervening onlap body ids that ride the bend.

**Why it is here.** The docstring records the §109 finding that the intervening onlap's own tie shares the upper band's base contact — the same line — so bending that contact bends the onlaps along with it, and they survive rather than being absorbed.

.. CG-EXPLANATION-END id=interface:OnlapInterveningGrab

``function resolveOnlapInterveningGrab``
----------------------------------------

.. CG-BLOCK id=function:resolveOnlapInterveningGrab lines=362-466

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/correlateOnDrag.ts
   :language: typescript
   :lines: 362-466
   :lineno-match:

.. CG-EXPLANATION-START id=function:resolveOnlapInterveningGrab

**What this does.** Resolves the owner's CS1 gap-4 case: the engineer grabs a clay boundary while a sand onlap pinches in between the clay and the matrix on one column. It recovers the triple of upper band, lower band, and the riding onlap(s) for that boundary.

**Why it is here.** The docstring records the history: §107 made the plain reclassifier return nothing here to block the destructive banding path (the §106 absorb), but §109 proved the engine half — a bend WITHOUT a banding tie makes the onlap ride the bent clay base and survive, since the onlap keeps its own tie. This resolver recovers what the overlay needs to dispatch that bend-without-tie, the wiring §109 left as its third blocker.

.. CG-EXPLANATION-END id=function:resolveOnlapInterveningGrab

``function onlapPinch``
-----------------------

.. CG-BLOCK id=function:onlapPinch lines=467-498

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/correlateOnDrag.ts
   :language: typescript
   :lines: 467-498
   :lineno-match:

.. CG-EXPLANATION-START id=function:onlapPinch

**What this does.** Returns the gap-fraction of an intervening onlap's pinch tip — a fraction is a horizontal position across a gap, 0 at the left column and 1 at the right — together with which column carries the onlap.

**Why it is here.** The docstring records that the pinch is a wall a flush-side reshape must not cross. The onlap tapers to a tip at the interior-pinch fraction of 0.5 measured from its own column, and this maps that tip into the gap's left-to-right frame so the caller knows which side is flush and which side rides.

.. CG-EXPLANATION-END id=function:onlapPinch

``function grabIsFlushSide``
----------------------------

.. CG-BLOCK id=function:grabIsFlushSide lines=499-527

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/correlateOnDrag.ts
   :language: typescript
   :lines: 499-527
   :lineno-match:

.. CG-EXPLANATION-START id=function:grabIsFlushSide

**What this does.** Answers whether the grab sits on the flush side of the onlap's pinch — the side where the two bands share a clean contact and no onlap intervenes at that horizontal position.

**Why it is here.** On the flush side the reshape must bend the contact locally and leave the onlap put (the onlap is a wall); on the onlap's side of the pinch the reshape rides the onlap. This is the §113 position-aware split that decides which of the two happens.

.. CG-EXPLANATION-END id=function:grabIsFlushSide

``type GrabbedBoundaryRoute``
-----------------------------

.. CG-BLOCK id=type:GrabbedBoundaryRoute lines=528-564

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/correlateOnDrag.ts
   :language: typescript
   :lines: 528-564
   :lineno-match:

.. CG-EXPLANATION-START id=type:GrabbedBoundaryRoute

**What this does.** Names the four routes a grabbed boundary can resolve to. This is a union type — a value that is exactly one of a listed set of shapes: onlap-intervening, flush-contact, plain-boundary, or lens.

**Why it is here.** The docstring records the S111 bug it prevents: the owner's clay-base grab landed on the shared-boundary strip, which had no onlap check and fell through to a plain untied drag that ate the clay. Making both dispatch sites resolve through this one route means an onlap-intervening grab can never be routed one way from one entry point and another way from the other.

.. CG-EXPLANATION-END id=type:GrabbedBoundaryRoute

``function routeGrabbedBoundary``
---------------------------------

.. CG-BLOCK id=function:routeGrabbedBoundary lines=565-622

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/correlateOnDrag.ts
   :language: typescript
   :lines: 565-622
   :lineno-match:

.. CG-EXPLANATION-START id=function:routeGrabbedBoundary

**What this does.** Decides which route a grabbed boundary takes. It checks onlap-intervening first (splitting into flush-contact or onlap-intervening by where along the gap the grab sits when the fraction is known), then a plain two-band boundary, and finally a genuine lens.

**Why it is here.** The comment records the standing owner rule that a resolver miss must never eat a band, which is why the onlap-intervening check runs first — a full-width band grabbed over an intervening onlap must never fall through to the plain path that would create an engine-inert tie and destroy the band.

.. CG-EXPLANATION-END id=function:routeGrabbedBoundary

``function twoBandExtentScreenY``
---------------------------------

.. CG-BLOCK id=function:twoBandExtentScreenY lines=623-670

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/correlateOnDrag.ts
   :language: typescript
   :lines: 623-670
   :lineno-match:

.. CG-EXPLANATION-START id=function:twoBandExtentScreenY

**What this does.** Returns the full two-band extent in screen Y — the upper band's own top and the lower band's own base across both columns — as the gap-free clamp for a stacked-band boundary drag.

**Why it is here.** It gives the drag a limit so the boundary cannot be dragged past the neighbour above or below it; it returns nothing when either body is absent, so the caller falls back to the grabbed region's own extent.

.. CG-EXPLANATION-END id=function:twoBandExtentScreenY

``function boundaryDragIsConsumable``
-------------------------------------

.. CG-BLOCK id=function:boundaryDragIsConsumable lines=671-683

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/correlateOnDrag.ts
   :language: typescript
   :lines: 671-683
   :lineno-match:

.. CG-EXPLANATION-START id=function:boundaryDragIsConsumable

**What this does.** Answers whether a fresh boundary grab targets a boundary the engine can actually act on — a genuine two-full-band contact — rather than one where nothing full-width sits beneath or an onlap intervenes.

**Why it is here.** The docstring records this as the safety net behind the onlap routing: even if a future resolver miss let an un-consumable grab reach the release, persisting a contact node on it would produce a bend the engine cannot honour and would flood the band away (the S111 clay-eating bug). Gating the persist to a no-op instead upholds the owner's standing rule of 2026-07-25 that a build must never eat a band.

.. CG-EXPLANATION-END id=function:boundaryDragIsConsumable

``interface PendingContactTie``
-------------------------------

.. CG-BLOCK id=interface:PendingContactTie lines=684-719

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/correlateOnDrag.ts
   :language: typescript
   :lines: 684-719
   :lineno-match:

.. CG-EXPLANATION-START id=interface:PendingContactTie

**What this does.** Describes a pending un-correlated boundary that a live drag must tie — the gap it spans, the synthesized correlation edge, and the two upper-band layer ids the persisted correlation will reference.

**Why it is here.** It carries exactly what both consumers need: the edge to inject into the live engine and the layer ids to post on release.

.. CG-EXPLANATION-END id=interface:PendingContactTie

``function pendingContactTieForDrag``
-------------------------------------

.. CG-BLOCK id=function:pendingContactTieForDrag lines=720-749

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/correlateOnDrag.ts
   :language: typescript
   :lines: 720-749
   :lineno-match:

.. CG-EXPLANATION-START id=function:pendingContactTieForDrag

**What this does.** Resolves the synthetic tie a live drag on an un-correlated two-full-band boundary must create, or returns nothing when the boundary is already tied or is not a two-full-band boundary.

**Why it is here.** The docstring records that it is used both by the overlay's live-edge injection and by the release persist, and that it takes a byte-identical no-injection path when the boundary is already correlated (returns nothing, so nothing is injected and nothing changes).

.. CG-EXPLANATION-END id=function:pendingContactTieForDrag

