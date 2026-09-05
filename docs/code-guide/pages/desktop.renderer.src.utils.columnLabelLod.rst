desktop.renderer.src.utils.columnLabelLod
=========================================

.. CG-PAGE source=desktop/src/renderer/src/utils/columnLabelLod.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/columnLabelLod.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-26

.. literalinclude:: ../../../desktop/src/renderer/src/utils/columnLabelLod.ts
   :language: typescript
   :lines: 1-26
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A comment describing what this module decides: for the section canvas, which of three label modes each column's header should use, so the labels stay readable as columns crowd together. It lays out the decision cascade — a selected or hovered column always shows the full three-line header; otherwise wide spacing shows the full header, medium spacing shows just the id rotated to read vertically, and tight spacing suppresses all but the guaranteed labels.

**Why it is here.** The comment records that at dense spacings the three-line stack becomes unreadable, and that spacing is measured as the distance to the nearest neighbour rather than a global step so a non-uniform layout is handled gracefully — a close pair can rotate while distant neighbours stay full. It is kept a pure function (its answer depends only on its inputs, with no side effects) so it is testable without React or the drawing surface.

.. CG-EXPLANATION-END id=module-header

``type ColumnLabelMode``
------------------------

.. CG-BLOCK id=type:ColumnLabelMode lines=27-37

.. literalinclude:: ../../../desktop/src/renderer/src/utils/columnLabelLod.ts
   :language: typescript
   :lines: 27-37
   :lineno-match:

.. CG-EXPLANATION-START id=type:ColumnLabelMode

**What this does.** Names the three modes a column label can take: the full multi-line header, a rotated single id, or none.

**Why it is here.** Pinning the modes to these three words means every place that reads the mode handles exactly the cases that exist and no stray fourth value.

.. CG-EXPLANATION-END id=type:ColumnLabelMode

``const FULL_HEADER_THRESHOLD_PX``
----------------------------------

.. CG-BLOCK id=const:FULL_HEADER_THRESHOLD_PX lines=38-49

.. literalinclude:: ../../../desktop/src/renderer/src/utils/columnLabelLod.ts
   :language: typescript
   :lines: 38-49
   :lineno-match:

.. CG-EXPLANATION-START id=const:FULL_HEADER_THRESHOLD_PX

**What this does.** The minimum spacing, in pixels, at which the full three-line header fits without colliding: ninety.

**Why it is here.** The comment records the calculation — a worst-case header is about eighty pixels wide plus a small gap each side, rounded up for comfort — and notes the value is tunable by the owner after a visual review.

.. CG-EXPLANATION-END id=const:FULL_HEADER_THRESHOLD_PX

``const ROTATED_THRESHOLD_PX``
------------------------------

.. CG-BLOCK id=const:ROTATED_THRESHOLD_PX lines=50-54

.. literalinclude:: ../../../desktop/src/renderer/src/utils/columnLabelLod.ts
   :language: typescript
   :lines: 50-54
   :lineno-match:

.. CG-EXPLANATION-START id=const:ROTATED_THRESHOLD_PX

**What this does.** The minimum spacing, in pixels, at which a single rotated id fits without colliding: eighteen.

**Why it is here.** The comment records the reasoning about how much room a rotated label needs, and again notes it is tunable by the owner after visual review.

.. CG-EXPLANATION-END id=const:ROTATED_THRESHOLD_PX

``interface ColumnLodInput``
----------------------------

.. CG-BLOCK id=interface:ColumnLodInput lines=55-68

.. literalinclude:: ../../../desktop/src/renderer/src/utils/columnLabelLod.ts
   :language: typescript
   :lines: 55-68
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ColumnLodInput

**What this does.** Describes the per-column information the decision needs: a stable id, the column's horizontal screen position, and whether it is selected or hovered.

**Why it is here.** These are exactly the inputs the cascade branches on — position sets the spacing, and the selected/hovered flags force the full header — so the shape carries no more than the decision reads.

.. CG-EXPLANATION-END id=interface:ColumnLodInput

``interface ColumnLodResult``
-----------------------------

.. CG-BLOCK id=interface:ColumnLodResult lines=69-102

.. literalinclude:: ../../../desktop/src/renderer/src/utils/columnLabelLod.ts
   :language: typescript
   :lines: 69-102
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ColumnLodResult

**What this does.** Describes the result per column: its id, the chosen mode, and a callout flag.

**Why it is here.** The comment records that the callout flag is set when a selected or hovered column must show its full header but spacing is too tight, so the renderer knows to offset the label above its neighbour to avoid overlap.

.. CG-EXPLANATION-END id=interface:ColumnLodResult

``function selectVisibleLabels``
--------------------------------

.. CG-BLOCK id=function:selectVisibleLabels lines=103-157

.. literalinclude:: ../../../desktop/src/renderer/src/utils/columnLabelLod.ts
   :language: typescript
   :lines: 103-157
   :lineno-match:

.. CG-EXPLANATION-START id=function:selectVisibleLabels

**What this does.** Computes the display mode for every column. It sorts a copy by position to find each column's nearest-neighbour distance, notes the first and last columns, then for each column applies the cascade: selected or hovered gets the full header (with a callout when tight); wide spacing gets the full header; medium spacing gets a rotated id; and in the tight regime only the first and last columns keep a (rotated) label while the rest are suppressed.

**Why it is here.** The docstring records that it is a pure function safe to call inside a memoised value with no special handling, and the comments record why the first and last columns are always kept — they anchor the axis even when the middle is decimated.

.. CG-EXPLANATION-END id=function:selectVisibleLabels

