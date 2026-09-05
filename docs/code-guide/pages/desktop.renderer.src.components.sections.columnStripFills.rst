desktop.renderer.src.components.sections.columnStripFills
=========================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/columnStripFills.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/columnStripFills.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-26

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/columnStripFills.ts
   :language: typescript
   :lines: 1-26
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the pure module that builds the fill quads covering each column card, so the litho fill paints through the columns and not only in the gaps between them. It imports the partition-column type and the screen-edge type.

**Why it is here.** The docstring cites the owner dogfeed of 14 August 2026 ('litho fill still only present between columns' and 'same transparency everywhere'): the partition is per-gap so its regions stop at the card edges by construction, and this helper turns each column's own stack into full-card-width quads that the overlay pushes into the SAME dissolved fill layer as the gap regions, so a dissolved path composites its coverage once and the fill cannot read brighter over a card than in the gap beside it. On the geotech axis a column the subdivision has not reached falls back to its litho stack.

.. CG-EXPLANATION-END id=module-header

``interface ColumnStripInput``
------------------------------

.. CG-BLOCK id=interface:ColumnStripInput lines=27-36

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/columnStripFills.ts
   :language: typescript
   :lines: 27-36
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ColumnStripInput

**What this does.** The named shape of one partition assembly's outputs the helper reads: the along-ordered investigation ids, the id-to-unit-stack map, and the id-to-screen-edges map.

**Why it is here.** Bundling the three lookups the assembly already produced lets the helper take one clean input rather than three loose arguments.

.. CG-EXPLANATION-END id=interface:ColumnStripInput

``interface ColumnStripQuad``
-----------------------------

.. CG-BLOCK id=interface:ColumnStripQuad lines=37-67

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/columnStripFills.ts
   :language: typescript
   :lines: 37-67
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ColumnStripQuad

**What this does.** The named shape of one card-wide fill quad: the column it sits on, the unit's formation (which keys colour and dissolve identity), the source unit's layer id, whether it came from the axis's own stack or the litho frame, and the closed screen-space ring of four points.

**Why it is here.** The comment on the layer id records its role for the un-join spotlight (debt #278): an on-column strip whose layer id matches the hovered un-join anchor must light up with the between-column regions, and a litho-frame fallback strip carries a litho layer id a geotech anchor never matches, so it correctly never lights.

.. CG-EXPLANATION-END id=interface:ColumnStripQuad

``function buildColumnStripFills``
----------------------------------

.. CG-BLOCK id=function:buildColumnStripFills lines=68-111

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/columnStripFills.ts
   :language: typescript
   :lines: 68-111
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildColumnStripFills

**What this does.** Builds the card-covering quads for every column: for each column in order it uses the active partition's stack when that column has units, otherwise the litho-frame fallback stack; it reads the card's screen edges from whichever assembly supplied the stack; and for each unit it converts top and base to screen y, trims to the plot window rather than dropping a straddling unit, and emits a four-point rectangle spanning the whole card width.

**Why it is here.** The comment: on the geotech axis a column with an empty primary stack falls back to its litho stack (which the caller colours with the litho map), mirroring the gap fill's litho-fallback rule; trimming to the plot window keeps a unit that runs off the top or bottom rather than dropping it.

.. CG-EXPLANATION-END id=function:buildColumnStripFills

