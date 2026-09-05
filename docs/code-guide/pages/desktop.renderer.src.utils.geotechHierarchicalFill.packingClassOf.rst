desktop.renderer.src.utils.geotechHierarchicalFill.packingClassOf
=================================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotechHierarchicalFill/packingClassOf.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotechHierarchicalFill/packingClassOf.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-19

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/packingClassOf.ts
   :language: typescript
   :lines: 1-19
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This small module writes down the ONE translation from a geotech formation row to its canonical class identity — soil-and-class — that the whole fill compares masses by. The geotech model stores one row per NAD class and litho parent, and this map collapses those rows to a single soil-and-class key so the fill, the voxel build, the 3-D fences and the gates all compare the same identity.

**Why it is here.** Since ruling R1 (owner 2026-08-31, debt #278) the geological parent is a live-derived label, not identity, so a litho unit spanning a geological boundary keeps ONE row, and the law still compares the CLASS — two NAD-6 sands tied together are one mass and one body ("yes one mass one body", 2026-08-21). The class here is the Belgian NAD packing class, NBN EN 1997-1 ANB Tabel 2.1. Writing the translation in one place is what keeps render, build and gates from disagreeing about identity.

.. CG-EXPLANATION-END id=module-header

``interface PackingClassMeta``
------------------------------

.. CG-BLOCK id=interface:PackingClassMeta lines=20-39

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/packingClassOf.ts
   :language: typescript
   :lines: 20-39
   :lineno-match:

.. CG-EXPLANATION-START id=interface:PackingClassMeta

**What this does.** The data shape describing one geotech formation for the map builder: its NAD packing class (1 to 31, or none) and its main soil code (such as ZAND, or none).

**Why it is here.** Those two fields are the whole of a mass's identity — soil and density — so they are all the builder needs.

.. CG-EXPLANATION-END id=interface:PackingClassMeta

``function buildPackingClassOf``
--------------------------------

.. CG-BLOCK id=function:buildPackingClassOf lines=40-49

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/packingClassOf.ts
   :language: typescript
   :lines: 40-49
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildPackingClassOf

**What this does.** Builds the formation-to-key map, giving every formation that has BOTH a soil code and a NAD class the key soil-then-class, and giving a formation missing either half no entry at all.

**Why it is here.** Two unknowns are not known to be the same density, so a formation with no class (a skeleton band over unread ground) or no soil keeps its row identity and never welds across rows. Collapsing a missing soil to a placeholder would silently weld two formations that share a class but were never shown to share a soil — the exact case this map exists to keep apart.

.. CG-EXPLANATION-END id=function:buildPackingClassOf

