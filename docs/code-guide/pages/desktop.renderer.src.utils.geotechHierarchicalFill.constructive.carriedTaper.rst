desktop.renderer.src.utils.geotechHierarchicalFill.constructive.carriedTaper
============================================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/carriedTaper.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/carriedTaper.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-49

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/carriedTaper.ts
   :language: typescript
   :lines: 1-49
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the module the docstring calls ONE SMOOTH TAPER. It defines the shape a band draws while crossing ground no test read: one straight taper from the band's own column to the same apex an ordinary pinch would reach, with the blind column passed through mid-taper and no step. It imports the band and tie types only.

**Why it is here.** This is owner ruling 2026-08-25, 'option 1, one smooth taper ofcourse, but look at alongM'. The docstring records the defect: a flat-then-pinch drew a step exactly at the blind column, the one place on the section where nothing was measured. It also records the alongM caveat — a test is a point in reality but occupies a strip of width on the section — and explains that the renderer already places fraction 0 at the strip's drawn edge, so a taper anchored on the band's own position leaves the strip at full thickness by construction and nothing needs to be inset again here.

.. CG-EXPLANATION-END id=module-header

``interface BandCarry``
-----------------------

.. CG-BLOCK id=interface:BandCarry lines=50-71

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/carriedTaper.ts
   :language: typescript
   :lines: 50-71
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BandCarry

**What this does.** The shape recording where a carried band actually measures its pinch: the along-section position (in metres) of the far column that genuinely reads its levels, and the terminal gap's own two columns by frame index (low and high).

**Why it is here.** It is resolved once per band-and-direction by the bridge module and stamped on the band for every carried gap except the terminal one, which already draws the pinch itself.

.. CG-EXPLANATION-END id=interface:BandCarry

``function carryReachTies``
---------------------------

.. CG-BLOCK id=function:carryReachTies lines=72-79

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/carriedTaper.ts
   :language: typescript
   :lines: 72-79
   :lineno-match:

.. CG-EXPLANATION-START id=function:carryReachTies

**What this does.** Returns the subset of the run's ties that cross the terminal gap — those whose span brackets the carry's low and high columns.

**Why it is here.** The pinch-reach calculation halves a lens's reach while its diamond would cross a tie, and it must be asked of the SAME ties the terminal gap's pinch was measured against, because the ruling is 'pinches at the same place as today'. Feeding it the terminal gap's own ties is what makes the carried gaps and the terminal gap draw one line.

.. CG-EXPLANATION-END id=function:carryReachTies

``interface TaperBoundaries``
-----------------------------

.. CG-BLOCK id=interface:TaperBoundaries lines=80-97

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/carriedTaper.ts
   :language: typescript
   :lines: 80-97
   :lineno-match:

.. CG-EXPLANATION-START id=interface:TaperBoundaries

**What this does.** A tiny shape: a construct's two boundaries expressed as functions of along-section position — a ``topAt`` and a ``baseAt`` that each return an elevation for a given x.

**Why it is here.** One definition, reused by the ordinary lens and the carried band alike, so the two can never draw different lines through the same point.

.. CG-EXPLANATION-END id=interface:TaperBoundaries

``function taperBetween``
-------------------------

.. CG-BLOCK id=function:taperBetween lines=98-107

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/carriedTaper.ts
   :language: typescript
   :lines: 98-107
   :lineno-match:

.. CG-EXPLANATION-START id=function:taperBetween

**What this does.** Builds the straight taper from a band's own column to an apex, with both contacts closing on the band's mid-elevation, and clamped flat past the apex.

**Why it is here.** One definition serves both the ordinary lens, whose apex is inside its own gap, and a carried band, whose apex lies gaps away, because the docstring's whole point is that the carried band IS the ordinary lens, merely seen one gap early.

.. CG-EXPLANATION-END id=function:taperBetween

