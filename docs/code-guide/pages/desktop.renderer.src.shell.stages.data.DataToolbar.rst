desktop.renderer.src.shell.stages.data.DataToolbar
==================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/data/DataToolbar.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/data/DataToolbar.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-33

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataToolbar.tsx
   :language: tsx
   :lines: 1-33
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and imports its tools: React's ``useRef`` hook, three icons, the shared shell bus, the shared portal-menu primitives, and the translation helper with its message-key type. The docstring says this component renders the import dropdown in the toolbar's left zone and reads its state and handlers from the shell, taking no props.

**Why it is here.** Each stage supplies a *toolbar* — the verb row across the top of the screen. This file is the Data stage's toolbar, holding only the import verbs; it reproduces the import dropdown from the app's old ``Toolbar.tsx``, and the theme toggle that used to sit beside it moved to the shell's shared toolbar zone.

.. CG-EXPLANATION-END id=module-header

``function DataToolbar``
------------------------

.. CG-BLOCK id=function:DataToolbar lines=34-97

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataToolbar.tsx
   :language: tsx
   :lines: 34-97
   :lineno-match:

.. CG-EXPLANATION-START id=function:DataToolbar

**What this does.** Reads the two 'busy' flags, the three import handlers, and the rectangle-draw state from the shell. It builds the list of import verbs — GEF CPT, DOV CPT and DOV borehole are available now, while DMT, lab test and monitoring are shown but disabled with a 'phase' tag — turns them into dropdown rows (all disabled while an import runs), and renders the dropdown, whose button shows a spinner while importing and switches its label to 'drawing' while the engineer is dragging an import rectangle on the map.

**Why it is here.** The comments record two choices. Each verb carries a translation KEY rather than a finished string, and the labels are resolved together in one place so switching language re-draws the whole menu at once. And each verb carries a stable testid that the guided tutorial spotlights one at a time and the automated tests anchor on.

.. CG-EXPLANATION-END id=function:DataToolbar

``interface ImportAction``
--------------------------

.. CG-BLOCK id=interface:ImportAction lines=98-116

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataToolbar.tsx
   :language: tsx
   :lines: 98-116
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ImportAction

**What this does.** The shape of one import verb: a message key for its label, a stable testid, an 'available' flag, and an optional click handler.

**Why it is here.** The comments note the label key is resolved when the row is drawn (not when it is declared) so the whole menu follows a language switch in one redraw, and the testid is a stable anchor for the tutorial and tests.

.. CG-EXPLANATION-END id=interface:ImportAction

``interface DropdownMenuProps``
-------------------------------

.. CG-BLOCK id=interface:DropdownMenuProps lines=117-129

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataToolbar.tsx
   :language: tsx
   :lines: 117-129
   :lineno-match:

.. CG-EXPLANATION-START id=interface:DropdownMenuProps

**What this does.** The props for the dropdown widget: its label, an optional icon, a highlight flag, a testid, the list of menu rows, and the translator function.

**Why it is here.** The comment explains the translator is passed in rather than fetched again inside, so the menu's accessible name is built from the very same already-translated label the button shows.

.. CG-EXPLANATION-END id=interface:DropdownMenuProps

``function DropdownMenu``
-------------------------

.. CG-BLOCK id=function:DropdownMenu lines=130-167

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataToolbar.tsx
   :language: tsx
   :lines: 130-167
   :lineno-match:

.. CG-EXPLANATION-START id=function:DropdownMenu

**What this does.** Draws the import 'knob' — a button (with the proper menu accessibility attributes and a chevron that rotates when open) that toggles a menu, and, when open, renders the shared portal menu positioned at the button.

**Why it is here.** The comment records the design: the trigger stays local so the Data stage keeps its own accent highlight and rotating chevron, but the menu body reuses the shared ``PortalMenu`` (this was the third copy of the portalled-menu pattern, so it was de-duplicated). The menu is drawn through a portal and fixed-positioned so it escapes the toolbar's clipped, 40-pixel-tall left zone — a plain in-place menu was clipped away and invisible.

.. CG-EXPLANATION-END id=function:DropdownMenu

