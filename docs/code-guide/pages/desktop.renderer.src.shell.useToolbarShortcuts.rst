desktop.renderer.src.shell.useToolbarShortcuts
==============================================

.. CG-PAGE source=desktop/src/renderer/src/shell/useToolbarShortcuts.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/useToolbarShortcuts.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-28

.. literalinclude:: ../../../desktop/src/renderer/src/shell/useToolbarShortcuts.ts
   :language: typescript
   :lines: 1-28
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and brings in its tools. This is renderer code (the sandboxed web page the user actually sees). It adds single-key keyboard shortcuts for the verbs that live inside a toolbar's drop-down menus. The comment is careful to split the job in two: the *display* half — showing the little “(4)” after a menu item so the user learns the key — lives in ``ToolbarPrimitives``; this file is the *dispatch* half — while the toolbar is on screen, pressing that bare key actually runs the item, whether or not the menu happens to be open. It imports React's ``useEffect`` and ``useRef`` and the shape of a menu item from the primitives file next door.

**Why it is here.** This is the owner's request written into code (2026-08-31: “can we add like keyboard shortcuts to the dropdown in the top bar (like between parentheses at the back)”). The comment lists the guards in order, and each is a deliberate rule: a key pressed together with Ctrl, Alt or the Windows/Command key belongs to somebody else's shortcut and is left alone (plain Shift is tolerated so a future “?”-style key stays possible); a key press happening inside a text box is left for the typing, the same rule every global key in the app obeys (docs/ux.md, “All shortcuts skip when...”); and a greyed-out menu item never fires, so a key press can never do something a click could not. To make one keyboard listener enough, the current list of menu items is read through a *ref* — a remembered box whose contents can be swapped without redrawing — so the listener stays put even though each toolbar rebuilds its list of items on every redraw.

.. CG-EXPLANATION-END id=module-header

``function isTypingTarget``
---------------------------

.. CG-BLOCK id=function:isTypingTarget lines=29-45

.. literalinclude:: ../../../desktop/src/renderer/src/shell/useToolbarShortcuts.ts
   :language: typescript
   :lines: 29-45
   :lineno-match:

.. CG-EXPLANATION-START id=function:isTypingTarget

**What this does.** A small yes/no helper. Given whatever element the key press landed on, it answers “is this a place where the user is typing text?” — a text field, a multi-line text area, a drop-down select, or any freely editable region of the page. If the thing is not an on-screen element at all, it answers no.

**Why it is here.** Named on its own because the check reads more clearly with a plain name than as a tangle of conditions, and because the toolbar-shortcut rule is exactly the app-wide rule (docs/ux.md): typing surfaces own plain typing, so a global one-key shortcut must never snatch a keystroke that was meant to land in a form field.

.. CG-EXPLANATION-END id=function:isTypingTarget

``function useToolbarShortcuts``
--------------------------------

.. CG-BLOCK id=function:useToolbarShortcuts lines=46-62

.. literalinclude:: ../../../desktop/src/renderer/src/shell/useToolbarShortcuts.ts
   :language: typescript
   :lines: 46-62
   :lineno-match:

.. CG-EXPLANATION-START id=function:useToolbarShortcuts

**What this does.** The *hook* itself — a helper whose name starts with ``use`` that lets a component plug behaviour into React. It is handed the toolbar's full list of menu items. It stashes that list in a ref and keeps the ref pointed at the freshest list on every redraw. Then, once, it registers one *effect* — code that runs after drawing to do something outside drawing — which listens for key presses on the whole window: on each press it ignores modified keys and presses inside a text box, looks up the first still-enabled item whose declared shortcut matches the key, blocks the browser's own default for that key, and runs that item's action. Its cleanup removes the listener when the toolbar leaves the screen.

**Why it is here.** The docstring sets the contract: hand it the toolbar's whole fold-away set; only items that actually declare a shortcut take part; the first enabled match wins, so if two items ever claimed the same key that would be a wiring mistake the code makes visible by always firing the earlier one. The listener is attached only once (its dependency list is empty) precisely because it reaches the always-current items through the ref — so it never needs re-attaching when the item list is rebuilt, which it is on every single redraw.

.. CG-EXPLANATION-END id=function:useToolbarShortcuts

