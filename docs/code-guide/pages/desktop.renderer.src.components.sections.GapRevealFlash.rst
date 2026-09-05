desktop.renderer.src.components.sections.GapRevealFlash
=======================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/GapRevealFlash.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/GapRevealFlash.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-10

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/GapRevealFlash.tsx
   :language: tsx
   :lines: 1-10
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The whole file for the marker that flashes over the gap between two investigations when a model-check finding points there ('show me'). The only import is the placed-column type.

**Why it is here.** A rendered gap can be narrower than one screen pixel, so the marker holds its true centre but stays at least 16 pixels wide — wide enough that 'show me' is useful for the narrowest reported gaps without pretending either column is the faulty ground.

.. CG-EXPLANATION-END id=module-header

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=11-17

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/GapRevealFlash.tsx
   :language: tsx
   :lines: 11-17
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** The inputs: the pair of investigation ids to flash between (or nothing), the placed columns to look their positions up in, and the plot's top and height.

**Why it is here.** The ids are a pair because a gap is always between two investigations; passing the placed columns lets the marker find their on-screen positions.

.. CG-EXPLANATION-END id=interface:Props

``function GapRevealFlash``
---------------------------

.. CG-BLOCK id=function:GapRevealFlash lines=18-44

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/GapRevealFlash.tsx
   :language: tsx
   :lines: 18-44
   :lineno-match:

.. CG-EXPLANATION-START id=function:GapRevealFlash

**What this does.** The component. It returns nothing when there is no pair; otherwise it finds the two columns, takes the midpoint between their nudged positions as the centre, sets the width to the gap or a 16-pixel floor, and draws a pulsing translucent amber rectangle over the plot height.

**Why it is here.** It uses the nudged (post-spacing) column positions so the flash lands on the columns as drawn, and the width floor guarantees a visible target even for a sub-pixel gap. It ignores pointer events so it never intercepts a gesture.

.. CG-EXPLANATION-END id=function:GapRevealFlash

