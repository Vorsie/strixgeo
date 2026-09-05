desktop.renderer.src.hooks.useAppBoot
=====================================

.. CG-PAGE source=desktop/src/renderer/src/hooks/useAppBoot.ts complete=true

*Source file:* ``desktop/src/renderer/src/hooks/useAppBoot.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-17

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useAppBoot.ts
   :language: typescript
   :lines: 1-17
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's opening comment and its imports. It pulls in three React *hooks* — ``useEffect``, ``useRef`` and ``useState`` (a hook is a helper whose name starts with ``use…`` that lets a piece of interface remember a value or run a side task) — plus ``setBaseUrl`` from the app's API client and the shared logger.

**Why it is here.** This little file is the app's *boot* routine: it waits for the engine — the Electron-hosted Python program that does all the real work — to become reachable before the rest of the interface tries to use it. The comment records the one rule that shapes everything here: the wait begins once per window, and only after the activation *gate* is open. A packaged, installed build that is sitting blocked on the licence screen has its engine deliberately not started yet, so asking the main program "is the engine ready?" then correctly answers "not running" — which is normal, not a crash (installer #7, 2026-09-03). ``getApiBaseUrl`` supplies the web address (with the port the Python program reported back), and ``waitForApi`` keeps asking the engine's health-check until it answers or a time limit runs out.

.. CG-EXPLANATION-END id=module-header

``interface UseAppBootResult``
------------------------------

.. CG-BLOCK id=interface:UseAppBootResult lines=18-47

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useAppBoot.ts
   :language: typescript
   :lines: 18-47
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseAppBootResult

**What this does.** Declares the shape of the answer this hook hands back: ``ready`` becomes true once the engine confirms it is accepting connections, and ``apiError`` becomes true if the engine failed to start inside its time budget. The long comment underneath is the hook's own documentation — its one input ``gateOpen``, the fact that it calls ``getApiBaseUrl`` and then ``waitForApi`` (both supplied by Electron's preload bridge), and what each of the two returned flags means for the screen shown.

**Why it is here.** An *interface* is just a note describing which fields a value carries; it is checked before the app runs and then disappears. Naming the return shape here lets the top ``App`` component read ``{ ready, apiError }`` and decide plainly which screen to draw — a loading splash, an error card, or the real app. The renderer never builds the engine's web address itself; those two calls are injected by the preload (the guarded bridge between the sandboxed page and the main program), which is why they appear as ``window.electron`` calls rather than ordinary code here.

.. CG-EXPLANATION-END id=interface:UseAppBootResult

``function useAppBoot``
-----------------------

.. CG-BLOCK id=function:useAppBoot lines=48-75

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useAppBoot.ts
   :language: typescript
   :lines: 48-75
   :lineno-match:

.. CG-EXPLANATION-START id=function:useAppBoot

**What this does.** The hook itself. It keeps two pieces of remembered *state* — ``ready`` and ``apiError``, both starting false — and one *ref*, ``startedRef``, that simply records whether boot has already begun. Inside an *effect* (code that runs after a redraw) that re-checks whenever ``gateOpen`` changes: if the gate is not open yet, or boot already started, it does nothing; otherwise it marks boot as started and runs a small ``async`` routine — fetch the engine's base address, hand it to the API client, log it, then wait on ``waitForApi``. If the engine answers it logs "API ready" and sets ``ready`` to true; if the wait times out it logs the failure and sets ``apiError`` to true. It returns the current ``{ ready, apiError }``.

**Why it is here.** A *ref* is used as the run-once guard (rather than state) because changing a ref does not trigger a redraw — so the poll can never accidentally restart itself. The effect lists ``gateOpen`` as its trigger so the wait starts at the exact moment the activation gate opens and never a moment before, honouring the deferred-engine rule in the file's comment (a blocked packaged build has no engine to reach yet). ``async``/``await`` lets the routine pause for the port and the health-check without freezing the interface, so the loading splash stays responsive while the engine comes up.

.. CG-EXPLANATION-END id=function:useAppBoot

