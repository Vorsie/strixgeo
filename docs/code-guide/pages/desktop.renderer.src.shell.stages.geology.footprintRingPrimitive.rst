desktop.renderer.src.shell.stages.geology.footprintRingPrimitive
================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/geology/footprintRingPrimitive.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/geology/footprintRingPrimitive.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-20

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/footprintRingPrimitive.ts
   :language: typescript
   :lines: 1-20
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the file that draws the model's footprint ring — the outline, in plan, of where the 3-D model stops — as one Cesium primitive. Cesium is the 3-D globe library; a primitive is one drawable object handed to it. It imports only the coordinate converter. Its notes state that the ring is a separate file rather than a nineteenth builder inside the huge ``geology3DPrimitives.ts`` (debt #201) because it shares none of that file's machinery, and that the outline polygon is NOT computed here or anywhere in the renderer: it comes from the backend, which replays the saved build through the same alpha hull the build clipped to.

**Why it is here.** Keeping the ring out of the giant primitives file avoids adding mass to the file the god-component check already flags. Keeping the outline server-computed means the ring matches exactly the hull the model was actually built to, so a hull-trimmed edge reads as the model ending here rather than as a gap the interpretation deliberately left open.

.. CG-EXPLANATION-END id=module-header

``const FOOTPRINT_RING_WIDTH_PX``
---------------------------------

.. CG-BLOCK id=const:FOOTPRINT_RING_WIDTH_PX lines=21-25

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/footprintRingPrimitive.ts
   :language: typescript
   :lines: 21-25
   :lineno-match:

.. CG-EXPLANATION-START id=const:FOOTPRINT_RING_WIDTH_PX

**What this does.** Holds the on-screen width of the ring: two pixels.

**Why it is here.** Two pixels reads as a deliberate boundary at every camera distance the viewer uses while staying thinner than any modelled contact — the ring annotates the model, it must never compete with it — and one pixel would disappear against a busy orthophoto backdrop.

.. CG-EXPLANATION-END id=const:FOOTPRINT_RING_WIDTH_PX

``const FOOTPRINT_RING_COLOR``
------------------------------

.. CG-BLOCK id=const:FOOTPRINT_RING_COLOR lines=26-54

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/footprintRingPrimitive.ts
   :language: typescript
   :lines: 26-54
   :lineno-match:

.. CG-EXPLANATION-START id=const:FOOTPRINT_RING_COLOR

**What this does.** Holds the ring's colour: a desaturated slate-grey at partial transparency. The block also carries the following builder's docstring, which explains why the ring is drawn as a real polyline and why it is never clipped in split view.

**Why it is here.** The colour is deliberately NOT one of the formation-palette hues: the ring is chrome that marks where the model ends, and a saturated colour would read as one more soil unit.

.. CG-EXPLANATION-END id=const:FOOTPRINT_RING_COLOR

``function buildFootprintRingPrimitive``
----------------------------------------

.. CG-BLOCK id=function:buildFootprintRingPrimitive lines=55-84

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/footprintRingPrimitive.ts
   :language: typescript
   :lines: 55-84
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildFootprintRingPrimitive

**What this does.** Builds the closed line-loop primitive for the footprint ring. Given the ring's corner points in the project's coordinate system, it converts each to a globe position at its own elevation and returns a Cesium polyline primitive in the given colour; a ring with fewer than two points draws nothing (returns ``null``).

**Why it is here.** It uses Cesium's polyline, which draws a real screen-space width, rather than a raw line mesh, because WebGL's native line width is clamped to one pixel on every desktop graphics driver the app targets, and a one-pixel hairline is invisible over the orthophoto. WebGL is the browser's low-level link to the graphics card. It also uses the special colour vertex format the chosen line appearance needs, or the ring would silently render untinted. The ring is deliberately left unclipped in split view — it states the whole model's extent, which does not change because the scene was cut in half.

.. CG-EXPLANATION-END id=function:buildFootprintRingPrimitive

