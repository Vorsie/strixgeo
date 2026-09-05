desktop.renderer.src.shell.StageErrorBoundary
=============================================

.. CG-PAGE source=desktop/src/renderer/src/shell/StageErrorBoundary.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/StageErrorBoundary.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-23

.. literalinclude:: ../../../desktop/src/renderer/src/shell/StageErrorBoundary.tsx
   :language: tsx
   :lines: 1-23
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This is the crash guard wrapped around a single stage's centre area (audit M5). Its opening docstring explains the problem it solves and the imports it uses. An *error boundary* is a special React piece that catches a crash happening while its children are being drawn and shows a fallback in their place instead of letting the whole app go blank. This one wraps just one stage slot. The imports bring in React, the logger, the local diagnostics capture, and the translation function.

**Why it is here.** The docstring states the reasoning directly: the shell's single top-level guard replaces the *whole* app on any draw-time crash, so a bug in one large stage canvas would blank the spine, the inspector and every other stage, with a full reload — losing all unsaved on-screen state — the only way back. Wrapping one stage instead means a crash there shows a small "reset this stage" card in that slot while everything around it keeps working. It also records why this piece is written as a *class component* (an older, object-style way of writing a component): only class components can be error boundaries, because the two React features that catch a crash have no ``use…`` hook form. The comment on the translation import notes that, being a class, it cannot use the translation hook, so it reads the active language through the plain function at draw time — acceptable because a crash card is not expected to survive a live language switch.

.. CG-EXPLANATION-END id=module-header

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=24-35

.. literalinclude:: ../../../desktop/src/renderer/src/shell/StageErrorBoundary.tsx
   :language: tsx
   :lines: 24-35
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** Describes the inputs the guard takes: the ``children`` it protects (the stage's subtree), a ``resetKey`` that identifies which stage is wrapped, and an optional ``onReset`` function fired when the user presses Reset.

**Why it is here.** The comment on ``resetKey`` records its job: it carries the active stage's id, and when it changes — because the user navigated to a *different* stage — any still-standing crash card is cleared, so moving to another stage shows that stage rather than the crashed one's card.

.. CG-EXPLANATION-END id=interface:Props

``interface State``
-------------------

.. CG-BLOCK id=interface:State lines=36-54

.. literalinclude:: ../../../desktop/src/renderer/src/shell/StageErrorBoundary.tsx
   :language: tsx
   :lines: 36-54
   :lineno-match:

.. CG-EXPLANATION-START id=interface:State

**What this does.** Describes what the guard remembers between redraws: whether it is currently showing a crash (``hasError``), the crash ``message`` to display, and a ``remountToken`` number.

**Why it is here.** The comment on ``remountToken`` records its purpose: it is bumped when the user presses Reset, and because it is used as the wrapped area's key, changing it forces React to throw the crashed stage away and build it completely fresh — merely clearing the error flag would redraw the same still-broken subtree.

.. CG-EXPLANATION-END id=interface:State

``class StageErrorBoundary``
----------------------------

.. CG-BLOCK id=class:StageErrorBoundary lines=55-136

.. literalinclude:: ../../../desktop/src/renderer/src/shell/StageErrorBoundary.tsx
   :language: tsx
   :lines: 55-136
   :lineno-match:

.. CG-EXPLANATION-START id=class:StageErrorBoundary

**What this does.** The guard itself. When a crash happens while drawing the stage, React hands it here: it records that an error occurred and captures the message; logs the crash naming which stage died; writes the same detail into the local diagnostics bundle; and, when available, forwards it to the main process's log file. While an error stands it draws the fallback card — a red heading, an explanatory line, the raw message, and a Reset button that takes focus. Pressing Reset calls the optional reset hook and bumps the remount token so the stage rebuilds fresh. If the user instead navigates to a different stage, a separate check clears the crash so the new stage draws normally. When there is no error, it simply draws its children, keyed by the remount token.

**Why it is here.** The docstring and comments record the design. It is a class because only a class can catch a draw-time crash. The diagnostics capture uses the same local bridge the top-level guard and the global handlers use, so "which stage died and why" reaches the support bundle (debt #16). The comment on the navigate-away check notes it acts only while an error is standing, so a normal redraw never resets anything by accident. And the comment on Reset explains why the token must change rather than just clearing the flag: without a fresh key React would re-draw the identical, still-crashing subtree. The net effect is the audit-M5 promise — a crash in one stage is contained to that stage's card, and the spine, toolbar, inspector and other stages keep working.

.. CG-EXPLANATION-END id=class:StageErrorBoundary

