desktop.renderer.src.utils.staleGeotechColumns
==============================================

.. CG-PAGE source=desktop/src/renderer/src/utils/staleGeotechColumns.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/staleGeotechColumns.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-39

.. literalinclude:: ../../../desktop/src/renderer/src/utils/staleGeotechColumns.ts
   :language: typescript
   :lines: 1-39
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file gives the one answer to "are this column's packing bands out of date?" It imports the stale-column type and the translator, and its docstring explains the two staleness signals it merges.

**Why it is here.** The docstring records why a union is needed (debt #266). Two independent signals say a column's bands no longer describe the ground: **Fit**, derived instantly in the renderer from the loaded layers when a band pokes out of the litho unit it subdivides — but it is CPT-only and can only see a unit that shrank; and **Provenance**, where the server compares the litho fingerprint each column's bands were stamped with against the litho beneath it now — which also covers boreholes and every kind of change, including the ones fit cannot see. Neither signal subsumes the other, so this module unions them into one marker per column and one count on one chip, because two overlapping amber warnings about the same column is the alarm-fatigue failure #266 exists to avoid — and the engineer's action is the same either way: re-run the subdivision on that column.

.. CG-EXPLANATION-END id=module-header

``function unionStaleGeotechColumns``
-------------------------------------

.. CG-BLOCK id=function:unionStaleGeotechColumns lines=40-62

.. literalinclude:: ../../../desktop/src/renderer/src/utils/staleGeotechColumns.ts
   :language: typescript
   :lines: 40-62
   :lineno-match:

.. CG-EXPLANATION-START id=function:unionStaleGeotechColumns

**What this does.** Merges the two answers. It keys the provenance columns by their investigation id, then adds each fit-stale id only if it is not already present, labelling it through the caller-supplied label resolver (falling back to the id). It returns every out-of-date column exactly once, sorted by label. It then documents the chip label below.

**Why it is here.** The docstring records the intent: deduping by id means every out-of-date column appears exactly once, sorting by label means two reads present the same list, and falling back to the id means a column is never silently dropped for want of a name.

.. CG-EXPLANATION-END id=function:unionStaleGeotechColumns

``function staleGeotechChipLabel``
----------------------------------

.. CG-BLOCK id=function:staleGeotechChipLabel lines=63-77

.. literalinclude:: ../../../desktop/src/renderer/src/utils/staleGeotechColumns.ts
   :language: typescript
   :lines: 63-77
   :lineno-match:

.. CG-EXPLANATION-START id=function:staleGeotechChipLabel

**What this does.** Returns the short label for the toolbar chip — the translated "N out of date" text — and documents the tooltip builder below.

**Why it is here.** The docstring records that the label is kept short enough to sit beside the pending-tie count, with the full names and the instruction moved into the tooltip.

.. CG-EXPLANATION-END id=function:staleGeotechChipLabel

``function staleGeotechChipTitle``
----------------------------------

.. CG-BLOCK id=function:staleGeotechChipTitle lines=78-94

.. literalinclude:: ../../../desktop/src/renderer/src/utils/staleGeotechColumns.ts
   :language: typescript
   :lines: 78-94
   :lineno-match:

.. CG-EXPLANATION-START id=function:staleGeotechChipTitle

**What this does.** Builds the tooltip text. For no columns it returns a "none" string; otherwise it names up to ``maxNamed`` columns, summarises any remainder as "and N more", and chooses the singular or plural title accordingly.

**Why it is here.** The docstring records why it names the columns rather than only counting them: a warning the engineer cannot trace to a specific column is one he cannot act on. Long lists are summarised so the tooltip stays readable on a model with many columns.

.. CG-EXPLANATION-END id=function:staleGeotechChipTitle

