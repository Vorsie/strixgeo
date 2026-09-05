desktop.renderer.src.shell.stages.geology.useViewportZoomTuning
===============================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/geology/useViewportZoomTuning.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/geology/useViewportZoomTuning.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-12

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/useViewportZoomTuning.ts
   :language: typescript
   :lines: 1-12
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the file that adjusts how the mouse wheel zooms one 3-D viewport. Its note records that it is its own file so the ``CesiumViewport`` component does not keep growing (debt #201), and that ONLY the Parameters-stage fence cutout ever passes a tuning — with none supplied the logic does nothing at all, so every shared 3-D stage keeps Cesium's stock zoom behaviour byte-for-byte.

**Why it is here.** The fence cutout is a small chromeless globe where the default wheel step feels too coarse, so it wants a finer zoom; the shared stages must stay untouched, which is why the tuning is opt-in rather than global.

.. CG-EXPLANATION-END id=module-header

``interface ViewportZoomTuning``
--------------------------------

.. CG-BLOCK id=interface:ViewportZoomTuning lines=13-48

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/useViewportZoomTuning.ts
   :language: typescript
   :lines: 13-48
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ViewportZoomTuning

**What this does.** Names the three dials a caller can set — ``zoomFactor`` (how aggressively the plain wheel zooms; Cesium's default is 5), ``minimumZoomDistanceM`` (how close in metres the camera may get; default 1), and ``fineZoomFraction`` (the CTRL+wheel fine step, as a fraction of camera height per notch). The block also carries the hook's docstring, which describes the two zoom mechanisms.

**Why it is here.** Making the tuning an explicit named shape lets it be mirrored on the viewport's inputs and lets the one caller that needs a different feel override it without any other stage inheriting the change.

.. CG-EXPLANATION-END id=interface:ViewportZoomTuning

``function useViewportZoomTuning``
----------------------------------

.. CG-BLOCK id=function:useViewportZoomTuning lines=49-83

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/useViewportZoomTuning.ts
   :language: typescript
   :lines: 49-83
   :lineno-match:

.. CG-EXPLANATION-START id=function:useViewportZoomTuning

**What this does.** The hook that applies a tuning to one mounted scene (a hook is a reusable ``use…`` function that taps a React feature; an effect runs after the screen is drawn). When a tuning is present its effect lowers the controller's plain-wheel zoom factor and minimum distance, then binds CTRL+wheel as a separate FINE zoom: each notch moves the camera in or out by a fraction of its height above the globe (never below the minimum distance) and asks for a redraw, because that programmatic move is not routed through Cesium's own controller. On unmount it destroys the extra input handler unless the widget already tore it down.

**Why it is here.** The fine zoom is deliberately a separate handler, not another entry in the controller's zoom list, because the controller applies ONE shared factor to every entry — routing CTRL through it could never be finer, and registering it twice would double-fire each notch. Sizing the step to the camera's own height makes it shrink as you approach the ground instead of punching through it.

.. CG-EXPLANATION-END id=function:useViewportZoomTuning

