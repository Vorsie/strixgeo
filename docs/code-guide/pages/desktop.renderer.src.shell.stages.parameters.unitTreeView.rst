desktop.renderer.src.shell.stages.parameters.unitTreeView
=========================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/parameters/unitTreeView.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/parameters/unitTreeView.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-10

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/unitTreeView.ts
   :language: typescript
   :lines: 1-10
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the file of pure view helpers for the Parameters unit tree — the expand, flatten and collect walks the list pane runs over the tree nodes — and imports the node type and the scope-key helper.

**Why it is here.** A tree here is the nested roster (litho unit, then litho body, then NAD class, then geotech body); a node is one row in it. These walks are extracted so the pane stays under the 500-line god-component cap (debt #201) and every function here is pure — no React, no shell — so each is unit-testable on its own while the pane keeps only its expand state and the accessibility wiring.

.. CG-EXPLANATION-END id=module-header

``interface FlatRow``
---------------------

.. CG-BLOCK id=interface:FlatRow lines=11-31

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/unitTreeView.ts
   :language: typescript
   :lines: 11-31
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FlatRow

**What this does.** Names the shape of one visible tree row after the expand state has been applied: the node itself plus its indentation depth.

**Why it is here.** Flattening the nested tree into a plain list of rows-with-depth is what lets the pane draw it as a single scrollable listbox — each row knows how far to indent from its depth number.

.. CG-EXPLANATION-END id=interface:FlatRow

``function ancestorsOfSelection``
---------------------------------

.. CG-BLOCK id=function:ancestorsOfSelection lines=32-71

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/unitTreeView.ts
   :language: typescript
   :lines: 32-71
   :lineno-match:

.. CG-EXPLANATION-START id=function:ancestorsOfSelection

**What this does.** Walks the tree to find the selected node and returns the scope keys of every ANCESTOR above it (not the node itself), as a set. Returns an empty set when nothing is selected or the node is not found.

**Why it is here.** When the engineer arrives by a jump from another stage, the selected node may be buried inside collapsed parents. Returning its ancestor keys lets the pane force that whole path open so the selection is visible — the established behaviour for a jump-arrived selection.

.. CG-EXPLANATION-END id=function:ancestorsOfSelection

``function defaultOpenLithoBodyKeys``
-------------------------------------

.. CG-BLOCK id=function:defaultOpenLithoBodyKeys lines=72-106

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/unitTreeView.ts
   :language: typescript
   :lines: 72-106
   :lineno-match:

.. CG-EXPLANATION-START id=function:defaultOpenLithoBodyKeys

**What this does.** Walks the tree and returns the keys of litho-body nodes whose ONLY child is a single NAD-class row.

**Why it is here.** The docstring quotes the owner ruling (2026-09-02): a litho body with only one packing class must show that class row — the pakkingsdichtheid label — without an extra click, and it must NOT be collapsed away because that would drop the label. Each such key is seeded open once into the real expand state (by an effect in the list pane), so the row stays a normal, fully collapsible node rather than one forced permanently open with a dead chevron.

.. CG-EXPLANATION-END id=function:defaultOpenLithoBodyKeys

``function flattenVisible``
---------------------------

.. CG-BLOCK id=function:flattenVisible lines=107-143

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/unitTreeView.ts
   :language: typescript
   :lines: 107-143
   :lineno-match:

.. CG-EXPLANATION-START id=function:flattenVisible

**What this does.** Turns the nested tree into the flat list of rows currently visible, in display order: it emits each node, then — only if the node has children and its key is open — recursively emits its children one level deeper.

**Why it is here.** The pane draws a single flat listbox, so the nested tree has to be flattened to exactly the rows the current expand state exposes, parents before their open children, each tagged with its depth for indentation.

.. CG-EXPLANATION-END id=function:flattenVisible

``function checkedDescendantCount``
-----------------------------------

.. CG-BLOCK id=function:checkedDescendantCount lines=144-156

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/unitTreeView.ts
   :language: typescript
   :lines: 144-156
   :lineno-match:

.. CG-EXPLANATION-START id=function:checkedDescendantCount

**What this does.** Counts how many groupable bodies inside a node's subtree are currently ticked, walking every descendant but excluding the node's own row.

**Why it is here.** When an expandable row is collapsed, a tick made inside it would otherwise be invisible — the only other selection cue is the top-of-list total, which does not say WHERE the ticked bodies are (ux review 2026-09-04). A collapsed ancestor renders this count so a hidden tick is still surfaced. The node's own id is excluded because this is only ever called on collapsed expandable rows, whose own row is never itself a checkbox.

.. CG-EXPLANATION-END id=function:checkedDescendantCount

