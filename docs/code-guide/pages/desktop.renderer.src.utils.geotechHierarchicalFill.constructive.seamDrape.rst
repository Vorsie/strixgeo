desktop.renderer.src.utils.geotechHierarchicalFill.constructive.seamDrape
=========================================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/seamDrape.ts complete=false

*Source file:* ``desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/seamDrape.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-68

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/seamDrape.ts
   :language: typescript
   :lines: 1-68
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=module-header

``const LEVEL_EPS``
-------------------

.. CG-BLOCK id=const:LEVEL_EPS lines=69-76

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/seamDrape.ts
   :language: typescript
   :lines: 69-76
   :lineno-match:

.. CG-EXPLANATION-START id=const:LEVEL_EPS

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:LEVEL_EPS

``const SEGMENT_MIN_SPAN``
--------------------------

.. CG-BLOCK id=const:SEGMENT_MIN_SPAN lines=77-88

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/seamDrape.ts
   :language: typescript
   :lines: 77-88
   :lineno-match:

.. CG-EXPLANATION-START id=const:SEGMENT_MIN_SPAN

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:SEGMENT_MIN_SPAN

``const COVER_EDGE_EPS``
------------------------

.. CG-BLOCK id=const:COVER_EDGE_EPS lines=89-91

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/seamDrape.ts
   :language: typescript
   :lines: 89-91
   :lineno-match:

.. CG-EXPLANATION-START id=const:COVER_EDGE_EPS

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:COVER_EDGE_EPS

``type SeamSide``
-----------------

.. CG-BLOCK id=type:SeamSide lines=92-94

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/seamDrape.ts
   :language: typescript
   :lines: 92-94
   :lineno-match:

.. CG-EXPLANATION-START id=type:SeamSide

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=type:SeamSide

``interface DrapePoint``
------------------------

.. CG-BLOCK id=interface:DrapePoint lines=95-100

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/seamDrape.ts
   :language: typescript
   :lines: 95-100
   :lineno-match:

.. CG-EXPLANATION-START id=interface:DrapePoint

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=interface:DrapePoint

``interface CoverEdges``
------------------------

.. CG-BLOCK id=interface:CoverEdges lines=101-106

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/seamDrape.ts
   :language: typescript
   :lines: 101-106
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CoverEdges

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=interface:CoverEdges

``interface ElevationRange``
----------------------------

.. CG-BLOCK id=interface:ElevationRange lines=107-112

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/seamDrape.ts
   :language: typescript
   :lines: 107-112
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ElevationRange

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=interface:ElevationRange

``interface SeamDrapeInput``
----------------------------

.. CG-BLOCK id=interface:SeamDrapeInput lines=113-130

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/seamDrape.ts
   :language: typescript
   :lines: 113-130
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SeamDrapeInput

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=interface:SeamDrapeInput

``interface SeamDrape``
-----------------------

.. CG-BLOCK id=interface:SeamDrape lines=131-140

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/seamDrape.ts
   :language: typescript
   :lines: 131-140
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SeamDrape

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=interface:SeamDrape

``interface SeamStep``
----------------------

.. CG-BLOCK id=interface:SeamStep lines=141-149

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/seamDrape.ts
   :language: typescript
   :lines: 141-149
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SeamStep

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=interface:SeamStep

``interface Segment``
---------------------

.. CG-BLOCK id=interface:Segment lines=150-157

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/seamDrape.ts
   :language: typescript
   :lines: 150-157
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Segment

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=interface:Segment

``interface CoverNotch``
------------------------

.. CG-BLOCK id=interface:CoverNotch lines=158-172

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/seamDrape.ts
   :language: typescript
   :lines: 158-172
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CoverNotch

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=interface:CoverNotch

``function seamDrapeOf``
------------------------

.. CG-BLOCK id=function:seamDrapeOf lines=173-201

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/seamDrape.ts
   :language: typescript
   :lines: 173-201
   :lineno-match:

.. CG-EXPLANATION-START id=function:seamDrapeOf

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:seamDrapeOf

``function drapeHolds``
-----------------------

.. CG-BLOCK id=function:drapeHolds lines=202-216

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/seamDrape.ts
   :language: typescript
   :lines: 202-216
   :lineno-match:

.. CG-EXPLANATION-START id=function:drapeHolds

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:drapeHolds

``function drapeFractionAt``
----------------------------

.. CG-BLOCK id=function:drapeFractionAt lines=217-239

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/seamDrape.ts
   :language: typescript
   :lines: 217-239
   :lineno-match:

.. CG-EXPLANATION-START id=function:drapeFractionAt

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:drapeFractionAt

``function seamSteps``
----------------------

.. CG-BLOCK id=function:seamSteps lines=240-313

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/seamDrape.ts
   :language: typescript
   :lines: 240-313
   :lineno-match:

.. CG-EXPLANATION-START id=function:seamSteps

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:seamSteps

``function coverNotches``
-------------------------

.. CG-BLOCK id=function:coverNotches lines=314-345

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/seamDrape.ts
   :language: typescript
   :lines: 314-345
   :lineno-match:

.. CG-EXPLANATION-START id=function:coverNotches

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:coverNotches

``function joinAcross``
-----------------------

.. CG-BLOCK id=function:joinAcross lines=346-379

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/seamDrape.ts
   :language: typescript
   :lines: 346-379
   :lineno-match:

.. CG-EXPLANATION-START id=function:joinAcross

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:joinAcross

