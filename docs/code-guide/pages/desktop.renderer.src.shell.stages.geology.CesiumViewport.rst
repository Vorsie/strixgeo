desktop.renderer.src.shell.stages.geology.CesiumViewport
========================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/geology/CesiumViewport.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/geology/CesiumViewport.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-32

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/CesiumViewport.tsx
   :language: tsx
   :lines: 1-32
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the single-viewport Cesium widget used by ``Geology3DViewer`` — one 3-D window onto the globe. Cesium is the 3-D globe library the geology viewers draw on; a widget is one such window with its own graphics context; a scene is the 3-D world inside it. It pulls in the shape-rebuild and camera-fly helpers from ``geology3DPrimitives.ts``, the camera-link and wheel-zoom hooks, and the on-demand-render helpers. Its docstring states that this component owns one viewport's whole Cesium lifecycle: creating the widget, swapping the basemap, rebuilding shapes, syncing the camera, and the split-line click interaction.

**Why it is here.** It was split out of the viewer (debt #201, round 2) so one file owns exactly one viewport's lifecycle; the viewer above composes one or two of these into single, split, or compare layouts. A component is a function that returns a piece of screen.

.. CG-EXPLANATION-END id=module-header

``interface CesiumViewportProps``
---------------------------------

.. CG-BLOCK id=interface:CesiumViewportProps lines=33-163

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/CesiumViewport.tsx
   :language: tsx
   :lines: 33-163
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CesiumViewportProps

**What this does.** Names every input the viewport accepts: the data (formations, their surfaces, the DEM ground surface, fence walls, body solids, investigation positions, the footprint ring), the split controls (a clipping plane, an invert flag, the drawn line), the many on/off toggles (basemap, ground surface, surfaces, confidence fade, wireframe), the fence-cutout-only overrides (lid transparency, lid footprint panels, wheel-zoom tuning), and the camera handles for compare mode. A prop is an input a parent hands a component; an ``interface`` names the shape of an object.

**Why it is here.** The comments record the load-bearing decisions: the camera is passed as a mutable handle (a ref), not React state, because it changes many times a second and routing it through the normal redraw path would repaint both panes on every mouse move; hidden bodies are a separate set from hidden formations because only the solid render carries body identity (fence walls are keyed by formation); and the cutout-only props default to absent so every shared 3-D stage stays byte-for-byte unchanged.

.. CG-EXPLANATION-END id=interface:CesiumViewportProps

``function CesiumViewport``
---------------------------

.. CG-BLOCK id=function:CesiumViewport lines=164-527

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/CesiumViewport.tsx
   :language: tsx
   :lines: 164-527
   :lineno-match:

.. CG-EXPLANATION-START id=function:CesiumViewport

**What this does.** The component itself — it draws one on-screen container and, in effects, manages the Cesium widget inside it. Its first effect creates the widget once on mount with on-demand rendering, a flat globe, anti-aliasing and deterministic transparency, and destroys it on unmount. Its second effect, on any data or toggle change, rebuilds all the shapes, wires the camera-reset callback, and flies the camera to frame the content — head-on to the cut face in split mode, an oblique fit otherwise — but only re-frames when the content set or the plane actually changes, not on a mere toggle. It also attaches the compare-mode camera link, the optional wheel-zoom tuning, and (only while a split is being drawn) a click handler that turns a scene click into a projected point. An effect runs after the screen is drawn; its cleanup runs on unmount.

**Why it is here.** Cesium is a lifecycle-driven, DOM-based library, so the component is deliberately imperative: React state says WHAT to show, and the effects create and mutate the widget to match. The comments justify the display choices — anti-aliasing and deterministic transparency exist because the split view stacks many near-parallel translucent layers that otherwise shimmer and sparkle; the flat globe uses the project elevations directly as heights; and every scene change explicitly asks for a redraw because on-demand rendering means nothing repaints on its own. The click handler falls back to the globe surface because on a flat globe a click off the surfaces returns nothing, which is why the split never registered before.

.. CG-EXPLANATION-END id=function:CesiumViewport

