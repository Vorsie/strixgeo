desktop.renderer.src.components.sections.sectionFillGroups
==========================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/sectionFillGroups.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/sectionFillGroups.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-55

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/sectionFillGroups.ts
   :language: typescript
   :lines: 1-55
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Dissolves adjacent same-lithology fill regions into ONE paint operation, so a merged soil mass is drawn as a single translucent shape rather than several.

**Why it is here.** The long docstring lays out the problem and the fix. Two same-lithology regions that abut along a lens, onlap or carve seam are two separate SVG shapes, and at their shared edge the darker app background bleeds through as a fine hairline (owner dogfeed 2026-07-19). Re-stroking the seam was rejected, because a self-colour stroke over the two translucent fills stacks to the very diagonal helper line the owner had just asked to remove, and overlapping two translucent shapes composites to a visibly darker band. Painting one shape per merged body composites its whole coverage as a single mask, so there is no hairline and no darkened seam. The grouping key is the formation plus an opacity bucket, so the selection-fade (a selected body at full opacity, its same-lithology siblings dimmed) still works. This is the app-render half of owner clause 5, merge touching lithos.

.. CG-EXPLANATION-END id=module-header

``interface FillGroupElement``
------------------------------

.. CG-BLOCK id=interface:FillGroupElement lines=56-75

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/sectionFillGroups.ts
   :language: typescript
   :lines: 56-75
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FillGroupElement

**What this does.** One fill element ready to be grouped: its closed screen ring, its lithology id, its fill colour, the opacity bucket it paints at, and the actual opacity value.

**Why it is here.** Two elements with the same formation but a different opacity bucket stay separate shapes, because a faded sibling of the selected body genuinely paints at a different opacity and must not be dissolved with the full-opacity mass.

.. CG-EXPLANATION-END id=interface:FillGroupElement

``interface FillGroup``
-----------------------

.. CG-BLOCK id=interface:FillGroup lines=76-85

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/sectionFillGroups.ts
   :language: typescript
   :lines: 76-85
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FillGroup

**What this does.** One dissolved group: a stable key, the combined SVG path data (one subpath per constituent ring), the colour, and the opacity.

**Why it is here.** This is the single SVG shape the overlay paints once for the whole merged mass.

.. CG-EXPLANATION-END id=interface:FillGroup

``function signedArea``
-----------------------

.. CG-BLOCK id=function:signedArea lines=86-103

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/sectionFillGroups.ts
   :language: typescript
   :lines: 86-103
   :lineno-match:

.. CG-EXPLANATION-START id=function:signedArea

**What this does.** The shoelace signed area of a screen ring; the sign tells which way the ring winds.

**Why it is here.** The winding must be known and normalised before several rings can be safely combined into one shape.

.. CG-EXPLANATION-END id=function:signedArea

``function subpath``
--------------------

.. CG-BLOCK id=function:subpath lines=104-137

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/sectionFillGroups.ts
   :language: typescript
   :lines: 104-137
   :lineno-match:

.. CG-EXPLANATION-START id=function:subpath

**What this does.** Appends one ring to a path string as a subpath, reversing it when its winding disagrees with a target sign, and returning nothing for a degenerate ring with fewer than three vertices.

**Why it is here.** Every subpath in a group must wind the same way so the default nonzero fill rule fills their union; an opposite-wound subpath would punch a hole wherever it overlaps a neighbour.

.. CG-EXPLANATION-END id=function:subpath

``function buildFillGroups``
----------------------------

.. CG-BLOCK id=function:buildFillGroups lines=138-185

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/sectionFillGroups.ts
   :language: typescript
   :lines: 138-185
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildFillGroups

**What this does.** Groups the elements by formation and opacity bucket in first-seen order, picks one target winding per group, turns each ring into a subpath wound that same way, and returns one combined path per group.

**Why it is here.** First-seen order gives a deterministic, stable output; skipping degenerate rings and dropping a group whose rings are all degenerate keeps the output clean.

.. CG-EXPLANATION-END id=function:buildFillGroups

