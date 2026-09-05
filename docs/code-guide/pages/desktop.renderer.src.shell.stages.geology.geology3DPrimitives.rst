desktop.renderer.src.shell.stages.geology.geology3DPrimitives
=============================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts complete=false

*Source file:* ``desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-54

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 1-54
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=module-header

``const Z_OFFSET_PER_ORDER``
----------------------------

.. CG-BLOCK id=const:Z_OFFSET_PER_ORDER lines=55-62

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 55-62
   :lineno-match:

.. CG-EXPLANATION-START id=const:Z_OFFSET_PER_ORDER

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:Z_OFFSET_PER_ORDER

``const DEFAULT_BASEMAP_LID_ALPHA``
-----------------------------------

.. CG-BLOCK id=const:DEFAULT_BASEMAP_LID_ALPHA lines=63-70

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 63-70
   :lineno-match:

.. CG-EXPLANATION-START id=const:DEFAULT_BASEMAP_LID_ALPHA

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:DEFAULT_BASEMAP_LID_ALPHA

``const SURFACE_CLIP_INSET_M``
------------------------------

.. CG-BLOCK id=const:SURFACE_CLIP_INSET_M lines=71-73

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 71-73
   :lineno-match:

.. CG-EXPLANATION-START id=const:SURFACE_CLIP_INSET_M

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:SURFACE_CLIP_INSET_M

``const ALPHA_FRESH``
---------------------

.. CG-BLOCK id=const:ALPHA_FRESH lines=74-76

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 74-76
   :lineno-match:

.. CG-EXPLANATION-START id=const:ALPHA_FRESH

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:ALPHA_FRESH

``const ALPHA_STALE``
---------------------

.. CG-BLOCK id=const:ALPHA_STALE lines=77-80

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 77-80
   :lineno-match:

.. CG-EXPLANATION-START id=const:ALPHA_STALE

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:ALPHA_STALE

``const MIN_SPLIT_LINE_M``
--------------------------

.. CG-BLOCK id=const:MIN_SPLIT_LINE_M lines=81-84

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 81-84
   :lineno-match:

.. CG-EXPLANATION-START id=const:MIN_SPLIT_LINE_M

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:MIN_SPLIT_LINE_M

``const ALPHA_GROUND_SURFACE``
------------------------------

.. CG-BLOCK id=const:ALPHA_GROUND_SURFACE lines=85-87

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 85-87
   :lineno-match:

.. CG-EXPLANATION-START id=const:ALPHA_GROUND_SURFACE

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:ALPHA_GROUND_SURFACE

``const GROUND_SURFACE_COLOR``
------------------------------

.. CG-BLOCK id=const:GROUND_SURFACE_COLOR lines=88-93

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 88-93
   :lineno-match:

.. CG-EXPLANATION-START id=const:GROUND_SURFACE_COLOR

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:GROUND_SURFACE_COLOR

``const FLAGGED_SOLID_ALPHA``
-----------------------------

.. CG-BLOCK id=const:FLAGGED_SOLID_ALPHA lines=94-105

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 94-105
   :lineno-match:

.. CG-EXPLANATION-START id=const:FLAGGED_SOLID_ALPHA

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:FLAGGED_SOLID_ALPHA

``interface BasemapLid``
------------------------

.. CG-BLOCK id=interface:BasemapLid lines=106-131

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 106-131
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BasemapLid

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=interface:BasemapLid

``function buildBasemapLid``
----------------------------

.. CG-BLOCK id=function:buildBasemapLid lines=132-158

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 132-158
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildBasemapLid

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:buildBasemapLid

``function flyToBounds``
------------------------

.. CG-BLOCK id=function:flyToBounds lines=159-197

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 159-197
   :lineno-match:

.. CG-EXPLANATION-START id=function:flyToBounds

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:flyToBounds

``interface SplitLine``
-----------------------

.. CG-BLOCK id=interface:SplitLine lines=198-210

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 198-210
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SplitLine

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=interface:SplitLine

``function flyToCutFace``
-------------------------

.. CG-BLOCK id=function:flyToCutFace lines=211-302

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 211-302
   :lineno-match:

