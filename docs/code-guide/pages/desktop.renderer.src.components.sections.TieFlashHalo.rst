desktop.renderer.src.components.sections.TieFlashHalo
=====================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/TieFlashHalo.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/TieFlashHalo.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-18

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/TieFlashHalo.tsx
   :language: tsx
   :lines: 1-18
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the file for the brief pulse that says 'this is the tie you asked for'. It imports its three visual constants.

**Why it is here.** The docstring cites the owner ask of 25 August 2026 ('make that clickable so it highlights the tie'): the toolbar's pending chip centres the tie, and this pulse marks it once the camera lands. It is the same idiom as the column-landing flash — a brief amber pulse, pointer-inert so it never eats the following gesture, and gone again on its own — drawn behind the tie so the tie's own dashes stay readable.

.. CG-EXPLANATION-END id=module-header

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=19-49

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/TieFlashHalo.tsx
   :language: tsx
   :lines: 19-49
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** The inputs: the tie's SVG points string, whether it draws as a closed ring, and the edge id for the test hook.

**Why it is here.** Same shape and reasoning as the conflict halo: the points are passed through so the pulse cannot drift from the tie, and the closed flag avoids a gap at the join of a ring.

.. CG-EXPLANATION-END id=interface:Props

``function TieFlashHalo``
-------------------------

.. CG-BLOCK id=function:TieFlashHalo lines=50-64

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/TieFlashHalo.tsx
   :language: tsx
   :lines: 50-64
   :lineno-match:

.. CG-EXPLANATION-START id=function:TieFlashHalo

**What this does.** The component. It builds one shared attribute set (the amber colour, width, low opacity, and a CSS pulse animation class) and returns a polygon for a closed tie or a polyline for an open one, ignoring the mouse.

**Why it is here.** The animated class makes it pulse and fade, and the pointer-inert setting keeps the highlight from eating the gesture that follows the camera landing.

.. CG-EXPLANATION-END id=function:TieFlashHalo

