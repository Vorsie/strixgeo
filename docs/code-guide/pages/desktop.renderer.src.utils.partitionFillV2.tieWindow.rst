desktop.renderer.src.utils.partitionFillV2.tieWindow
====================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/tieWindow.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/tieWindow.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-30

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/tieWindow.ts
   :language: typescript
   :lines: 1-30
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module enforces one rule: a soil-class sample taken on a column to LABEL a face must be read on the face's own side of the ties that bound it — a sample may never cross a correlation. It supplies a tie-bounded elevation window and the clamp that pulls an escaped sample back inside it. Three samplers route through it: the flood-wedge label, the facing-matrix lookup, and the channel-matrix window.

**Why it is here.** The docstring's reason: ties are where classes change — that IS the 2/1/0 rule. A horizontal read knows nothing about the lines and, between steep ties, lands on the far side of a correlation the engineer drew, which is how a clay came to paint a sand channel under its own base tie. The window is deliberately a CLAMP, not a re-map: when the raw read already lands inside the lines (the overwhelming majority of near-horizontal ties) nothing moves; it can only pull back a sample that had escaped. Pure module.

.. CG-EXPLANATION-END id=module-header

``const SLOPE_EPS``
-------------------

.. CG-BLOCK id=const:SLOPE_EPS lines=31-36

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/tieWindow.ts
   :language: typescript
   :lines: 31-36
   :lineno-match:

.. CG-EXPLANATION-START id=const:SLOPE_EPS

**What this does.** A slope tolerance in metres — a tie flatter than this is read at its left endpoint.

**Why it is here.** A near-flat tie has no meaningful slope to interpolate, so it is read at one end rather than dividing by a near-zero width.

.. CG-EXPLANATION-END id=const:SLOPE_EPS

``const CHANNEL_MARGIN``
------------------------

.. CG-BLOCK id=const:CHANNEL_MARGIN lines=37-39

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/tieWindow.ts
   :language: typescript
   :lines: 37-39
   :lineno-match:

.. CG-EXPLANATION-START id=const:CHANNEL_MARGIN

**What this does.** A small metres offset keeping a clamped sample strictly inside the window rather than exactly on a bounding contact.

**Why it is here.** The docstring: small enough to land in a real unit, three orders above the 1 mm snap — so a clamped sample reads the unit inside the channel, not the boundary itself.

.. CG-EXPLANATION-END id=const:CHANNEL_MARGIN

``interface TieWindow``
-----------------------

.. CG-BLOCK id=interface:TieWindow lines=40-45

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/tieWindow.ts
   :language: typescript
   :lines: 40-45
   :lineno-match:

.. CG-EXPLANATION-START id=interface:TieWindow

**What this does.** The shape of an elevation window — a low and a high bound, either of which may be infinite.

**Why it is here.** It is the channel a sample must stay within; an infinite bound means no tie limits that side.

.. CG-EXPLANATION-END id=interface:TieWindow

``const UNBOUNDED_WINDOW``
--------------------------

.. CG-BLOCK id=const:UNBOUNDED_WINDOW lines=46-48

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/tieWindow.ts
   :language: typescript
   :lines: 46-48
   :lineno-match:

.. CG-EXPLANATION-START id=const:UNBOUNDED_WINDOW

**What this does.** The window with both bounds infinite — the whole column, bounded by no tie.

**Why it is here.** The docstring's stance: when no tie applies, never invent a boundary; this is the value returned in that case.

.. CG-EXPLANATION-END id=const:UNBOUNDED_WINDOW

``function tieElevAt``
----------------------

.. CG-BLOCK id=function:tieElevAt lines=49-67

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/tieWindow.ts
   :language: typescript
   :lines: 49-67
   :lineno-match:

.. CG-EXPLANATION-START id=function:tieElevAt

**What this does.** Returns a tie's elevation at a given along-section x, interpolating between its left and right endpoints (or its left value when the tie is near-flat).

**Why it is here.** The window is built from where the bounding ties sit at two different x positions, so their elevation must be evaluable at any x.

.. CG-EXPLANATION-END id=function:tieElevAt

``function tieWindowAt``
------------------------

.. CG-BLOCK id=function:tieWindowAt lines=68-101

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/tieWindow.ts
   :language: typescript
   :lines: 68-101
   :lineno-match:

.. CG-EXPLANATION-START id=function:tieWindowAt

**What this does.** Returns the tie-bounded window an elevation sits in, but expressed at a different read x: it finds the nearest tie below and the nearest above the elevation where it lives, then reports those same two ties' elevations where the sample will be read. If the two bounding ties cross between the columns it returns the unbounded window.

**Why it is here.** The docstring's phrasing: "which channel" is decided where the elevation lives, "what the channel is" is asked where it will be read. When the ties cross there is no well-defined channel, so it claims none rather than inventing one.

.. CG-EXPLANATION-END id=function:tieWindowAt

``function clampIntoWindow``
----------------------------

.. CG-BLOCK id=function:clampIntoWindow lines=102-111

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/tieWindow.ts
   :language: typescript
   :lines: 102-111
   :lineno-match:

.. CG-EXPLANATION-START id=function:clampIntoWindow

**What this does.** Returns an elevation pulled inside a window, or left where it is when it already sits inside; a fully unbounded window leaves it untouched and a window narrower than twice the margin returns its midpoint.

**Why it is here.** This is the actual enforcement — the escaped sample is the only one that moves, keeping the margin so it lands inside a real unit rather than on a bounding contact.

.. CG-EXPLANATION-END id=function:clampIntoWindow

``function unitReachesWindow``
------------------------------

.. CG-BLOCK id=function:unitReachesWindow lines=112-128

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/tieWindow.ts
   :language: typescript
   :lines: 112-128
   :lineno-match:

.. CG-EXPLANATION-START id=function:unitReachesWindow

**What this does.** Returns whether a unit occupies any of a window; merely touching it at a single elevation does not count.

**Why it is here.** Only a unit that genuinely overlaps the window is entitled to answer for it — a point touch is not occupancy.

.. CG-EXPLANATION-END id=function:unitReachesWindow

``function faceWindowOnColumn``
-------------------------------

.. CG-BLOCK id=function:faceWindowOnColumn lines=129-147

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/tieWindow.ts
   :language: typescript
   :lines: 129-147
   :lineno-match:

.. CG-EXPLANATION-START id=function:faceWindowOnColumn

**What this does.** Returns the window a face is answered over ON ONE COLUMN — the run of its boundary lying on that column's line — or nothing when the face only grazes the column at a point.

**Why it is here.** The docstring distinguishes this from the face's overall elevation span, which a dipping tie can carry up to the far side of the gap; a face grazing at a point has no run to read, so the caller keeps whatever it had.

.. CG-EXPLANATION-END id=function:faceWindowOnColumn

``function unitsInWindow``
--------------------------

.. CG-BLOCK id=function:unitsInWindow lines=148-150

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/tieWindow.ts
   :language: typescript
   :lines: 148-150
   :lineno-match:

.. CG-EXPLANATION-START id=function:unitsInWindow

**What this does.** Returns the units of a column that occupy any of a window.

**Why it is here.** They are the only units entitled to answer for that window, so the sampler restricts itself to them.

.. CG-EXPLANATION-END id=function:unitsInWindow

