desktop.renderer.src.components.BackendUnreachableBanner
========================================================

.. CG-PAGE source=desktop/src/renderer/src/components/BackendUnreachableBanner.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/BackendUnreachableBanner.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-39

.. literalinclude:: ../../../desktop/src/renderer/src/components/BackendUnreachableBanner.tsx
   :language: tsx
   :lines: 1-39
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring and imports for the "backend unreachable" banner, shown while the engine has stopped answering mid-session. It imports React's ``useSyncExternalStore`` hook, the shared reachability store's read and subscribe functions, and the translator.

**Why it is here.** The docstring records three decisions born from a real incident (2026-08-02, the engine died mid-session and the app said nothing). It is a banner, not a toast, because it reports a condition that is still true and must stay until it clears, not an event that already happened. It does not block, because reading and copying what is on screen are the only useful things left and an overlay would prevent both. And it says "restart" rather than offering Retry, because the window cannot know what the half-finished session wrote — a Retry that appeared to work would be the more dangerous message — while restarting reloads state from the database, which outlived the window (``docs/design/autosave-recovery.md``).

.. CG-EXPLANATION-END id=module-header

``const NEVER_UNREACHABLE_ON_SERVER``
-------------------------------------

.. CG-BLOCK id=const:NEVER_UNREACHABLE_ON_SERVER lines=40-53

.. literalinclude:: ../../../desktop/src/renderer/src/components/BackendUnreachableBanner.tsx
   :language: tsx
   :lines: 40-53
   :lineno-match:

.. CG-EXPLANATION-START id=const:NEVER_UNREACHABLE_ON_SERVER

**What this does.** A tiny fixed function that always answers "not unreachable", used as the server-rendering fallback for the store hook.

**Why it is here.** It is defined once at module level (per its docstring) so its reference is stable across redraws — an inline version would be a fresh function each time, the shape React warns about. The desktop never server-renders, so this only exists to keep the hook's three-argument form safe if some future surface ever does.

.. CG-EXPLANATION-END id=const:NEVER_UNREACHABLE_ON_SERVER

``function BackendUnreachableBanner``
-------------------------------------

.. CG-BLOCK id=function:BackendUnreachableBanner lines=54-83

.. literalinclude:: ../../../desktop/src/renderer/src/components/BackendUnreachableBanner.tsx
   :language: tsx
   :lines: 54-83
   :lineno-match:

.. CG-EXPLANATION-START id=function:BackendUnreachableBanner

**What this does.** The banner component. It reads whether the engine is unreachable from the shared reachability store, drawing a top-centred red alert banner while it is and nothing when the engine is fine.

**Why it is here.** It reads the store through ``useSyncExternalStore`` — React's built-in way to re-draw when a shared module-level *store* changes — so a storm of failed requests re-draws the banner once per state change, not once per failed request. The banner is placed above the toast stack because when nothing is landing, this condition outranks any single action's outcome, and it is marked up as an alert so assistive tools announce it at once.

.. CG-EXPLANATION-END id=function:BackendUnreachableBanner

