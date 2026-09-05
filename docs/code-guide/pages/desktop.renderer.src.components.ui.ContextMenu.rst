desktop.renderer.src.components.ui.ContextMenu
==============================================

.. CG-PAGE source=desktop/src/renderer/src/components/ui/ContextMenu.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/ui/ContextMenu.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-30

.. literalinclude:: ../../../desktop/src/renderer/src/components/ui/ContextMenu.tsx
   :language: tsx
   :lines: 1-30
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's documentation comment and its one import. The comment says this single right-click menu replaces four earlier hand-written menus, so the positioned box, the row buttons, the danger and disabled styling, and — most importantly — the closing logic are written once. It notes that the closing behaviour used to be re-derived per copy and carried a latent double-close bug, and it lists the three placement modes chosen by a ``portal`` setting: inside the section drawing, at fixed window coordinates, or at coordinates inside the caller's own box. It imports two React hooks, ``useEffect`` and ``useState``.

**Why it is here.** Collapsing four copies into one is the project's rule to extract shared shape rather than keep parallel copies, and the payoff named here is correctness: only one of the old copies stopped a stray extra close, so the others silently fired their close twice — fixed once, here. This is the shared-primitive pattern introduced on the ``desktop.renderer.src.components.ui.Button`` page. The three placement modes exist because a menu drawn inside the section's vector canvas needs different handling from one drawn over ordinary page elements.

.. CG-EXPLANATION-END id=module-header

``interface ContextMenuItem``
-----------------------------

.. CG-BLOCK id=interface:ContextMenuItem lines=31-63

.. literalinclude:: ../../../desktop/src/renderer/src/components/ui/ContextMenu.tsx
   :language: tsx
   :lines: 31-63
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ContextMenuItem

**What this does.** Describes one row of the menu: its ``label``, the action fired when it is chosen, and optional flags — a red danger look, a disabled state, a ``reason`` line shown under a disabled row, a divider above the row, a test id, a stable key, hover-enter and hover-leave callbacks, and an optional nested submenu.

**Why it is here.** Describing each row as plain data lets a caller build a whole menu as a list and leaves the drawing to this component. The comment records two rules: an item's own action must not also call the menu's close, because the menu closes itself afterwards; and the hover-enter and hover-leave callbacks exist so a row can highlight, for example, the body an "un-join" item refers to, without firing the action. The submenu is honoured only by the section-canvas variant today.

.. CG-EXPLANATION-END id=interface:ContextMenuItem

``interface BaseProps``
-----------------------

.. CG-BLOCK id=interface:BaseProps lines=64-79

.. literalinclude:: ../../../desktop/src/renderer/src/components/ui/ContextMenu.tsx
   :language: tsx
   :lines: 64-79
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BaseProps

**What this does.** Lists the inputs common to every placement: the ``items`` rows (false entries are ignored so a caller can inline a condition), an optional ``header`` subtitle, the ``onClose`` handler, an accessibility label, a test id, and a minimum width.

**Why it is here.** Allowing false entries in the list lets a caller write ``condition && {…}`` inline without filtering the list first, which keeps the calling code readable. Splitting these shared inputs out lets the placement-specific inputs be added on top for each of the three modes.

.. CG-EXPLANATION-END id=interface:BaseProps

``type Props``
--------------

.. CG-BLOCK id=type:Props lines=80-97

.. literalinclude:: ../../../desktop/src/renderer/src/components/ui/ContextMenu.tsx
   :language: tsx
   :lines: 80-97
   :lineno-match:

.. CG-EXPLANATION-START id=type:Props

**What this does.** Defines the full input shape as one of two alternatives: the section-canvas mode, which additionally needs a width and height for its drawing box, or the fixed / container-local mode, which needs only a position.

**Why it is here.** This is a *union* of two shapes, so the type-checker forces the caller to supply exactly the extra values that placement needs — a canvas menu cannot be created without its box size, and a plain menu is not asked for one it would ignore.

.. CG-EXPLANATION-END id=type:Props

``const SVG_PANEL_STYLE``
-------------------------

.. CG-BLOCK id=const:SVG_PANEL_STYLE lines=98-106

.. literalinclude:: ../../../desktop/src/renderer/src/components/ui/ContextMenu.tsx
   :language: tsx
   :lines: 98-106
   :lineno-match:

.. CG-EXPLANATION-START id=const:SVG_PANEL_STYLE

**What this does.** A fixed set of inline styles for the dark panel used by the section-canvas menu — absolute position, an overlay background and border, rounded corners, a shadow and a high stacking order.

**Why it is here.** These styles are kept verbatim from the earlier canvas menus so the section-canvas look is unchanged after the merge into one component.

.. CG-EXPLANATION-END id=const:SVG_PANEL_STYLE

``const SVG_ITEM_STYLE``
------------------------

.. CG-BLOCK id=const:SVG_ITEM_STYLE lines=107-118

.. literalinclude:: ../../../desktop/src/renderer/src/components/ui/ContextMenu.tsx
   :language: tsx
   :lines: 107-118
   :lineno-match:

.. CG-EXPLANATION-START id=const:SVG_ITEM_STYLE

**What this does.** A fixed set of inline styles for one row inside the section-canvas menu — a full-width, left-aligned, small-text button with no background or border and a pointer cursor.

**Why it is here.** The companion to the panel style above, likewise carried over unchanged so the canvas menu rows look exactly as they did before the four menus were unified.

.. CG-EXPLANATION-END id=const:SVG_ITEM_STYLE

``function ContextMenu``
------------------------

.. CG-BLOCK id=function:ContextMenu lines=119-357

.. literalinclude:: ../../../desktop/src/renderer/src/components/ui/ContextMenu.tsx
   :language: tsx
   :lines: 119-357
   :lineno-match:

.. CG-EXPLANATION-START id=function:ContextMenu

**What this does.** The menu component. It reads its inputs, keeps one piece of *state* for which submenu is open, and runs two *effects*: one closes the menu on the Escape key, the other closes it on any click elsewhere in the document. It filters out the false rows, then branches on placement: the section-canvas branch draws the menu inside a vector wrapper with a full-window backdrop that also catches a right-click to close; the ordinary branch draws a positioned box with themed row buttons. In both, choosing an enabled row runs its action and then closes the menu, and clicks inside the menu are stopped from reaching the document-wide close.

**Why it is here.** The submenu *state* is declared unconditionally, above the placement branch, because the rules of hooks require every hook to be called in the same order on every redraw — a hook must never sit below a branch or an early return, even when only one branch reads it. The document-wide click listener is the reliable way to detect an outside click, because a full-window backdrop nested inside the section's vector canvas did not always cover the window in this app's browser engine, so a canvas click elsewhere missed it and the menu stayed open (dogfeed 2026-05-29). In the ordinary branch, choosing a row must stop the underlying native click, or the document listener would fire a second, redundant close — the exact latent bug only one of the old menus had guarded against.

.. CG-EXPLANATION-END id=function:ContextMenu

