desktop.renderer.src.hooks.useClickDebounce
===========================================

.. CG-PAGE source=desktop/src/renderer/src/hooks/useClickDebounce.ts complete=true

*Source file:* ``desktop/src/renderer/src/hooks/useClickDebounce.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-24

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useClickDebounce.ts
   :language: typescript
   :lines: 1-24
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file comment and the three-hook import. It explains the problem: a click fires on EVERY click, including the first half of a double-click, before the double-click event arrives — so a destructive single-click handler that shares a surface with a double-click intent would already have committed before the double-click ever runs. This hook adds a small delay window to hold the single-click action back.

**Why it is here.** The comment lays out how to wire it: ``schedule()`` queues the single-click action on a timer and ``cancel()`` clears it, so connecting the click to ``schedule`` and the double-click to ``cancel`` means the single-click action only fires when no double-click follows within the window. It warns that any input-derived state (cursor depth, held modifier keys) must be captured at click time and passed into the queued action, because the deferred call runs later, when the on-screen state may have moved.

.. CG-EXPLANATION-END id=module-header

``interface ClickDebounce``
---------------------------

.. CG-BLOCK id=interface:ClickDebounce lines=25-64

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useClickDebounce.ts
   :language: typescript
   :lines: 25-64
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ClickDebounce

**What this does.** The result shape: ``schedule(fn)`` queues an action (replacing any already-queued one), and ``cancel()`` drops a pending action. These lines also carry the documentation of the hook itself below.

**Why it is here.** The doc records that a rapid second click resets the timer rather than firing two staggered actions, and that ``cancel`` is meant to be wired to the double-click on the same element so the double-click intent cleanly drops the single-click action.

.. CG-EXPLANATION-END id=interface:ClickDebounce

``function useClickDebounce``
-----------------------------

.. CG-BLOCK id=function:useClickDebounce lines=65-91

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useClickDebounce.ts
   :language: typescript
   :lines: 65-91
   :lineno-match:

.. CG-EXPLANATION-START id=function:useClickDebounce

**What this does.** The hook. It keeps the pending timer in a *ref* (the hook building-blocks introduced on the ``desktop.renderer.src.hooks.usePersistedJSON`` page). ``cancel`` clears any running timer; ``schedule`` first cancels a prior timer, then starts a new one that runs the queued action after the delay (default 250 ms); an *effect* clears the timer if the component goes away.

**Why it is here.** The 250 ms window is chosen over the operating system's usual 500 ms because that felt sluggish on the section editor for engineers used to fast placement (it matches the macOS app-level double-click interval, per the doc). The unmount cleanup stops a deferred action from firing against a component that no longer exists.

.. CG-EXPLANATION-END id=function:useClickDebounce

