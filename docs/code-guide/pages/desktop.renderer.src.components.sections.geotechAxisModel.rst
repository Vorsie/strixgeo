desktop.renderer.src.components.sections.geotechAxisModel
=========================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/geotechAxisModel.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/geotechAxisModel.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-15

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/geotechAxisModel.ts
   :language: typescript
   :lines: 1-15
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file: it holds the geotech axis's model bundle, assembled once in ``SectionsCanvas`` and carried to ``SectionPanel`` through a shared context. It imports the layer response type.

**Why it is here.** The comment records the history: before 2026-08-13 this was the input to the fraction-space NAD refinement, owned by the overlay that ran it. That refinement is retired — the geotech axis now partitions the geotech model directly ('we don't need to invent the fill bands engine, it is built for the litho stage — we only have more classes') — so the bundle is no longer any single overlay's property and gets its own module.

.. CG-EXPLANATION-END id=module-header

``interface GeotechFormationMeta``
----------------------------------

.. CG-BLOCK id=interface:GeotechFormationMeta lines=16-23

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/geotechAxisModel.ts
   :language: typescript
   :lines: 16-23
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeotechFormationMeta

**What this does.** Describes what the geotech axis needs to know about one geotech formation — its NAD packing class (1 to 31, or null when it carries none) and its main soil code.

**Why it is here.** A small data shape the axis reads per formation.

.. CG-EXPLANATION-END id=interface:GeotechFormationMeta

``interface GeotechAxisModel``
------------------------------

.. CG-BLOCK id=interface:GeotechAxisModel lines=24-51

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/geotechAxisModel.ts
   :language: typescript
   :lines: 24-51
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeotechAxisModel

**What this does.** Describes everything the geotech axis reads about the active geotech model — the geotech layer rows (the NAD packing bands), the map from formation id to its NAD class and soil code, a map from litho formation id to soil code, a map from litho formation id to lithology colour, and the set of investigation ids whose bands are stale.

**Why it is here.** The docstring records why each map exists: the litho-soil map is the guard that stops a sand's packing standing in for a clay interval; the litho colour map gives an interval the packing model does not cover a colour to fall back to, because the parent palette only knows geotech formation ids on this axis; and the stale-column set (debt #266) draws an amber mark on each column whose bands describe a lithology stack that has since been edited, so the engineer can see it on the drawing.

.. CG-EXPLANATION-END id=interface:GeotechAxisModel