.. CG-EXPLANATION-START id=function:flyToCutFace

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:flyToCutFace

``function buildCapPrimitives``
-------------------------------

.. CG-BLOCK id=function:buildCapPrimitives lines=303-460

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 303-460
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildCapPrimitives

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:buildCapPrimitives

``function hexToCesiumColor``
-----------------------------

.. CG-BLOCK id=function:hexToCesiumColor lines=461-491

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 461-491
   :lineno-match:

.. CG-EXPLANATION-START id=function:hexToCesiumColor

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:hexToCesiumColor

``function buildMeshBuffers``
-----------------------------

.. CG-BLOCK id=function:buildMeshBuffers lines=492-567

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 492-567
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildMeshBuffers

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:buildMeshBuffers

``function makeMeshGeometry``
-----------------------------

.. CG-BLOCK id=function:makeMeshGeometry lines=568-605

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 568-605
   :lineno-match:

.. CG-EXPLANATION-START id=function:makeMeshGeometry

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:makeMeshGeometry

``function makeColorPrimitive``
-------------------------------

.. CG-BLOCK id=function:makeColorPrimitive lines=606-643

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 606-643
   :lineno-match:

.. CG-EXPLANATION-START id=function:makeColorPrimitive

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:makeColorPrimitive

``function buildTinPrimitive``
------------------------------

.. CG-BLOCK id=function:buildTinPrimitive lines=644-700

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 644-700
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildTinPrimitive

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:buildTinPrimitive

``function buildFencePrimitive``
--------------------------------

.. CG-BLOCK id=function:buildFencePrimitive lines=701-798

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 701-798
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildFencePrimitive

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:buildFencePrimitive

``function buildSolidPrimitive``
--------------------------------

.. CG-BLOCK id=function:buildSolidPrimitive lines=799-904

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 799-904
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildSolidPrimitive

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:buildSolidPrimitive

``function buildSolidCapPrimitive``
-----------------------------------

.. CG-BLOCK id=function:buildSolidCapPrimitive lines=905-986

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 905-986
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildSolidCapPrimitive

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:buildSolidCapPrimitive

``const _vertexColorAppearanceVS``
----------------------------------

.. CG-BLOCK id=const:_vertexColorAppearanceVS lines=987-999

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 987-999
   :lineno-match:

.. CG-EXPLANATION-START id=const:_vertexColorAppearanceVS

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:_vertexColorAppearanceVS

``const _vertexColorAppearanceFS``
----------------------------------

.. CG-BLOCK id=const:_vertexColorAppearanceFS lines=1000-1006

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 1000-1006
   :lineno-match:

.. CG-EXPLANATION-START id=const:_vertexColorAppearanceFS

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:_vertexColorAppearanceFS

``function makeVertexColorAppearance``
--------------------------------------

.. CG-BLOCK id=function:makeVertexColorAppearance lines=1007-1038

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 1007-1038
   :lineno-match:

.. CG-EXPLANATION-START id=function:makeVertexColorAppearance

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:makeVertexColorAppearance

``function buildTinPrimitiveWithVertexColor``
---------------------------------------------

.. CG-BLOCK id=function:buildTinPrimitiveWithVertexColor lines=1039-1184

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 1039-1184
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildTinPrimitiveWithVertexColor

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:buildTinPrimitiveWithVertexColor

``function rebuildSurfacePrimitives``
-------------------------------------

.. CG-BLOCK id=function:rebuildSurfacePrimitives lines=1185-1653

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 1185-1653
   :lineno-match:

.. CG-EXPLANATION-START id=function:rebuildSurfacePrimitives

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:rebuildSurfacePrimitives

``type DrawState``
------------------

.. CG-BLOCK id=type:DrawState lines=1654-1676

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 1654-1676
   :lineno-match:

.. CG-EXPLANATION-START id=type:DrawState

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=type:DrawState

``function computeSplitPlane``
------------------------------

.. CG-BLOCK id=function:computeSplitPlane lines=1677-1713

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 1677-1713
   :lineno-match:

.. CG-EXPLANATION-START id=function:computeSplitPlane

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:computeSplitPlane

