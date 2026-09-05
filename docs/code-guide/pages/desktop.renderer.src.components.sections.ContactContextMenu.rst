desktop.renderer.src.components.sections.ContactContextMenu
===========================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/ContactContextMenu.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/ContactContextMenu.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-48

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ContactContextMenu.tsx
   :language: tsx
   :lines: 1-48
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the file for the right-click menu on a formation contact (a boundary line between two soil units). The documentation explains it has no state of its own and is drawn as a floating menu fixed to the viewport at the click position; the only import is the generic menu.

**Why it is here.** It was pulled out of the large ``ContactsLayer`` file to keep that file focused on the drag machinery. It is drawn through a portal fixed to the page rather than nested inside the section's drawing, so the menu is never trapped inside the SVG's stacking rules.

.. CG-EXPLANATION-END id=module-header

``interface ContactContextMenuProps``
-------------------------------------

.. CG-BLOCK id=interface:ContactContextMenuProps lines=49-91

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ContactContextMenu.tsx
   :language: tsx
   :lines: 49-91
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ContactContextMenuProps

**What this does.** The inputs: the click's viewport position, the formation name for the subtitle, and four optional action callbacks — edit in the stratigraphy stage, delete, unlink from geology, link to geology — plus a close callback.

**Why it is here.** Each action is shown only when its callback is supplied and its condition holds: link appears only for an uncoupled contact, unlink only for a coupled one, and edit-in-stratigraphy only for a reference backdrop contact (where Delete is then suppressed, since those belong on the geological axis). The delete handler is expected to add its own confirm dialog — this menu does not add a second gate.

.. CG-EXPLANATION-END id=interface:ContactContextMenuProps

``function ContactContextMenu``
-------------------------------

.. CG-BLOCK id=function:ContactContextMenu lines=92-135

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ContactContextMenu.tsx
   :language: tsx
   :lines: 92-135
   :lineno-match:

.. CG-EXPLANATION-START id=function:ContactContextMenu

**What this does.** The component. It renders the generic menu, fixed to the viewport at the click coordinates, with the formation name as the header and the four possible rows, each present only when wired — Delete last, danger-styled, set off by a divider.

**Why it is here.** The labels are hard-coded English here rather than translated — a known, deliberately-noted gap the file flags for a later pass. Delete being irreversible is danger-styled and separated, following the UX destructive-action rule, with the actual confirmation left to the caller's dialog.

.. CG-EXPLANATION-END id=function:ContactContextMenu

