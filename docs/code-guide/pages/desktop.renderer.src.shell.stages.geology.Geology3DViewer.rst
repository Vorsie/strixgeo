desktop.renderer.src.shell.stages.geology.Geology3DViewer
=========================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/geology/Geology3DViewer.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/geology/Geology3DViewer.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-85

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/Geology3DViewer.tsx
   :language: tsx
   :lines: 1-85
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the top-level 3-D geology viewer — the component the Stratigraphy stage's ``GeologyCanvas`` mounts, able to show one viewport or two side by side. Cesium is the 3-D globe library it draws on. Its long notes record the build wiring (how Cesium is bundled and its worker assets copied, that no cloud token is used, that a flat globe is used) and the split-view design: two independent Cesium widgets, each clipped to one half of a user-drawn plane, with the split line kept session-only — never saved to the project file, never tied to a cross-section. It also notes that when offline the basemap tiles fail and the globe goes black while the surfaces still draw correctly. A component is a function that returns a piece of screen.

**Why it is here.** The design notes are kept because they are the reasons a future reader would otherwise re-litigate — why a Cesium bundling plugin is NOT used (a Windows path bug and a file-protocol clash under Electron), why the split plane is deliberately throwaway, and why the black offline globe is known degradation rather than a bug.

.. CG-EXPLANATION-END id=module-header

``interface Geology3DViewerProps``
----------------------------------

.. CG-BLOCK id=interface:Geology3DViewerProps lines=86-274

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/Geology3DViewer.tsx
   :language: tsx
   :lines: 86-274
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Geology3DViewerProps

**What this does.** Names every input the viewer takes: the split mode and plane, the formations and their surfaces, the DEM ground surface, the starting basemap and the project coordinate system, a callback fired when the user finishes drawing a split line, a camera-reset handle, the fence walls, the body solids with their wireframe / confidence / investigation inputs, the footprint ring, the fence-cutout-only overrides, the compare-mode counterpart scene, and a ``chromeless`` flag that hides all the overlay controls. A prop is an input a parent hands a component.

**Why it is here.** The comments capture the intent: the geology callers pass no fence panels, so their behaviour is unchanged; body solids must be passed as a stable value, not a fresh array each render, or the rebuild fires every render; the footprint ring is what makes the model ends here read as an edge rather than a gap; and ``chromeless`` exists for the passive Parameters fence-cutout embed (owner ruling R4, 2026-08-27), which is a visual aid with no verbs and no split.

.. CG-EXPLANATION-END id=interface:Geology3DViewerProps

``function Geology3DViewer``
----------------------------

.. CG-BLOCK id=function:Geology3DViewer lines=275-819

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/Geology3DViewer.tsx
   :language: tsx
   :lines: 275-819
   :lineno-match:

.. CG-EXPLANATION-START id=function:Geology3DViewer

**What this does.** The component. It holds the view-only state — the chosen basemap (read from the same saved key as the 2-D map), the split-line drawing progress, the per-formation and per-body hide sets, the basemap / ground-surface / surfaces toggles, and whether split-drawing is armed — and it computes the daylight caption and the legend shape (a flat list for the geology and litho panes, a nested soil then NAD-class then body tree for the subdivided geotech model). It lays out one ``CesiumViewport`` in single view, or two half-width ones for a cut split or a model comparison, wires the two-click split-line flow, and draws the overlay chrome: the basemap picker, the layer legend, the offline banner, the compare-pane labels, and the split / compare / single-view buttons — all hidden when ``chromeless``.

**Why it is here.** State here is view chrome — session-only, never persisted, exactly like the basemap pick — because hiding a layer or drawing a split is a reversible view choice, not an engineering decision that belongs in the project file. The geotech model gets the nested tree because subdividing every litho unit into packing classes would otherwise make dozens of identical-text rows. The comments record the careful bits: bulk-hiding a whole family in one state write (a per-id loop would queue stale updates); one Single-view button closes both split kinds so the user never has to know which is open; and Compare is offered only when the counterpart would actually paint something, since a button that opens a blank pane reads as a broken viewer.

.. CG-EXPLANATION-END id=function:Geology3DViewer

