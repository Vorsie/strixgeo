desktop.renderer.src.utils.scrubBounds
======================================

.. CG-PAGE source=desktop/src/renderer/src/utils/scrubBounds.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/scrubBounds.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-22

.. literalinclude:: ../../../desktop/src/renderer/src/utils/scrubBounds.ts
   :language: typescript
   :lines: 1-22
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file works out the span of the section scrub-bar track — the range along the section the engineer can pan across. It insists the range match where the columns are actually drawn, not where they were originally projected. The block covers the module comment and the column-input documentation.

**Why it is here.** The comment records why the distinction matters: the section applies a spacing warp so columns do not overlap, and at low spacing the columns pack toward the left, so a column's drawn x sits left of its raw projected x. If the scrub track used the raw positions, the handle would let the view scroll well past the packed columns into empty space (dogfeed 2026-06-06). Mapping each column's drawn x back through the viewport's inverse gives its warp-effective along position — the world position that actually renders where it is packed — and the extremes of those are the true track bounds. It is pan-independent because the drawn x already includes the current scroll, which the inverse adds straight back.

.. CG-EXPLANATION-END id=module-header

``interface ScrubBoundsColumn``
-------------------------------

.. CG-BLOCK id=interface:ScrubBoundsColumn lines=23-28

.. literalinclude:: ../../../desktop/src/renderer/src/utils/scrubBounds.ts
   :language: typescript
   :lines: 23-28
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ScrubBoundsColumn

**What this does.** A placed column reduced to the one field the bounds need: its drawn x after the spacing warp and nudge.

**Why it is here.** The comment records that this drawn x is the whole point — it is what carries the warp, so it is all the bounds calculation reads.

.. CG-EXPLANATION-END id=interface:ScrubBoundsColumn

``interface ScrubBounds``
-------------------------

.. CG-BLOCK id=interface:ScrubBounds lines=29-54

.. literalinclude:: ../../../desktop/src/renderer/src/utils/scrubBounds.ts
   :language: typescript
   :lines: 29-54
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ScrubBounds

**What this does.** An along-section range in world metres: a minimum and a maximum. The block ends with the documentation for the function below.

**Why it is here.** It is the span the scrub track covers, expressed in the section's own world metres.

.. CG-EXPLANATION-END id=interface:ScrubBounds

``function computeScrubBounds``
-------------------------------

.. CG-BLOCK id=function:computeScrubBounds lines=55-69

.. literalinclude:: ../../../desktop/src/renderer/src/utils/scrubBounds.ts
   :language: typescript
   :lines: 55-69
   :lineno-match:

.. CG-EXPLANATION-START id=function:computeScrubBounds

**What this does.** Walks the placed columns, maps each column's drawn x back to its warp-effective along position, and returns the smallest and largest of those; when there are no columns it returns the supplied fallback range.

**Why it is here.** The docstring records that the fallback keeps the bar grab-able before projection has landed on a fresh section, so the scrub handle never becomes unusable.

.. CG-EXPLANATION-END id=function:computeScrubBounds

