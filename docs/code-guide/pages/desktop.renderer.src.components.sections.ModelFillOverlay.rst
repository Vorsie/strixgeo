desktop.renderer.src.components.sections.ModelFillOverlay
=========================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/ModelFillOverlay.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/ModelFillOverlay.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-88

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ModelFillOverlay.tsx
   :language: tsx
   :lines: 1-88
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the overlay that fills the litho cross-section with body-coloured bands taken from the built 3-D solid model. The docstring describes its two drawing modes: Mode A takes vertical column samples of the body meshes at each test and joins same-body neighbours into a band; Mode B takes ready-made closed polygons from slicing the solids along the section plane and draws each as one filled shape, punching holes where a higher-priority body is enclosed. It imports React's state hook, the solid-column and section-polygon data types, the distance-fade helper, and the shared unit-statistics menu.

**Why it is here.** The docstring records the design contract, including owner ruling S6 of 27 August 2026 that a right-click on a model-fill region must offer the same 'Unit statistics' jump the ordinary fill offers. It also states the load-bearing rule that every horizontal position must go through the warp-aware screen transform, never the raw along-section distance, because a user-adjustable column spacing warps the horizontal axis.

.. CG-EXPLANATION-END id=module-header

``interface ModelFillOverlayProps``
-----------------------------------

.. CG-BLOCK id=interface:ModelFillOverlayProps lines=89-120

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ModelFillOverlay.tsx
   :language: tsx
   :lines: 89-120
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ModelFillOverlayProps

**What this does.** The named shape (an interface — a TypeScript description of what data must look like) of the inputs this overlay takes: the Mode-A columns or Mode-B polygons, the warp-aware along-to-screen and elevation-to-screen transforms, the fill opacity, an optional per-test column layout, a strip width, the confidence-fade switch and its inputs, and the optional right-click statistics handler.

**Why it is here.** The comments pin down each field's role, notably that the statistics handler's body id comes from the built solid's own stamp — and that the voxel build's alias pass can weld several resolver bodies into one mesh under a single representative id, so the reported body is real but may not cover the whole painted area (the deliberate asymmetry in the body-model design note). When the handler is absent every element stays pointer-inert, byte-identical to the earlier render.

.. CG-EXPLANATION-END id=interface:ModelFillOverlayProps

``function fadeMultiplier``
---------------------------

.. CG-BLOCK id=function:fadeMultiplier lines=121-143

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ModelFillOverlay.tsx
   :language: tsx
   :lines: 121-143
   :lineno-match:

.. CG-EXPLANATION-START id=function:fadeMultiplier

**What this does.** A small helper that returns an opacity multiplier for one fill element: 1 when fade is off, otherwise a value that shrinks with the along-section distance from the element to the nearest investigation.

**Why it is here.** It mirrors the geology surface confidence fade — fill sitting far from any real data reads as interpolated by fading, so the engineer is not misled into trusting a band drawn across a wide data gap.

.. CG-EXPLANATION-END id=function:fadeMultiplier

``const DEFAULT_TEST_STRIP_WIDTH_PX``
-------------------------------------

.. CG-BLOCK id=const:DEFAULT_TEST_STRIP_WIDTH_PX lines=144-151

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ModelFillOverlay.tsx
   :language: tsx
   :lines: 144-151
   :lineno-match:

.. CG-EXPLANATION-START id=const:DEFAULT_TEST_STRIP_WIDTH_PX

**What this does.** The default pixel width of a Mode-A per-test strip, 14 px.

**Why it is here.** The docstring explains it is a fixed-pixel point-sample marker meaning 'the model sampled at THIS data location', not a lateral extent between tests, so a fixed screen width is correct rather than a warped along-metre width.

.. CG-EXPLANATION-END id=const:DEFAULT_TEST_STRIP_WIDTH_PX

``function ringSubpath``
------------------------

.. CG-BLOCK id=function:ringSubpath lines=152-184

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ModelFillOverlay.tsx
   :language: tsx
   :lines: 152-184
   :lineno-match:

.. CG-EXPLANATION-START id=function:ringSubpath

**What this does.** Builds the SVG path string for one closed ring of along-metre and elevation point pairs, moving to the first point and drawing lines to the rest before closing. A path is an SVG shape written as a string of move and line commands; it returns an empty string for a ring of fewer than three points.

**Why it is here.** Both drawing modes need the same 'turn a ring of world coordinates into a screen path' step, so it is written once and reused, always through the warp-aware transforms.

.. CG-EXPLANATION-END id=function:ringSubpath

``function buildPolyPath``
--------------------------

.. CG-BLOCK id=function:buildPolyPath lines=185-206

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ModelFillOverlay.tsx
   :language: tsx
   :lines: 185-206
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildPolyPath

**What this does.** Builds the full SVG path for a Mode-B polygon: the outer ring first, then each hole ring appended as its own closed subpath.

**Why it is here.** Combined with the even-odd fill rule set on the shape, the appended hole rings become transparent, so an enclosed higher-priority body — a clay lens inside a sand slab — shows through instead of being covered by a solid fill. A polygon with no holes renders exactly as a single filled outline.

.. CG-EXPLANATION-END id=function:buildPolyPath

``function ModelFillOverlay``
-----------------------------

.. CG-BLOCK id=function:ModelFillOverlay lines=207-343

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ModelFillOverlay.tsx
   :language: tsx
   :lines: 207-343
   :lineno-match:

.. CG-EXPLANATION-START id=function:ModelFillOverlay

**What this does.** The component. It first declares the right-click menu state and a shared gesture helper (so the menu code lives above the mode branches, because a hook may never sit below a conditional return). If Mode-B polygons are supplied it draws each as one filled path with holes punched out and fades by the polygon's centroid distance; otherwise, in Mode A, it draws each test's sampled stack as vertical rectangles spanning the whole investigation column, drawing every segment with no between-test interpolation; when neither is supplied it returns an empty group.

**Why it is here.** The comments record the details: the key on each polygon uses its index because one body can slice into more than one loop (it pinches out and reappears), while the testid stays keyed on the body id so a body is addressable as a whole. Mode A deliberately draws every segment with no minimum-column rule so a body seen at a single test is not dropped, letting the model sit exactly on the borehole's litho band for a direct ground-truth check. The right-click statistics jump is owner ruling S6 of 27 August 2026.

.. CG-EXPLANATION-END id=function:ModelFillOverlay

