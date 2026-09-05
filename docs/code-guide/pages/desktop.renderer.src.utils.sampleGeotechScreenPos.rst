desktop.renderer.src.utils.sampleGeotechScreenPos
=================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/sampleGeotechScreenPos.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/sampleGeotechScreenPos.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-14

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sampleGeotechScreenPos.ts
   :language: typescript
   :lines: 1-14
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file works out where a lab sample's dot goes on the geotech axis: at the midpoint of its depth interval below the borehole's surface. The block covers the module comment and the depth-input documentation.

**Why it is here.** The comment records that the horizontal position goes through the spacing-aware transform, never the raw one, so the dot follows the same column nudging every other geotech overlay applies (memory: the section-view spacing modifier matters for all geometry), and that a borehole with no known surface elevation returns nothing because its vertical position is undefined.

.. CG-EXPLANATION-END id=module-header

``interface SampleDepth``
-------------------------

.. CG-BLOCK id=interface:SampleDepth lines=15-22

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sampleGeotechScreenPos.ts
   :language: typescript
   :lines: 15-22
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SampleDepth

**What this does.** A declared shape for a sample's depth interval: the depth to its top and the depth to its base, both below ground surface.

**Why it is here.** It names the two depths that fix the sample's vertical position.

.. CG-EXPLANATION-END id=interface:SampleDepth

``interface SampleColumnRef``
-----------------------------

.. CG-BLOCK id=interface:SampleColumnRef lines=23-30

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sampleGeotechScreenPos.ts
   :language: typescript
   :lines: 23-30
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SampleColumnRef

**What this does.** A reduced description of the column: its along-section position and its surface elevation (which may be missing).

**Why it is here.** It carries only the two facts the helper needs — where the column stands along the line, and the surface level to measure depths down from.

.. CG-EXPLANATION-END id=interface:SampleColumnRef

``interface SampleScreenPos``
-----------------------------

.. CG-BLOCK id=interface:SampleScreenPos lines=31-59

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sampleGeotechScreenPos.ts
   :language: typescript
   :lines: 31-59
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SampleScreenPos

**What this does.** A declared shape for a screen position in pixels: an x from the left edge and a y from the top edge. The block ends with the documentation for the function below.

**Why it is here.** It is the plain pixel point the caller draws the dot at.

.. CG-EXPLANATION-END id=interface:SampleScreenPos

``function sampleGeotechScreenPos``
-----------------------------------

.. CG-BLOCK id=function:sampleGeotechScreenPos lines=60-77

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sampleGeotechScreenPos.ts
   :language: typescript
   :lines: 60-77
   :lineno-match:

.. CG-EXPLANATION-START id=function:sampleGeotechScreenPos

**What this does.** Computes a sample dot's screen position: nothing when the borehole has no surface elevation, otherwise the midpoint of the depth interval turned into an elevation and then a pixel point, placed horizontally through the spacing-aware transform.

**Why it is here.** The docstring records that the horizontal transform MUST be the spacing-aware one so the dot stays aligned with the column glyph at any spacing, and that a missing surface elevation makes the vertical position undefined.

.. CG-EXPLANATION-END id=function:sampleGeotechScreenPos

