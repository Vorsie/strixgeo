desktop.renderer.src.utils.geotechHierarchicalFill.dropNeedleSpurs
==================================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotechHierarchicalFill/dropNeedleSpurs.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotechHierarchicalFill/dropNeedleSpurs.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-53

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/dropNeedleSpurs.ts
   :language: typescript
   :lines: 1-53
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module removes "needle spurs" from a finished region's outline — a place where the outline walks out to a point and almost straight back along the same path, enclosing essentially no area. Such a spur carries no ground and shows nothing, but the seam-stroke pass strokes its two nearly collinear edges as a hairline running from the region's edge to a point in mid-region, ending in nothing. It imports the region shape.

**Why it is here.** Owner, 2026-08-21 late night: "the crack has a boundary at the bottom but not at the top, it shouldn't be there, no holes in the model remember." It is not a hole — the geometric audit finds zero unpainted ground — it is the outline doubling back on itself, and dropping the spur's point changes no area and no class. The docstring records the code-hunt finding of 2026-08-22 that the thinness measure must be taken in true metres: a ring's points mix a dimensionless fraction and a metre elevation, and comparing them directly made the test 300 times more permissive for a near-horizontal spur than a near-vertical one, so every function here converts fraction to along-section metres first.

.. CG-EXPLANATION-END id=module-header

``const NEEDLE_WIDTH_M``
------------------------

.. CG-BLOCK id=const:NEEDLE_WIDTH_M lines=54-56

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/dropNeedleSpurs.ts
   :language: typescript
   :lines: 54-56
   :lineno-match:

.. CG-EXPLANATION-START id=const:NEEDLE_WIDTH_M

**What this does.** A constant: how thin an out-and-back detour must be, 0.7 millimetres, to count as a needle.

**Why it is here.** The backend's minimum layer thickness is 1 mm, so a real band can be exactly that thin and must not be mistaken for a needle; the owner's own circled spur measured 0.505 mm. 0.7 mm splits the difference — about 40 percent above the measured defect and 30 percent below the legal minimum.

.. CG-EXPLANATION-END id=const:NEEDLE_WIDTH_M

``interface P``
---------------

.. CG-BLOCK id=interface:P lines=57-62

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/dropNeedleSpurs.ts
   :language: typescript
   :lines: 57-62
   :lineno-match:

.. CG-EXPLANATION-START id=interface:P

**What this does.** A ring vertex — a fraction and an elevation.

**Why it is here.** The module works over rings, and this is the point it reads them as.

.. CG-EXPLANATION-END id=interface:P

``function toMetres``
---------------------

.. CG-BLOCK id=function:toMetres lines=63-80

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/dropNeedleSpurs.ts
   :language: typescript
   :lines: 63-80
   :lineno-match:

.. CG-EXPLANATION-START id=function:toMetres

**What this does.** Converts a ring vertex to along-section metres across and metre elevation up, using the gap's own width.

**Why it is here.** Only in a single metre unit does the thinness test mean the same thing in every direction, which is the whole point of the 2026-08-22 code-hunt finding.

.. CG-EXPLANATION-END id=function:toMetres

``function dropNeedleSpurs``
----------------------------

.. CG-BLOCK id=function:dropNeedleSpurs lines=81-126

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/dropNeedleSpurs.ts
   :language: typescript
   :lines: 81-126
   :lineno-match:

.. CG-EXPLANATION-START id=function:dropNeedleSpurs

**What this does.** Drops every out-and-back needle from one ring. A vertex is a needle point when the outline reverses direction there and the triangle it makes with its neighbours is thinner than the needle width, measured in true metres. It repeats until the ring is stable and never reduces a ring below three vertices.

**Why it is here.** The direction-reversal test is only a cheap pre-filter — a genuine sharp wedge point reverses just as hard as a spur — so the metre-scale area test is what actually protects a real corner; only its size tells the two apart. Removal repeats because a spur can nest inside a spur.

.. CG-EXPLANATION-END id=function:dropNeedleSpurs

``function isNeedleRegion``
---------------------------

.. CG-BLOCK id=function:isNeedleRegion lines=127-149

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/dropNeedleSpurs.ts
   :language: typescript
   :lines: 127-149
   :lineno-match:

.. CG-EXPLANATION-START id=function:isNeedleRegion

**What this does.** Asks whether a WHOLE region is itself needle-thin — snap debris rather than ground — by the same area-over-longest-edge measure applied to the ring itself.

**Why it is here.** A sliver whose true width is a fraction of a millimetre paints nothing a screen can show, yet its own outline stroke draws the very hairline this module removes. Measured on CS1: four such regions, 0.0016 m2 of "ground" between them.

.. CG-EXPLANATION-END id=function:isNeedleRegion

``function dropRegionNeedles``
------------------------------

.. CG-BLOCK id=function:dropRegionNeedles lines=150-162

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/dropNeedleSpurs.ts
   :language: typescript
   :lines: 150-162
   :lineno-match:

.. CG-EXPLANATION-START id=function:dropRegionNeedles

**What this does.** Runs over all the finished regions, de-needles each one's outline using its own gap width, and drops any region that is itself a needle. It returns the cleaned regions.

**Why it is here.** It is the module's public entry point — the one call the fill makes to clean both the spurs inside regions and the sliver regions themselves — taking the along-section metres so each region's width is read in its own fraction space.

.. CG-EXPLANATION-END id=function:dropRegionNeedles

