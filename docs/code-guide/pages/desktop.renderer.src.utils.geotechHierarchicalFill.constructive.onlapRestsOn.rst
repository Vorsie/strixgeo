desktop.renderer.src.utils.geotechHierarchicalFill.constructive.onlapRestsOn
============================================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/onlapRestsOn.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/onlapRestsOn.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-48

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/onlapRestsOn.ts
   :language: typescript
   :lines: 1-48
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module fixes the shape of an onlap's free side — the sloping contact it pinches down to its point. Recall an onlap is a band with one correlation tie: it rides the tied contact and closes its other, free contact down to a tip. This file makes that free contact rest ON whatever construct sits beneath it (or hang under whatever sits above it) until that neighbour pinches out, and only then run straight to its own tip — so it can never dip UNDER a mass it sits on top of at its own test. It imports only the band-construct data shape it works on.

**Why it is here.** Owner dogfeed, 2026-08-26, Tie-section 12 gap 0: "why the fuck is there a zigzag in that onlap?". The loose sand's wedge had wrapped underneath the medium lens directly beneath it. Both the onlap's closing line and the neighbour's flank leave the same shared point on the band's own column, both are straight, so where the onlap dived steeper it slipped below the neighbour and a hair-thin notch appeared. The ruling: an onlap's base rests on the construct below it until that construct pinches out, then runs straight from the pinch-tip to its own tip, and never wraps under a mass it sits on. The tip does not move and the tied side does not move — only the free side gains one middle bend.

.. CG-EXPLANATION-END id=module-header

``const CONTACT_EPS``
---------------------

.. CG-BLOCK id=const:CONTACT_EPS lines=49-50

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/onlapRestsOn.ts
   :language: typescript
   :lines: 49-50
   :lineno-match:

.. CG-EXPLANATION-START id=const:CONTACT_EPS

**What this does.** A constant: the distance, in metres, within which two contacts count as the same contact.

**Why it is here.** The rule only applies to a neighbour that leaves the exact same point on the band's own column, and this tolerance is what "the exact same point" means against millimetre-grid rounding.

.. CG-EXPLANATION-END id=const:CONTACT_EPS

``const WRAP_EPS``
------------------

.. CG-BLOCK id=const:WRAP_EPS lines=51-53

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/onlapRestsOn.ts
   :language: typescript
   :lines: 51-53
   :lineno-match:

.. CG-EXPLANATION-START id=const:WRAP_EPS

**What this does.** A hair-fine tolerance below which a dive does not really clear the neighbour's flank.

**Why it is here.** The bend is only added where the onlap genuinely passes below the neighbour, and this keeps floating-point noise from triggering a needless bend.

.. CG-EXPLANATION-END id=const:WRAP_EPS

``interface FreeVertex``
------------------------

.. CG-BLOCK id=interface:FreeVertex lines=54-77

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/onlapRestsOn.ts
   :language: typescript
   :lines: 54-77
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FreeVertex

**What this does.** A data shape for one point of a free contact, given in along-section metres across and elevation in metres TAW.

**Why it is here.** The free contact is now two segments, not one straight line, so it has to be stated as a list of these points — the small holder both readers of the shape share.

.. CG-EXPLANATION-END id=interface:FreeVertex

``function freeContactAt``
--------------------------

.. CG-BLOCK id=function:freeContactAt lines=78-103

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/onlapRestsOn.ts
   :language: typescript
   :lines: 78-103
   :lineno-match:

.. CG-EXPLANATION-START id=function:freeContactAt

**What this does.** Given a free contact as a list of points and an along-section position, it returns the contact's elevation there, held flat past either end. It walks the segments and interpolates within the one that contains the position.

**Why it is here.** When the free contact is the ordinary two-point straight line it reduces to exactly the old arithmetic, so an onlap with nothing pinching below it is byte-for-byte unchanged. The docstring notes it returns a segment's own end point once the walk arrives rather than re-interpolating onto it, because a full-length interpolation rounds a hair off the true value and a hair-wide gap is a spurious loop the arrangement would be entitled to mint — the owner's verification contract of 2026-08-25 that the tip is ONE point.

.. CG-EXPLANATION-END id=function:freeContactAt

``function neighbourAcrossFreeContact``
---------------------------------------

.. CG-BLOCK id=function:neighbourAcrossFreeContact lines=104-144

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/onlapRestsOn.ts
   :language: typescript
   :lines: 104-144
   :lineno-match:

.. CG-EXPLANATION-START id=function:neighbourAcrossFreeContact

**What this does.** Finds the one construct on the onlap's own column that shares the onlap's free contact — the mass it sits on or hangs under — provided that neighbour pinches out strictly inside the onlap's own reach. It scans the gap's constructs for one on the same column whose matching contact meets the onlap's, heading the same way out of the column and pinching first.

**Why it is here.** A column's bands are stacked contiguously, so at most one holds that shared contact from the other side. It must pinch, and pinch before the onlap does, or there is no tip to rest against — a neighbour closing at the same place offers none, and one that never closes offers none either, so both keep the straight closing line.

.. CG-EXPLANATION-END id=function:neighbourAcrossFreeContact

``function restOnlapsOnPinches``
--------------------------------

.. CG-BLOCK id=function:restOnlapsOnPinches lines=145-170

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/onlapRestsOn.ts
   :language: typescript
   :lines: 145-170
   :lineno-match:

.. CG-EXPLANATION-START id=function:restOnlapsOnPinches

**What this does.** The pass that applies the ruling to a gap's finished constructs. For each onlap it finds the neighbour it would wrap on, checks whether it actually dives below that neighbour's flank, and if so replaces the straight free contact with three points — the shared start, the neighbour's pinch-tip, and the onlap's own tip — leaving everything else untouched.

**Why it is here.** Only the free contact changes, and only where the dive truly reaches the neighbour; the tip, the tied contact, the closure it contributes and its classification are all left alone. It is safely repeatable — a contact already rested reads the neighbour's tip as its own value there, so the dive test answers no. The docstring stresses the free contact is stated ONCE and both readers take it from there, so the drawn line and the claimed area can never disagree about one wedge — yesterday's plunging-tie bug made structural.

.. CG-EXPLANATION-END id=function:restOnlapsOnPinches

