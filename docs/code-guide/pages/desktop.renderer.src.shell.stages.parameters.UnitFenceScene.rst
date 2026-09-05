desktop.renderer.src.shell.stages.parameters.UnitFenceScene
===========================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/parameters/UnitFenceScene.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/parameters/UnitFenceScene.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-33

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitFenceScene.tsx
   :language: tsx
   :lines: 1-33
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file (the CesiumJS half of the fence cutout) and gathers everything the scene needs: React's hooks for effects, memoised values and element handles; the shared 3-D viewer component and its types; helpers that colour geotech walls, resolve a layer's body, choose which walls survive the cutout, compute the camera frame, and hold the cutout's tuning constants; plus the shell context that shares the active project and models. CesiumJS is the 3-D globe library that draws over a real-world basemap; a fence diagram stands the section walls up in that globe.

**Why it is here.** This module lives apart from its host so the host (``UnitFenceCutout``) can load it lazily — the heavy Cesium code and the per-section fence-edge fetches spin up only while a unit is actually scoped. The comment states the design contract: this is a PASSIVE embed — a chromeless single pane with no split, compare or legend, one reset-camera verb — and its walls are the SAME ``buildProjectFence`` panels the full 3-D stages draw, merely filtered down to the scoped unit and set over the same basemap.

.. CG-EXPLANATION-END id=module-header

``const NOOP_SPLIT_DRAWN``
--------------------------

.. CG-BLOCK id=const:NOOP_SPLIT_DRAWN lines=34-35

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitFenceScene.tsx
   :language: tsx
   :lines: 34-35
   :lineno-match:

.. CG-EXPLANATION-START id=const:NOOP_SPLIT_DRAWN

**What this does.** A do-nothing callback. The shared 3-D viewer requires a "a split plane was drawn" handler, but this passive cutout never lets the user cut the model, so this handler is supplied and simply ignores its arguments.

**Why it is here.** The viewer's contract demands the callback; a passive pane has nothing to do when a split is drawn because it never enters split mode, so an empty function satisfies the type without adding behaviour.

.. CG-EXPLANATION-END id=const:NOOP_SPLIT_DRAWN

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=36-55

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitFenceScene.tsx
   :language: tsx
   :lines: 36-55
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** Declares the one input — ``scope``, the typed unit whose walls to show — and documents that a litho scope cuts the lithology model's fence while a geotech scope cuts the geotechnical fence (which is framed inside the lithology). An interface names the shape of an object; ``props`` are the inputs a parent hands a component.

**Why it is here.** The scope alone decides both which model's fence to build and which walls to keep, so it is the only input the scene needs; every other input it reads from shared app state.

.. CG-EXPLANATION-END id=interface:Props

``function UnitFenceScene``
---------------------------

.. CG-BLOCK id=function:UnitFenceScene lines=56-246

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitFenceScene.tsx
   :language: tsx
   :lines: 56-246
   :lineno-match:

.. CG-EXPLANATION-START id=function:UnitFenceScene

**What this does.** The scene component. It reads the active lithology and geotechnical models, their layers and formations, and the project from shared state; decides from the scope whether this is a geotech or a litho view and picks that model's id. It builds a lookup from formation to NAD packing class (used to colour geotech walls), and asks the shared 3-D view-state hook to assemble the fence panels for the chosen model, forcing the viewer into "fence" mode with an effect — that switch is what actually triggers the lazy build. It then builds a map from each layer to its body, works out the scope's own bands through the single band authority (``bandsForScope``), and from those computes the cutout: the subset of wall panels that belong to the scoped unit. It also builds a synthetic eight-corner box spanning every wall so the camera can frame the whole model, and the colour roster (NAD colours for geotech, the plain formation colours for litho). Finally it renders one of four things: a quiet "no model yet" line, a loading state, a quiet "no walls" hint, or the chromeless Cesium viewer showing the filtered walls over a slightly see-through basemap, with a single reset-view button.

**Why it is here.** Every choice here serves the R4 ruling that the cutout is a bare visual aid — walls plus basemap, nothing else. The ground-surface lid is deliberately not drawn (ruling B6a): the walls and the map are the whole scene. The camera frames on the WHOLE fence's bounding box, not the filtered walls, because framing on a small scoped body lost all orientation (a tiny body became a chip of aerial photo floating at its own depth); an eight-corner box is a constant vertex count, so switching scope never re-flies the camera. The wall colours read the full formation roster because filtering the colour list would only break the colours. An empty result is shown as a quiet hint, never an error, because a unit can be perfectly real yet still have no accepted ties on any section, so no wall exists to draw yet.

.. CG-EXPLANATION-END id=function:UnitFenceScene

