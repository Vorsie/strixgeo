desktop.renderer.src.utils.keyboard
===================================

.. CG-PAGE source=desktop/src/renderer/src/utils/keyboard.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/keyboard.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-23

.. literalinclude:: ../../../desktop/src/renderer/src/utils/keyboard.ts
   :language: typescript
   :lines: 1-23
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file gathers small keyboard helpers shared by any on-screen piece that listens for global shortcuts — Escape, the arrow keys, Delete, and Ctrl-key combinations. Today it holds just one, ``isTypingTarget``.

**Why it is here.** The header comment records why the file exists: the same check had been copied into three places (the borehole log, the sidebar, and the lab-test panel), so it was pulled out into one shared home — the project's "extract on the third copy" rule (CLAUDE.md). The comment also notes what belongs here next as more keyboard helpers accumulate.

.. CG-EXPLANATION-END id=module-header

``function isTypingTarget``
---------------------------

.. CG-BLOCK id=function:isTypingTarget lines=24-29

.. literalinclude:: ../../../desktop/src/renderer/src/utils/keyboard.ts
   :language: typescript
   :lines: 24-29
   :lineno-match:

.. CG-EXPLANATION-START id=function:isTypingTarget

**What this does.** A pure function — one whose answer depends only on its input, with no side effects, so it is safe to call as often as you like — that says whether the thing the user's keypress landed on is a place they are typing. It answers true for a text box (``<input>``), a multi-line box (``<textarea>``), a dropdown (``<select>``), or any element marked editable, and false for anything that is not even an on-screen element (the whole document, the window).

**Why it is here.** The comment records the rule: a global shortcut must step aside while the user is actually editing text — an arrow key should move the typing caret, not the sample cursor, and Delete should remove one character, not bulk-remove a whole selection. The first check is deliberately defensive against keypress sources that are not page elements at all, which simply fall through to false.

.. CG-EXPLANATION-END id=function:isTypingTarget

