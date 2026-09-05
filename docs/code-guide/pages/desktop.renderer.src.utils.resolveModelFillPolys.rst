desktop.renderer.src.utils.resolveModelFillPolys
================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/resolveModelFillPolys.ts complete=false

*Source file:* ``desktop/src/renderer/src/utils/resolveModelFillPolys.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-70

.. literalinclude:: ../../../desktop/src/renderer/src/utils/resolveModelFillPolys.ts
   :language: typescript
   :lines: 1-70
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=module-header

``const RESOLVE_TOLERANCE_M``
-----------------------------

.. CG-BLOCK id=const:RESOLVE_TOLERANCE_M lines=71-73

.. literalinclude:: ../../../desktop/src/renderer/src/utils/resolveModelFillPolys.ts
   :language: typescript
   :lines: 71-73
   :lineno-match:

.. CG-EXPLANATION-START id=const:RESOLVE_TOLERANCE_M

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:RESOLVE_TOLERANCE_M

``const MIN_VISIBLE_AREA``
--------------------------

.. CG-BLOCK id=const:MIN_VISIBLE_AREA lines=74-78

.. literalinclude:: ../../../desktop/src/renderer/src/utils/resolveModelFillPolys.ts
   :language: typescript
   :lines: 74-78
   :lineno-match:

.. CG-EXPLANATION-START id=const:MIN_VISIBLE_AREA

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:MIN_VISIBLE_AREA

``const PRECISION``
-------------------

.. CG-BLOCK id=const:PRECISION lines=79-79

.. literalinclude:: ../../../desktop/src/renderer/src/utils/resolveModelFillPolys.ts
   :language: typescript
   :lines: 79-79
   :lineno-match:

.. CG-EXPLANATION-START id=const:PRECISION

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:PRECISION

``const GF``
------------

.. CG-BLOCK id=const:GF lines=80-87

.. literalinclude:: ../../../desktop/src/renderer/src/utils/resolveModelFillPolys.ts
   :language: typescript
   :lines: 80-87
   :lineno-match:

.. CG-EXPLANATION-START id=const:GF

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:GF

``interface JstsRing``
----------------------

.. CG-BLOCK id=interface:JstsRing lines=88-92

.. literalinclude:: ../../../desktop/src/renderer/src/utils/resolveModelFillPolys.ts
   :language: typescript
   :lines: 88-92
   :lineno-match:

.. CG-EXPLANATION-START id=interface:JstsRing

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=interface:JstsRing

``interface JstsList``
----------------------

.. CG-BLOCK id=interface:JstsList lines=93-97

.. literalinclude:: ../../../desktop/src/renderer/src/utils/resolveModelFillPolys.ts
   :language: typescript
   :lines: 93-97
   :lineno-match:

.. CG-EXPLANATION-START id=interface:JstsList

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=interface:JstsList

``interface JstsGeometry``
--------------------------

.. CG-BLOCK id=interface:JstsGeometry lines=98-125

.. literalinclude:: ../../../desktop/src/renderer/src/utils/resolveModelFillPolys.ts
   :language: typescript
   :lines: 98-125
   :lineno-match:

.. CG-EXPLANATION-START id=interface:JstsGeometry

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=interface:JstsGeometry

``interface RankedPoly``
------------------------

.. CG-BLOCK id=interface:RankedPoly lines=126-132

.. literalinclude:: ../../../desktop/src/renderer/src/utils/resolveModelFillPolys.ts
   :language: typescript
   :lines: 126-132
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RankedPoly

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=interface:RankedPoly

``function verticalExtent``
---------------------------

.. CG-BLOCK id=function:verticalExtent lines=133-143

.. literalinclude:: ../../../desktop/src/renderer/src/utils/resolveModelFillPolys.ts
   :language: typescript
   :lines: 133-143
   :lineno-match:

.. CG-EXPLANATION-START id=function:verticalExtent

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:verticalExtent

``function ringAreaPoints``
---------------------------

.. CG-BLOCK id=function:ringAreaPoints lines=144-152

.. literalinclude:: ../../../desktop/src/renderer/src/utils/resolveModelFillPolys.ts
   :language: typescript
   :lines: 144-152
   :lineno-match:

.. CG-EXPLANATION-START id=function:ringAreaPoints

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:ringAreaPoints

``function ringArea``
---------------------

.. CG-BLOCK id=function:ringArea lines=153-160

.. literalinclude:: ../../../desktop/src/renderer/src/utils/resolveModelFillPolys.ts
   :language: typescript
   :lines: 153-160
   :lineno-match:

.. CG-EXPLANATION-START id=function:ringArea

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:ringArea

``function comparePriority``
----------------------------

.. CG-BLOCK id=function:comparePriority lines=161-176

.. literalinclude:: ../../../desktop/src/renderer/src/utils/resolveModelFillPolys.ts
   :language: typescript
   :lines: 161-176
   :lineno-match:

.. CG-EXPLANATION-START id=function:comparePriority

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:comparePriority

``function ringContains``
-------------------------

.. CG-BLOCK id=function:ringContains lines=177-189

.. literalinclude:: ../../../desktop/src/renderer/src/utils/resolveModelFillPolys.ts
   :language: typescript
   :lines: 177-189
   :lineno-match:

.. CG-EXPLANATION-START id=function:ringContains

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:ringContains

``function ringToLine``
-----------------------

.. CG-BLOCK id=function:ringToLine lines=190-231

.. literalinclude:: ../../../desktop/src/renderer/src/utils/resolveModelFillPolys.ts
   :language: typescript
   :lines: 190-231
   :lineno-match:

.. CG-EXPLANATION-START id=function:ringToLine

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:ringToLine

``function toJsts``
-------------------

.. CG-BLOCK id=function:toJsts lines=232-271

.. literalinclude:: ../../../desktop/src/renderer/src/utils/resolveModelFillPolys.ts
   :language: typescript
   :lines: 232-271
   :lineno-match:

.. CG-EXPLANATION-START id=function:toJsts

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:toJsts

``function ringToPoints``
-------------------------

.. CG-BLOCK id=function:ringToPoints lines=272-295

.. literalinclude:: ../../../desktop/src/renderer/src/utils/resolveModelFillPolys.ts
   :language: typescript
   :lines: 272-295
   :lineno-match:

.. CG-EXPLANATION-START id=function:ringToPoints

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:ringToPoints

``function fromJsts``
---------------------

.. CG-BLOCK id=function:fromJsts lines=296-353

.. literalinclude:: ../../../desktop/src/renderer/src/utils/resolveModelFillPolys.ts
   :language: typescript
   :lines: 296-353
   :lineno-match:

.. CG-EXPLANATION-START id=function:fromJsts

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:fromJsts

``function resolveModelFillPolys``
----------------------------------

.. CG-BLOCK id=function:resolveModelFillPolys lines=354-395

.. literalinclude:: ../../../desktop/src/renderer/src/utils/resolveModelFillPolys.ts
   :language: typescript
   :lines: 354-395
   :lineno-match:

.. CG-EXPLANATION-START id=function:resolveModelFillPolys

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:resolveModelFillPolys

