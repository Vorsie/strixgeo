desktop.renderer.src.shell.stages.geology.GeotechLayersTree
===========================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/geology/GeotechLayersTree.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/geology/GeotechLayersTree.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-39

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/GeotechLayersTree.tsx
   :language: tsx
   :lines: 1-39
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the file — the nested LAYERS legend for the geotech 3-D pane, grouped soil then NAD class then body — and imports React's ``useState``, the alert and chevron icons, the translator, and the tree-node types from the legend-tree helper. The comment sketches the three-level shape, closed at the soil level.

**Why it is here.** It replaces the flat per-formation list when the viewed model is a geotech one (owner ruling 2026-08-26), because there the flat list degenerates: every lithology unit is subdivided into packing classes, so the panel fills with dozens of near-identical rows whose colours are adjacent shades of one ramp. A NAD packing class (1 to 31) comes from NBN EN 1997-1 ANB Tabel 2.1, the Belgian national annex to Eurocode 7. Which rows exist is the tree builder's call and changes with the view mode — only what the scene actually paints gets a row.

.. CG-EXPLANATION-END id=module-header

``interface GeotechLayersTreeProps``
------------------------------------

.. CG-BLOCK id=interface:GeotechLayersTreeProps lines=40-63

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/GeotechLayersTree.tsx
   :language: tsx
   :lines: 40-63
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeotechLayersTreeProps

**What this does.** Declares the tree's inputs: the grouped families from the builder, the sets of formations and of bodies currently hidden in the 3-D scene, a callback to hide or show every formation in a given list, and a callback to hide or show one body.

**Why it is here.** A family or class row works out its own hide/show direction — if anything under it is still visible it hides everything, and if it is fully hidden it shows everything — so the caller can stay a plain set-mutator that does not have to reason about the group's state.

.. CG-EXPLANATION-END id=interface:GeotechLayersTreeProps

``function Swatch``
-------------------

.. CG-BLOCK id=function:Swatch lines=64-75

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/GeotechLayersTree.tsx
   :language: tsx
   :lines: 64-75
   :lineno-match:

.. CG-EXPLANATION-START id=function:Swatch

**What this does.** A tiny colour chip shared by all three levels of the tree; a hidden row shows just an outline in the colour instead of a filled chip.

**Why it is here.** One shared chip keeps the three levels visually consistent, and the outline-only variant signals at a glance that a row is currently hidden.

.. CG-EXPLANATION-END id=function:Swatch

``function Caret``
------------------

.. CG-BLOCK id=function:Caret lines=76-104

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/GeotechLayersTree.tsx
   :language: tsx
   :lines: 76-104
   :lineno-match:

.. CG-EXPLANATION-START id=function:Caret

**What this does.** The expand/collapse triangle button, drawn only when a node has children: a down chevron when open, a right chevron when closed, with an accessible expand-or-collapse label.

**Why it is here.** It gives each expandable row a control that is reachable by keyboard and announced to screen readers, via ``aria-expanded`` and a named label.

.. CG-EXPLANATION-END id=function:Caret

``function CaretSpacer``
------------------------

.. CG-BLOCK id=function:CaretSpacer lines=105-138

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/GeotechLayersTree.tsx
   :language: tsx
   :lines: 105-138
   :lineno-match:

.. CG-EXPLANATION-START id=function:CaretSpacer

**What this does.** A blank placeholder the exact width of a caret, used to keep a childless row lined up with its expandable siblings. The lines that follow are the tree component's docstring.

**Why it is here.** Without the spacer, a row that has no caret would shift left and break the vertical alignment of the column.

.. CG-EXPLANATION-END id=function:CaretSpacer

``function GeotechLayersTree``
------------------------------

.. CG-BLOCK id=function:GeotechLayersTree lines=139-280

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/GeotechLayersTree.tsx
   :language: tsx
   :lines: 139-280
   :lineno-match:

.. CG-EXPLANATION-START id=function:GeotechLayersTree

**What this does.** The tree component. It remembers which nodes are expanded (starting fully collapsed) and renders each soil family as a row with a caret, swatch, label and body-count; expanding a family reveals its NAD-class rows, and expanding a class reveals its body rows. Clicking a family or class row hides or shows all its formations; clicking a body row toggles that one body's solid; an under-constrained body shows a warning triangle.

**Why it is here.** It starts collapsed at the soil level per the owner's ruling. The expansion state is session-ephemeral and is keyed on the builder's node keys, so rebuilding the tree (new solids, a re-subdivision) preserves whatever the engineer had open. A group reads as hidden only when every formation under it is hidden, so a partially visible group's click offers "hide all".

.. CG-EXPLANATION-END id=function:GeotechLayersTree

