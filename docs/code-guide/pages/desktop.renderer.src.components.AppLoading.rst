desktop.renderer.src.components.AppLoading
==========================================

.. CG-PAGE source=desktop/src/renderer/src/components/AppLoading.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/AppLoading.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-20

.. literalinclude:: ../../../desktop/src/renderer/src/components/AppLoading.tsx
   :language: tsx
   :lines: 1-20
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top comment, docstring and single import for the loading screen shown while the app waits for the engine to answer. It imports only the translator.

**Why it is here.** Like the boot-error screen, this was split out of the top component's early return (debt #12): the guard that chooses it stays there to respect the rules of hooks, and only the drawing lives here (see the ``App`` and ``AppBootError`` pages).

.. CG-EXPLANATION-END id=module-header

``function AppLoading``
-----------------------

.. CG-BLOCK id=function:AppLoading lines=21-29

.. literalinclude:: ../../../desktop/src/renderer/src/components/AppLoading.tsx
   :language: tsx
   :lines: 21-29
   :lineno-match:

.. CG-EXPLANATION-START id=function:AppLoading

**What this does.** Draws a centred full-window spinner with a "starting the engine" message.

**Why it is here.** A plain, stateless screen shown in the gap between the app booting and the engine confirming it is ready, so the window shows motion instead of sitting blank while the health-check is still pending.

.. CG-EXPLANATION-END id=function:AppLoading

