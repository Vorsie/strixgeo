desktop.renderer.src.shell.stages.parameters.unitFenceFrame
===========================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/parameters/unitFenceFrame.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/parameters/unitFenceFrame.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-26

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/unitFenceFrame.ts
   :language: typescript
   :lines: 1-26
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file (the cutout's synthetic camera-frame geometry) and documents the one function it exports. It imports only the fence-panel type — no CesiumJS — so the maths is pure and can be tested on its own. A fence panel is one wall of the fence, described by its 3-D corner points.

**Why it is here.** Kept pure and Cesium-free so it can be checked under the test runner without spinning up a 3-D globe. It exists because the cutout's camera needs something to frame on, and the comment explains the trap it avoids: framing on the FILTERED walls lost all orientation — a small body shrank to a chip of aerial photo, a deep unit floated the photo at its own top.

.. CG-EXPLANATION-END id=module-header

``function fenceFrameCorners``
------------------------------

.. CG-BLOCK id=function:fenceFrameCorners lines=27-59

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/unitFenceFrame.ts
   :language: typescript
   :lines: 27-59
   :lineno-match:

.. CG-EXPLANATION-START id=function:fenceFrameCorners

**What this does.** Walks every corner of every fence panel, tracks the smallest and largest x, y and z seen, and returns the eight corners of the box that just contains them all — or nothing when there are no vertices at all.

**Why it is here.** These eight corners bound the WHOLE fence, so the camera's framing sphere holds every wall and a small scoped body keeps its surroundings for context. The output is always eight points no matter how many panels there are, which keeps the viewer's "has the geometry changed" key constant across scope changes — so switching from one unit to another never makes the camera fly to a new position; the frame already covers the whole model.

.. CG-EXPLANATION-END id=function:fenceFrameCorners

