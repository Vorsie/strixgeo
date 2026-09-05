desktop.renderer.src.shell.stages.parameters.UnitFenceCutout
============================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/parameters/UnitFenceCutout.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/parameters/UnitFenceCutout.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-15

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitFenceCutout.tsx
   :language: tsx
   :lines: 1-15
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file (the fence-diagram cutout for the unit the engineer has scoped on the Parameters stage) and brings in its tools: two React features for loading code on demand (``lazy`` and ``Suspense``), a small loading placeholder, the translation hook, and the type that describes which unit is in scope. React is the library that builds the screen from small functions. A fence diagram places the section walls in 3-D over the basemap; this cutout shows only the walls of the selected unit.

**Why it is here.** This is owner ruling R4 (2026-08-27): show a cutout of the fence with only the selected unit and the basemap visible, as a visual aid for what the engineer picked. This host file is deliberately kept free of CesiumJS — the 3-D globe library that actually draws the walls over a map. ``lazy`` means the heavy 3-D code (and the per-section edge fetches the fence needs) is fetched from disk only the first time a unit is actually scoped, so opening the Parameters stage stays fast until the engineer looks at a specific unit.

.. CG-EXPLANATION-END id=module-header

``const UnitFenceScene``
------------------------

.. CG-BLOCK id=const:UnitFenceScene lines=16-17

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitFenceCutout.tsx
   :language: tsx
   :lines: 16-17
   :lineno-match:

.. CG-EXPLANATION-START id=const:UnitFenceScene

**What this does.** Declares ``UnitFenceScene`` as a lazily-loaded component — a component is a function that returns a piece of screen. ``lazy(() => import('./UnitFenceScene'))`` tells React to fetch that file's code only when this component is first drawn.

**Why it is here.** The Cesium scene is a large chunk of code. Loading it on demand keeps it — and the fence's per-section fetches — out of the way until a unit is actually being viewed on the Parameters stage, which is the whole point of splitting the scene into its own module.

.. CG-EXPLANATION-END id=const:UnitFenceScene

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=18-35

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitFenceCutout.tsx
   :language: tsx
   :lines: 18-35
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** Declares the one input this panel takes — ``scope``, the typed description of which unit's walls to show — and documents the component that follows. An interface is just a note about the shape of an object; ``props`` are the inputs a parent hands a component.

**Why it is here.** The scope is the single thing the cutout needs to know: everything else (the models, layers and fence panels) it reads from shared app state inside the scene. Passing only the scope keeps the panel's contract minimal.

.. CG-EXPLANATION-END id=interface:Props

``function UnitFenceCutout``
----------------------------

.. CG-BLOCK id=function:UnitFenceCutout lines=36-57

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitFenceCutout.tsx
   :language: tsx
   :lines: 36-57
   :lineno-match:

.. CG-EXPLANATION-START id=function:UnitFenceCutout

**What this does.** The panel itself. It draws a titled header (a heading plus a one-line blurb, both translated) and, below it, the 3-D scene wrapped in a ``Suspense`` boundary. ``Suspense`` shows the loading placeholder — a small spinner labelled "loading 3-D view" — while the lazily-loaded scene code is still arriving, then swaps in the real ``UnitFenceScene`` once it is ready.

**Why it is here.** Keeping the heading and blurb in this lightweight host, and the heavy Cesium scene behind the ``Suspense`` fallback, means the engineer sees an immediate, labelled panel with a graceful loading state rather than a blank gap while the 3-D code loads. The scene mounts only here, so the lazy fetch is triggered exactly when a unit is scoped and not before.

.. CG-EXPLANATION-END id=function:UnitFenceCutout

