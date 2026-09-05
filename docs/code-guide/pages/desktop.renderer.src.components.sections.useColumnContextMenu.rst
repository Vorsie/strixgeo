desktop.renderer.src.components.sections.useColumnContextMenu
=============================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/useColumnContextMenu.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/useColumnContextMenu.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-26

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/useColumnContextMenu.ts
   :language: typescript
   :lines: 1-26
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A hook that holds the right-click context-menu state and its open and dismiss handlers for the cross-section. A hook is a reusable bundle of React logic a component calls; it can hold state, which are remembered values that trigger a redraw when they change, and it can read a ref, which is a stable box holding a value the render does not watch, such as a DOM element.

**Why it is here.** Debt #30. It encapsulates the three things the section panel previously held inline: the menu state, the right-click handler fired from a narrow column-glyph hit-box, and a wide-area fallback on the section SVG that hit-tests the cursor against the visible columns. Coordination with focus mode and the Esc handler stays in the panel, because Esc spans both this hook's state and the focus hook's.

.. CG-EXPLANATION-END id=module-header

``interface ColumnContextMenuState``
------------------------------------

.. CG-BLOCK id=interface:ColumnContextMenuState lines=27-37

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/useColumnContextMenu.ts
   :language: typescript
   :lines: 27-37
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ColumnContextMenuState

**What this does.** The open menu's state: its container-local X and Y and the column it was opened on (kind, id, name).

**Why it is here.** It is null when no menu is open, and the position is stored container-local because the menu renders inside the panel's relative wrapper.

.. CG-EXPLANATION-END id=interface:ColumnContextMenuState

``interface UseColumnContextMenuResult``
----------------------------------------

.. CG-BLOCK id=interface:UseColumnContextMenuResult lines=38-58

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/useColumnContextMenu.ts
   :language: typescript
   :lines: 38-58
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseColumnContextMenuResult

**What this does.** What the hook returns: the current menu state, the two open handlers (the glyph right-click and the SVG-wide fallback), and an imperative dismiss.

**Why it is here.** The dismiss is exposed so both the Esc keyboard handler and the menu's own close can call it directly.

.. CG-EXPLANATION-END id=interface:UseColumnContextMenuResult

``function useColumnContextMenu``
---------------------------------

.. CG-BLOCK id=function:useColumnContextMenu lines=59-125

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/useColumnContextMenu.ts
   :language: typescript
   :lines: 59-125
   :lineno-match:

.. CG-EXPLANATION-START id=function:useColumnContextMenu

**What this does.** Holds the menu state and defines the handlers: the glyph right-click opens the menu at the cursor; the SVG fallback hit-tests the cursor against the visible columns by their nudged X and half-width, opens the menu on the nearest column hit, and otherwise suppresses the browser default and dismisses any open menu.

**Why it is here.** The wide-area fallback catches a right-click anywhere inside a column's visual band, not only on the thin glyph, and the default is always prevented so the browser's own menu never appears. The container ref supplies the rectangle that converts the browser's client coordinates into menu-local coordinates.

.. CG-EXPLANATION-END id=function:useColumnContextMenu

