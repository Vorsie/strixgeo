desktop.renderer.src.components.sections.sectionSeamStrokeElements
==================================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/sectionSeamStrokeElements.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/sectionSeamStrokeElements.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-30

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/sectionSeamStrokeElements.ts
   :language: typescript
   :lines: 1-30
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Runs the seam-stroke classifier with the column-glyph cards counted as filled ground.

**Why it is here.** The docstring explains the drift. The seam-stroke pass keeps a fill's hairline-closing stroke only where the edge's outward side is NOT covered by a same-formation fill, and its cases named the card strip as unfilled space, which was true when it was written. It stopped being true when the fill started painting THROUGH the cards (``columnStripFills.ts``, 2026-08-14): the strips joined the dissolved fill layer but not this classifier, so every gap region still counted its card edge as bordering nothing and stroked it, giving a darker rim down the gap side of every card edge, one soil body reading as two tones (owner dogfeed 2026-08-15). The strips are classification-only; they are never stroked themselves.

.. CG-EXPLANATION-END id=module-header

``interface SectionSeamStrokes``
--------------------------------

.. CG-BLOCK id=interface:SectionSeamStrokes lines=31-55

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/sectionSeamStrokeElements.ts
   :language: typescript
   :lines: 31-55
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SectionSeamStrokes

**What this does.** The two stroke-path lists the overlay actually draws: one index-aligned with the under-column substrate quads, one index-aligned with the gap regions. The comment after describes the classify function.

**Why it is here.** The caller draws exactly these two groups; the cards go in only to inform the classifier and carry no stroke of their own.

.. CG-EXPLANATION-END id=interface:SectionSeamStrokes

``function computeSectionSeamStrokes``
--------------------------------------

.. CG-BLOCK id=function:computeSectionSeamStrokes lines=56-71

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/sectionSeamStrokeElements.ts
   :language: typescript
   :lines: 56-71
   :lineno-match:

.. CG-EXPLANATION-START id=function:computeSectionSeamStrokes

**What this does.** Classifies every fill edge with the cards passed in as filled ground: it runs the shared stroke-path computation over the under-column quads, the gap regions, and the card strips concatenated together, then slices out just the quad strokes and the region strokes.

**Why it is here.** The strips are placed LAST in the concatenation so the two stroked groups keep the array indices the caller expects, and the strips' own entries simply fall off the end with the slice.

.. CG-EXPLANATION-END id=function:computeSectionSeamStrokes

