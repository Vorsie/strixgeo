desktop.renderer.src.hooks.useToasts
====================================

.. CG-PAGE source=desktop/src/renderer/src/hooks/useToasts.ts complete=true

*Source file:* ``desktop/src/renderer/src/hooks/useToasts.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-26

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useToasts.ts
   :language: typescript
   :lines: 1-26
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file comment and the two-hook import. *Toasts* are the small messages that appear briefly in a corner of the screen. The comment lays out the module's few moving parts and its two behaviour rules.

**Why it is here.** This state was pulled out of the main ``App`` component so the ``toast`` function can be handed to the other hooks as an input, without dragging in all of App's machinery. The comment records two owner rulings: errors never auto-dismiss (an action-required message must not vanish before the engineer notices it — audit 2026-08-02), and a *recurring* toast that carries a repeat key replaces itself in place instead of piling up (owner dogfeed 2026-08-15, so hammering a hotkey does not flood the screen).

.. CG-EXPLANATION-END id=module-header

``const TOAST_TIMEOUT_MS``
--------------------------

.. CG-BLOCK id=const:TOAST_TIMEOUT_MS lines=27-29

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useToasts.ts
   :language: typescript
   :lines: 27-29
   :lineno-match:

.. CG-EXPLANATION-START id=const:TOAST_TIMEOUT_MS

**What this does.** How long a non-error toast stays on screen before it removes itself: 4000 milliseconds, i.e. four seconds.

**Why it is here.** One named value for the auto-dismiss delay, so the timer and any future reference to it share a single source.

.. CG-EXPLANATION-END id=const:TOAST_TIMEOUT_MS

``interface Toast``
-------------------

.. CG-BLOCK id=interface:Toast lines=30-52

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useToasts.ts
   :language: typescript
   :lines: 30-52
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Toast

**What this does.** The shape of one live notification: a numeric id, a type (success, error or warning), the message text, a ``sticky`` flag (true when it waits for a click instead of expiring), and an optional ``replaceKey``.

**Why it is here.** ``sticky`` is derived from the type — errors are sticky — rather than chosen per call, because a per-call flag would let a future caller re-introduce a self-dismissing error, which is the exact bug this closes. ``replaceKey`` marks a recurring announcement so the next one of its kind takes this toast's place instead of stacking beside it.

.. CG-EXPLANATION-END id=interface:Toast

``interface UseToastsResult``
-----------------------------

.. CG-BLOCK id=interface:UseToastsResult lines=53-87

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useToasts.ts
   :language: typescript
   :lines: 53-87
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseToastsResult

**What this does.** What the hook hands back: the live ``toasts`` list to draw as the stack, the ``toast`` action that shows one, and ``dismissToast`` that removes one by id.

**Why it is here.** Naming the return shape lets callers see exactly what they get. The doc-comment records that when ``toast`` is given a replace key, a live toast already carrying that key is replaced where it stands — same slot, new message, fresh four-second window — so repeating a hotkey shows one updating toast rather than a column of identical ones.

.. CG-EXPLANATION-END id=interface:UseToastsResult

``function useToasts``
----------------------

.. CG-BLOCK id=function:useToasts lines=88-129

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useToasts.ts
   :language: typescript
   :lines: 88-129
   :lineno-match:

.. CG-EXPLANATION-START id=function:useToasts

**What this does.** The hook. It keeps the toast list in *state* and an incrementing id counter in a *ref* (the hook building-blocks introduced on the ``desktop.renderer.src.hooks.usePersistedJSON`` page). ``toast`` mints the next id, marks errors as sticky, and either appends the toast or — when a replace key matches a live toast — swaps it in place; a non-error toast then schedules its own removal after the timeout. ``dismissToast`` removes a toast by id.

**Why it is here.** The id counter is a ref so bumping it never triggers a redraw. ``toast`` and ``dismissToast`` are written as plain functions rather than cached with ``useCallback`` on purpose: they read only from the ref, so they never go stale, and keeping them out of ``useCallback`` stops them appearing in other hooks' dependency lists and causing false re-subscription loops (comment). A replaced toast's old timer is left to expire harmlessly, because it names an id that is no longer in the stack and so removes nothing.

.. CG-EXPLANATION-END id=function:useToasts

