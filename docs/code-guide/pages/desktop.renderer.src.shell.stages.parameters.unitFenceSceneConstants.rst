desktop.renderer.src.shell.stages.parameters.unitFenceSceneConstants
====================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/parameters/unitFenceSceneConstants.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/parameters/unitFenceSceneConstants.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-12

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/unitFenceSceneConstants.ts
   :language: typescript
   :lines: 1-12
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the file that holds the fence cutout's scene-dressing numbers, and begins with the documentation for the first of them — the transparency of the basemap "lid" (the aerial-photo overlay draped over the ground) in the cutout's own viewer.

**Why it is here.** These constants live in a separate CesiumJS-free module so other code (the map pins) can read them without pulling in the heavy 3-D viewer. The documentation records owner ruling B6b (2026-08-27), "make the basemap a bit more see-through, like 5%": the shared 3-D stages draw that overlay at 0.65 opacity, so "a bit more see-through" means a value below 0.65, and a literal 95% reading would have made it more opaque — the opposite of the ask.

.. CG-EXPLANATION-END id=module-header

``const UNIT_FENCE_BASEMAP_LID_ALPHA``
--------------------------------------

.. CG-BLOCK id=const:UNIT_FENCE_BASEMAP_LID_ALPHA lines=13-30

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/unitFenceSceneConstants.ts
   :language: typescript
   :lines: 13-30
   :lineno-match:

.. CG-EXPLANATION-START id=const:UNIT_FENCE_BASEMAP_LID_ALPHA

**What this does.** Sets the basemap-overlay opacity for the cutout's viewer to 0.6. The lines that follow are the documentation for the next constant, the wheel-zoom tuning.

**Why it is here.** 0.6 is five percent more see-through than the shared 3-D stages' 0.65 default, which is exactly what owner ruling B6b asked for. This dial moves the cutout alone; the shared stages keep their own default.

.. CG-EXPLANATION-END id=const:UNIT_FENCE_BASEMAP_LID_ALPHA

``const UNIT_FENCE_ZOOM_TUNING``
--------------------------------

.. CG-BLOCK id=const:UNIT_FENCE_ZOOM_TUNING lines=31-35

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/unitFenceSceneConstants.ts
   :language: typescript
   :lines: 31-35
   :lineno-match:

.. CG-EXPLANATION-START id=const:UNIT_FENCE_ZOOM_TUNING

**What this does.** Holds three wheel-zoom knobs for the cutout only: a ``zoomFactor`` of 2 (how far one wheel notch travels), a ``minimumZoomDistanceM`` of 5 metres (how close the camera may get), and a ``fineZoomFraction`` of 0.05 (the Ctrl+wheel fine step, five percent of the camera height per notch).

**Why it is here.** The cutout is the shortest canvas in the app, so Cesium's default zoom factor of 5 crossed most of the scene in a single notch; halving it to 2 keeps the same feel at less than half the stride. The 5-metre floor stops the camera diving inside a wall and clipping through it, while staying close enough to read a band. The fine step gives a gentle Ctrl+wheel adjustment. The shared 3-D stages never pass this, so they keep every Cesium default.

.. CG-EXPLANATION-END id=const:UNIT_FENCE_ZOOM_TUNING

