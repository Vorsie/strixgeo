desktop.renderer.src.components.sections.TieConflictHalo
========================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/TieConflictHalo.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/TieConflictHalo.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-29

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/TieConflictHalo.tsx
   :language: tsx
   :lines: 1-29
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the file for the mark that says 'this correlation tie is fighting another one'. A tie (correlation) is a line the engineer draws tying one column's contact to the next. It imports its four visual constants.

**Why it is here.** The docstring cites owner ruling of 26 August 2026 ('mark the crossing ties'): two accepted ties that cross suspend each other so neither bands, and until now the section never said which two lines were the cause. It notes the halo is drawn behind the tie so the tie keeps its own colour and dash — a marker that restyled its subject would replace information, not add it — and that this is a persistent state, not a timed animation, gone only when the engineer deletes one of the two ties.

.. CG-EXPLANATION-END id=module-header

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=30-60

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/TieConflictHalo.tsx
   :language: tsx
   :lines: 30-60
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** The inputs: the SVG points string of the tie being marked (its shape verbatim), whether that shape is a closed ring or an open line, and the edge id for the test hook.

**Why it is here.** Passing the tie's own points through untouched means the marker can never drift from the shape it marks; the closed flag exists because tracing a ring with an open line would leave a visible gap at the join.

.. CG-EXPLANATION-END id=interface:Props

``function TieConflictHalo``
----------------------------

.. CG-BLOCK id=function:TieConflictHalo lines=61-75

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/TieConflictHalo.tsx
   :language: tsx
   :lines: 61-75
   :lineno-match:

.. CG-EXPLANATION-START id=function:TieConflictHalo

**What this does.** The component. It builds one set of shared drawing attributes (the conflict colour, width, opacity, and dash) and returns a polygon when the shape closes or a polyline when it does not; a polygon is a closed ring of points, a polyline an open chain. It ignores the mouse.

**Why it is here.** One shared attribute set keeps the closed and open cases identical apart from the element type, and the pointer-inert setting keeps the halo from stealing any gesture.

.. CG-EXPLANATION-END id=function:TieConflictHalo

