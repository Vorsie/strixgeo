desktop.renderer.src.components.sections.ColumnContextMenu
==========================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/ColumnContextMenu.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/ColumnContextMenu.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-24

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ColumnContextMenu.tsx
   :language: tsx
   :lines: 1-24
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the file for the right-click menu on an investigation column (a CPT or borehole). The documentation lists its actions — focus this test, open its detail, remove it from the section, and clear its packing subdivision — and the imports pull in the generic menu and the translation helper.

**Why it is here.** 'Remove from this section' is a project-local hide, not a database delete, so per the UX rule it fires immediately with no confirmation and the 'N hidden · restore all' footer is the undo path. The menu is a thin wrapper over the shared ``ContextMenu`` so all such menus behave alike.

.. CG-EXPLANATION-END id=module-header

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=25-55

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ColumnContextMenu.tsx
   :language: tsx
   :lines: 25-55
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** The inputs to the column menu: where to place it, the column's display name for the subtitle, and the callbacks for focus, open-detail, remove, clear-subdivision, and close. The three action callbacks are optional.

**Why it is here.** When a callback is absent the matching row is hidden — the no-affordance rule — because the action is only meaningful when the parent owns the path to carry it out (a detail route, a section PATCH, a rebuild). Clearing the subdivision is geotech-only and fires immediately because the rebuild is one press away and the toast names it (owner ask 2026-08-18).

.. CG-EXPLANATION-END id=interface:Props

``function ColumnContextMenu``
------------------------------

.. CG-BLOCK id=function:ColumnContextMenu lines=56-97

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ColumnContextMenu.tsx
   :language: tsx
   :lines: 56-97
   :lineno-match:

.. CG-EXPLANATION-START id=function:ColumnContextMenu

**What this does.** The component. It reads the translated labels, builds the list of rows (focus, then optionally open-detail, clear-subdivision, and remove), and renders them through the generic menu with the column name as the header.

**Why it is here.** The labels go through the translation catalogue because the menu had stayed English in Dutch mode (owner dogfeed 2026-09-01). Clear-subdivision and Remove are danger-styled and set off by a divider — Remove because it changes what the section shows, though it stays reversible via the restore footer.

.. CG-EXPLANATION-END id=function:ColumnContextMenu

