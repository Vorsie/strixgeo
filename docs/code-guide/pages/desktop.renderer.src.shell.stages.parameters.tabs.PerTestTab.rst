desktop.renderer.src.shell.stages.parameters.tabs.PerTestTab
============================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/parameters/tabs/PerTestTab.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/parameters/tabs/PerTestTab.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-37

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/tabs/PerTestTab.tsx
   :language: tsx
   :lines: 1-37
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file (the Per-test tab — a table of every CPT and borehole in the project, one row each, with computed parameters for columns) and describes in a header comment how the tab was reshaped, before importing React's hooks, two icons, the empty-state component, shared state, and the translation hook.

**Why it is here.** The comment records two owner rulings from the 2026-08-03 dogfeed. The inline expanded Ic/SBT chart was removed because a depth series reads tall and looked "all horizontal and squished" here — it moved to the stage's right-hand inspector. The "dominant SBT" column was removed because one dominant zone over a whole profile is geotechnically meaningless — a CPT through sand, then clay, then sand has no dominant soil, it has a SEQUENCE, which the inspector strips show. So a row click now selects the CPT (through a select-without-view handler that also warms the plot cache) and the inspector plots it. That specific handler is used on purpose: the plain select handler also flips the Data stage's view mode, so plotting a CPT here would silently rewrite where the Data stage lands next. Today only the inventory columns and mean Ic are filled; the design parameters are Phase-5 placeholder columns.

.. CG-EXPLANATION-END id=module-header

``type Row``
------------

.. CG-BLOCK id=type:Row lines=38-48

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/tabs/PerTestTab.tsx
   :language: tsx
   :lines: 38-48
   :lineno-match:

.. CG-EXPLANATION-START id=type:Row

**What this does.** Declares the shape of one table row: id, name, kind (CPT or borehole), depth, x and y location, and the computed mean Ic (or nothing). A type is a note about what kind of value is expected.

**Why it is here.** The mean Ic is optional because it only exists once the CPT's plot series has been fetched; the rest are inventory facts available immediately from the list.

.. CG-EXPLANATION-END id=type:Row

``type SortKey``
----------------

.. CG-BLOCK id=type:SortKey lines=49-50

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/tabs/PerTestTab.tsx
   :language: tsx
   :lines: 49-50
   :lineno-match:

.. CG-EXPLANATION-START id=type:SortKey

**What this does.** Declares which columns the table can be sorted by: name, kind, depth, or mean Ic.

**Why it is here.** Fixing the sortable columns to just these four keeps the sort logic simple and matches the columns that actually hold comparable values today.

.. CG-EXPLANATION-END id=type:SortKey

``function PerTestTab``
-----------------------

.. CG-BLOCK id=function:PerTestTab lines=51-270

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/tabs/PerTestTab.tsx
   :language: tsx
   :lines: 51-270
   :lineno-match:

.. CG-EXPLANATION-START id=function:PerTestTab

**What this does.** The tab component. It reads the CPTs, boreholes and the map of fetched plot data plus the selection handlers from shared state; keeps a small cache of each CPT's mean Ic so the value is computed once per test and not recomputed on every redraw; builds and sorts the rows; and renders either an empty state or a scrollable table. Each CPT row is clickable and highlights when selected; borehole rows stay inert. A footer counts the tests and notes the rest is coming.

**Why it is here.** The mean-Ic cache is kept in a ref (a value that survives redraws without causing one) because otherwise every new plot fetch would rebuild the whole map and force the per-CPT Ic reduction to rerun across every previously-loaded CPT — turning an O(1) read into O(N times series length) on each selection. A CPT row click uses the select-without-view handler so the inspector can plot it even on a cold cache without touching the Data stage's view mode, and deliberately does NOT clear the chosen unit — since the R3 layout flip, unit statistics live on the per-unit tab, so a chosen unit and a chosen test no longer share one pane, and clearing would throw the engineer's unit pick away every time he peeked at a hole. Borehole rows are inert because a borehole has no Ic series or SBT profile for the inspector to draw.

.. CG-EXPLANATION-END id=function:PerTestTab

``interface SortableHeaderProps``
---------------------------------

.. CG-BLOCK id=interface:SortableHeaderProps lines=271-277

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/tabs/PerTestTab.tsx
   :language: tsx
   :lines: 271-277
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SortableHeaderProps

**What this does.** Declares the inputs to a sortable column header: its label, whether it is the active sort column, the sort direction, and the click handler. An interface names the shape of an object.

**Why it is here.** It fixes the small set of things a sortable header needs so every sortable column is built identically.

.. CG-EXPLANATION-END id=interface:SortableHeaderProps

``function SortableHeader``
---------------------------

.. CG-BLOCK id=function:SortableHeader lines=278-297

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/tabs/PerTestTab.tsx
   :language: tsx
   :lines: 278-297
   :lineno-match:

.. CG-EXPLANATION-START id=function:SortableHeader

**What this does.** Draws one clickable column header — the label with a sort-direction arrow that highlights when this is the active column and flips when the sort is descending.

**Why it is here.** Extracted so every sortable column shows the same affordance from one piece of code, and the arrow gives the engineer a clear cue to what is sorted and which way.

.. CG-EXPLANATION-END id=function:SortableHeader

``function PhaseFiveHeader``
----------------------------

.. CG-BLOCK id=function:PhaseFiveHeader lines=298-309

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/tabs/PerTestTab.tsx
   :language: tsx
   :lines: 298-309
   :lineno-match:

.. CG-EXPLANATION-START id=function:PhaseFiveHeader

**What this does.** Draws a muted column header for a design parameter not yet computed, with a tooltip explaining it is a design-ready parameter, coming later.

**Why it is here.** The design parameters (the friction angle, cohesion, undrained strength and so on) are Phase 5, but the columns are shown greyed so the engineer sees the surface that will fill in later; the labels are the standard parameter symbols, which are domain canon and not translated.

.. CG-EXPLANATION-END id=function:PhaseFiveHeader

``function PhaseFiveCell``
--------------------------

.. CG-BLOCK id=function:PhaseFiveCell lines=310-312

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/tabs/PerTestTab.tsx
   :language: tsx
   :lines: 310-312
   :lineno-match:

.. CG-EXPLANATION-START id=function:PhaseFiveCell

**What this does.** Draws a single muted, empty cell (a dash) for a Phase-5 parameter.

**Why it is here.** It fills the placeholder columns in every row with a clear "nothing here yet" mark, keeping the table shape honest about what is and is not computed today.

.. CG-EXPLANATION-END id=function:PhaseFiveCell

