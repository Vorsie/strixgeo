desktop.renderer.src.utils.lithoOutlineEdges
============================================

.. CG-PAGE source=desktop/src/renderer/src/utils/lithoOutlineEdges.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/lithoOutlineEdges.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-18

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoOutlineEdges.ts
   :language: typescript
   :lines: 1-18
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment and the one import. This file decides which edges of the geotech partition should be drawn as dark litho outlines, dissolving away the ones that are not real soil boundaries.

**Why it is here.** The comment records the owner ruling (2026-08-13) that put the litho frame on the geotech axis as dark outlines, and the problem that drawing every region's full ring also painted the machine partition's internal seams — the join between two touching same-soil units, an onlap's diagonal, a termination fan — as near-black lines the user reads as real contacts (owner dogfeed 2026-08-18, "weird ass horizontal black lines without meaning"). So an edge is drawn only where the soil actually changes across it, or where nothing sits on the other side (the outer envelope). Matching edges between two regions works because the arrangement guarantees adjacent regions share their cut vertices exactly, so a shared seam shows up as identical segments in both rings.

.. CG-EXPLANATION-END id=module-header

``interface OutlineSegment``
----------------------------

.. CG-BLOCK id=interface:OutlineSegment lines=19-25

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoOutlineEdges.ts
   :language: typescript
   :lines: 19-25
   :lineno-match:

.. CG-EXPLANATION-START id=interface:OutlineSegment

**What this does.** One outline segment to draw: which gap it belongs to and its two endpoints, given in gap-fraction across and elevation up.

**Why it is here.** It is the shape the function hands back for the renderer to stroke.

.. CG-EXPLANATION-END id=interface:OutlineSegment

``const KEY_DECIMALS``
----------------------

.. CG-BLOCK id=const:KEY_DECIMALS lines=26-57

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoOutlineEdges.ts
   :language: typescript
   :lines: 26-57
   :lineno-match:

.. CG-EXPLANATION-START id=const:KEY_DECIMALS

**What this does.** The number of decimal places (six) a vertex is rounded to when building the text key that identifies an edge.

**Why it is here.** The comment records that six decimals is well under the engine's one-millimetre snap, so two regions that share a vertex round to the identical key and their shared edge is recognised as one.

.. CG-EXPLANATION-END id=const:KEY_DECIMALS

``const COLUMN_LINE_TOLERANCE_M``
---------------------------------

.. CG-BLOCK id=const:COLUMN_LINE_TOLERANCE_M lines=58-65

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoOutlineEdges.ts
   :language: typescript
   :lines: 58-65
   :lineno-match:

.. CG-EXPLANATION-START id=const:COLUMN_LINE_TOLERANCE_M

**What this does.** How close, in metres, a vertical segment must sit to a gap's own left or right column edge to count as lying ON the column line rather than inside the ground; two millimetres.

**Why it is here.** The comment records that an exact-equality test is wrong because the arrangement snaps vertices to a one-millimetre grid, so a gap's column edges land a hair inside it rather than at exactly 0 and 1. The tolerance is in metres because the error is in metres (audit finding 2026-08-23): a flat fraction leaked on narrow gaps — a 42 mm CPT-and-borehole pair redrew the very black line this guard removes — and over-ate on wide gaps, dissolving 1.5 m of real ground on a 150 m gap. Two millimetres is twice the snap grid and four times the worst offset measured across the owner's 14 sections, while the only genuine interior vertical (a mid-gap seam at fraction 0.5) is orders of magnitude away.

.. CG-EXPLANATION-END id=const:COLUMN_LINE_TOLERANCE_M

``const COLUMN_LINE_MAX_FRACTION``
----------------------------------

.. CG-BLOCK id=const:COLUMN_LINE_MAX_FRACTION lines=66-67

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoOutlineEdges.ts
   :language: typescript
   :lines: 66-67
   :lineno-match:

.. CG-EXPLANATION-START id=const:COLUMN_LINE_MAX_FRACTION

**What this does.** A ceiling of a quarter on the converted fraction, so a tiny degenerate gap cannot let the column-line guard swallow its whole width.

**Why it is here.** The comment records that at the 20 mm minimum column separation two millimetres is already a tenth of the gap, and below that the whole gap is sub-centimetre and carries nothing meaningful — but the guard still must not eat it whole.

.. CG-EXPLANATION-END id=const:COLUMN_LINE_MAX_FRACTION

``interface EdgeOwners``
------------------------

.. CG-BLOCK id=interface:EdgeOwners lines=68-87

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoOutlineEdges.ts
   :language: typescript
   :lines: 68-87
   :lineno-match:

.. CG-EXPLANATION-START id=interface:EdgeOwners

**What this does.** An internal record tracking, for one edge, its gap, its two endpoints, the soils of every region that owns it, and how many of those owners are not lenses.

**Why it is here.** It accumulates who touches each edge across the whole scan, so the keep-or-dissolve decision can be made once every region has been seen.

.. CG-EXPLANATION-END id=interface:EdgeOwners

``function lithoOutlineEdges``
------------------------------

.. CG-BLOCK id=function:lithoOutlineEdges lines=88-155

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoOutlineEdges.ts
   :language: typescript
   :lines: 88-155
   :lineno-match:

.. CG-EXPLANATION-START id=function:lithoOutlineEdges

**What this does.** Computes the outline segments after the soil-level dissolve. It sets up a per-gap tolerance converted from metres into that gap's fraction space, walks every region's polygon edge, skips zero-length debris and any vertical sitting on a column line, and records each remaining edge's owners and their soils. Then it emits an edge only when at least one owner is not a lens and the owners' soils are not all identical — so an internal same-soil seam dissolves while a real contact or an outer-envelope edge is drawn.

**Why it is here.** The docstring records the per-gap rules: a same-soil shared edge dissolves, a different-soil shared edge draws once, a single-owner edge draws as the outer envelope unless its only owner is a lens (a lens ring would read as a boundary it is not), and an unknown (null) soil never counts as equal to anything so it honestly draws the line. The on-column skip is a proximity test, not equality, because the snap puts a gap's column edges a hair inside it (owner 2026-08-22, "a column is not a contact"); the metric tolerance is explained on the tolerance constant above.

.. CG-EXPLANATION-END id=function:lithoOutlineEdges

