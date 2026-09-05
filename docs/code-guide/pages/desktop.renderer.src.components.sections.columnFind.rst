desktop.renderer.src.components.sections.columnFind
===================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/columnFind.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/columnFind.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-15

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/columnFind.ts
   :language: typescript
   :lines: 1-15
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the pure module that powers Ctrl+F on a cross-section — finding a column by its header name. It imports the viewport type.

**Why it is here.** The docstring cites the owner (17 August 2026): 'on cross-sections i want a ctrl+f feature so i can go easily to a column header like s8'. His columns are named like GEO-10/170-S8, and the thing he types is the short tail, so matching is a case-insensitive substring. It is a pure module — no React, no drawing — so the find logic is testable in isolation.

.. CG-EXPLANATION-END id=module-header

``interface ColumnFindEntry``
-----------------------------

.. CG-BLOCK id=interface:ColumnFindEntry lines=16-41

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/columnFind.ts
   :language: typescript
   :lines: 16-41
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ColumnFindEntry

**What this does.** The named shape of one placed column reduced to what find needs: its investigation id, its header name, its true along-distance (used only to order matches), and its rendered screen x (nudgedX).

**Why it is here.** The comment on the rendered x is load-bearing: the jump centres on the drawn x, never on the along-distance, because at packed spacing the two diverge by the whole cumulative-width offset and centring on the raw distance would land the camera beside the column — the section-view spacing rule.

.. CG-EXPLANATION-END id=interface:ColumnFindEntry

``function matchColumns``
-------------------------

.. CG-BLOCK id=function:matchColumns lines=42-68

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/columnFind.ts
   :language: typescript
   :lines: 42-68
   :lineno-match:

.. CG-EXPLANATION-START id=function:matchColumns

**What this does.** Returns the columns whose header contains the typed text (trimmed, case-insensitive), ordered left-to-right by along-distance; an empty query matches nothing.

**Why it is here.** The comment: an empty query matches nothing so a bar that lit every column on open would not flash the whole section before the first keystroke; sorting by along-distance means repeated Enter walks the section left-to-right.

.. CG-EXPLANATION-END id=function:matchColumns

``function panViewportToScreenX``
---------------------------------

.. CG-BLOCK id=function:panViewportToScreenX lines=69-82

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/columnFind.ts
   :language: typescript
   :lines: 69-82
   :lineno-match:

.. CG-EXPLANATION-START id=function:panViewportToScreenX

**What this does.** Returns a new viewport panned horizontally so a target screen x lands at the plot centre, keeping the vertical window and zoom, and returns the viewport unchanged when the horizontal scale is not yet measured.

**Why it is here.** The comment: it is a pure horizontal slide so the jump keeps whatever zoom the engineer set, and one shot is exact at every spacing because a viewport shift moves every rendered column by the same pixel delta; the not-yet-measured guard avoids panning by infinity, which would blank the section.

.. CG-EXPLANATION-END id=function:panViewportToScreenX

