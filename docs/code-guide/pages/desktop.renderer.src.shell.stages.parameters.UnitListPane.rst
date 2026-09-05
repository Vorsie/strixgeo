desktop.renderer.src.shell.stages.parameters.UnitListPane
=========================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/parameters/UnitListPane.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/parameters/UnitListPane.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-56

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitListPane.tsx
   :language: tsx
   :lines: 1-56
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the unit-list file — the inspector half of the Parameters per-unit surface, drawn as the owner-ruled body tree — and imports React's hooks, the icons, the translator, the group-ordinal helpers, the empty and loading states, the shell context, the tree builder and its node type, the pure tree-view walks, the two fetch hooks, the bulk action bar and the grouping hook.

**Why it is here.** The docstring quotes owner ruling R3 (2026-08-27): the engineer did not like the list being the main view, so the statistics now own the canvas and this pane is the roster he picks from, a row click driving the canvas through the shared scope. The tree itself is litho unit, then litho body, then NAD class, then geotech body, and litho units are ALWAYS listed — which is what killed the old "litho units are unreachable when a geotech model exists" gap and removed the litho/geotech either-or roster and its loading race. The tree module owns the structure, labels, counts and collapse; this file only renders it and owns the expand state and the listbox accessibility.

.. CG-EXPLANATION-END id=module-header

``function UnitListPane``
-------------------------

.. CG-BLOCK id=function:UnitListPane lines=57-285

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitListPane.tsx
   :language: tsx
   :lines: 57-285
   :lineno-match:

.. CG-EXPLANATION-START id=function:UnitListPane

**What this does.** The pane component. It reads the models, layers, formations and coordinator state from the shell; fetches both body rosters and the geotech unions (numbering the manual groups from them); runs the grouping hook and builds the tree; holds the expand state and seeds single-class litho bodies open once; and then renders — a loading state while the geotech layers are still in flight, an empty state when there are no units, else the header, the bulk bar when a body selection is active, the flattened tree rows, and a footer counting orphan bands plus the Phase-5 note.

**Why it is here.** Every hook is called before the early returns so the hook order stays fixed. It waits for the geotech layers to load before drawing, because until then the geotech sub-split is unknown and a tree that suddenly grows children the moment they land would be dishonest. Single-class litho bodies are seeded OPEN once (owner 2026-09-02) so their lone packing-class row — the pakkingsdichtheid label — shows without an extra click, seeded into the real expand state (tracked by a ref) so a body the user deliberately closes is never forced open again on a later rebuild. Orphan geotech bands with no covering litho band are never given an invented home in the tree; they are counted honestly in the footer.

.. CG-EXPLANATION-END id=function:UnitListPane

``function NodeRow``
--------------------

.. CG-BLOCK id=function:NodeRow lines=286-435

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitListPane.tsx
   :language: tsx
   :lines: 286-435
   :lineno-match:

.. CG-EXPLANATION-START id=function:NodeRow

**What this does.** Draws one selectable tree row: an optional grouping checkbox, an expander chevron or a spacer, the label, an optional "(group N)" tag, an optional "checked inside" flag on a collapsed row, and the "N bands · M with cone" count. The whole row selects the node on click or Enter/Space, and expands or collapses with the arrow keys.

**Why it is here.** The row follows the WCAG listbox rules: the option itself carries the expanded state and the arrow-key handling, and the expander is a purely visual mouse affordance hidden from assistive technology with no focusable descendant inside the option. The checkbox appears only on a groupable row — a geotech-body leaf, or a class row that collapsed its lone body into itself — which is what lets the engineer tick same-class bodies under two different litho parents and group across them (owner 2026-09-04); its accessible name adds the litho parent when the row's own label is only the packing class. A collapsed row surfaces how many ticked bodies are hidden inside it, in the accent colour never amber (amber means unsaved), so a hidden tick is not invisible. The "(group N)" tag is a sibling of the label, not nested in the truncating span, so a long label never clips it.

.. CG-EXPLANATION-END id=function:NodeRow

