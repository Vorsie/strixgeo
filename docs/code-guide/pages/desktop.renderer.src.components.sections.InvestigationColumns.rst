desktop.renderer.src.components.sections.InvestigationColumns
=============================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/InvestigationColumns.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/InvestigationColumns.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-34

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/InvestigationColumns.tsx
   :language: tsx
   :lines: 1-34
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the file for the thin wrapper that draws all the investigation columns (CPTs and boreholes) on the section by dispatching one ``ColumnGlyph`` per column. The imports pull in that glyph, the label-mode type, and the placed-column type.

**Why it is here.** The layout pass has already nudged crowded columns rightward and tagged the displaced ones, so this wrapper just picks the right shape per kind and forwards the handlers. The rendering rules — circle cap for a CPT, square for a borehole, the DOV three-row label, the tie-back diagonal when displaced — all live in ``ColumnGlyph``; this file only routes the data to it.

.. CG-EXPLANATION-END id=module-header

``function InvestigationColumns``
---------------------------------

.. CG-BLOCK id=function:InvestigationColumns lines=35-151

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/InvestigationColumns.tsx
   :language: tsx
   :lines: 35-151
   :lineno-match:

.. CG-EXPLANATION-START id=function:InvestigationColumns

**What this does.** The component. It maps over the placed columns and, for each, reads the depth from the right field (a CPT's max depth or a borehole's total depth), wraps the click, double-click, and right-click handlers to carry the column's id and kind, and renders a ``ColumnGlyph`` with the column's position, elevation, depth, label mode, and hover handlers.

**Why it is here.** Walking each branch of the CPT-or-borehole distinction lets the types narrow to the right shape without a cast (debt #28). Single-click is passed through as always-undefined so an accidental pan never navigates away; only the double-click opens detail. The label mode and callout come from the caller's level-of-detail decision, kept out of this per-column loop.

.. CG-EXPLANATION-END id=function:InvestigationColumns

