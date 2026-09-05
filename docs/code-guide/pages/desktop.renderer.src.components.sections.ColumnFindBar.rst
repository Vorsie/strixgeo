desktop.renderer.src.components.sections.ColumnFindBar
======================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/ColumnFindBar.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/ColumnFindBar.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-19

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ColumnFindBar.tsx
   :language: tsx
   :lines: 1-19
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the file for the Ctrl+F find bar on a cross-section — type a column name like 's8' and jump to it. The imports bring in React's memory and lifecycle tools (*hooks*), the name-matching helper, and the translation helper.

**Why it is here.** The owner asked for this on 2026-08-17 so he could go straight to a named column header on a busy section. The keyboard behaviour deliberately mirrors every find bar the engineer already knows (Enter for next, Shift+Enter for previous, Esc to close), and the first match jumps as you type so typing the name is usually the whole interaction.

.. CG-EXPLANATION-END id=module-header

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=20-28

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ColumnFindBar.tsx
   :language: tsx
   :lines: 20-28
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** The inputs: every placed column on the open section, a callback to perform a jump (pan the view so a column is centred), and a callback to close the bar.

**Why it is here.** The bar is presentational — it owns only the search text and which match is current, while the parent owns the list of columns and does the actual panning. Keeping the jump in the parent's hands lets the bar stay simple and testable.

.. CG-EXPLANATION-END id=interface:Props

``function ColumnFindBar``
--------------------------

.. CG-BLOCK id=function:ColumnFindBar lines=29-106

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ColumnFindBar.tsx
   :language: tsx
   :lines: 29-106
   :lineno-match:

.. CG-EXPLANATION-START id=function:ColumnFindBar

**What this does.** The component. It holds the typed query and the current match number as *state* (values it remembers between redraws), keeps a *ref* (a handle) to the text box so it can grab the keyboard on open, recomputes the matching columns, and provides a wrapped jump that cycles safely past the ends of the match list. It draws a small floating search box with a match counter and a close button.

**Why it is here.** The current match number is clamped so it never points past a narrowed list. Typing jumps to the first match immediately because typing the name is the gesture — a separate confirm press would only add friction on the common path. The box grabs focus on open because the bar exists to be typed into.

.. CG-EXPLANATION-END id=function:ColumnFindBar

