desktop.main.prototypeFlags
===========================

.. CG-PAGE source=desktop/src/main/prototypeFlags.ts complete=true

*Source file:* ``desktop/src/main/prototypeFlags.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-27

.. literalinclude:: ../../../desktop/src/main/prototypeFlags.ts
   :language: typescript
   :lines: 1-27
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring introduces this tiny file as the pure yes/no gates for the app's prototype-only launch surfaces, living in the main process (the part of the app with full computer access, as opposed to the renderer, the sandboxed web page the user sees). It is kept free of Electron so its decisions can be unit-tested.

**Why it is here.** These gates control features that are part of an unfinished prototype — the onboarding, licensing and updater experiment — which must behave differently in a real shipped build versus a developer's machine. Isolating the decisions as pure functions here, fed the 'is this a packaged build?' fact from ``index.ts``, means the same rule can be proved correct in tests and mirrored in the page, rather than buried inline in the huge startup file.

.. CG-EXPLANATION-END id=module-header

``function previewControlAllowed``
----------------------------------

.. CG-BLOCK id=function:previewControlAllowed lines=28-54

.. literalinclude:: ../../../desktop/src/main/prototypeFlags.ts
   :language: typescript
   :lines: 28-54
   :lineno-match:

.. CG-EXPLANATION-START id=function:previewControlAllowed

**What this does.** Answers whether the prototype-only 'Preview a state' control should be available — it returns yes only for a development (unpackaged) build.

**Why it is here.** That control jumps the licence system into any state so the owner can see every screen without waiting out a clock — a handy dev tool that must never ship. Gating both the message handler and the on-screen row behind this single function ensures a packaged customer build never carries it.

.. CG-EXPLANATION-END id=function:previewControlAllowed

``function e2eLaunchFlag``
--------------------------

.. CG-BLOCK id=function:e2eLaunchFlag lines=55-57

.. literalinclude:: ../../../desktop/src/main/prototypeFlags.ts
   :language: typescript
   :lines: 55-57
   :lineno-match:

.. CG-EXPLANATION-START id=function:e2eLaunchFlag

**What this does.** Computes the ``e2e`` flag shown to the page — true only when the ``STRIX_E2E`` environment variable is set to ``1`` AND the build is unpackaged. (An environment variable is a named setting passed to a program by whatever launched it.)

**Why it is here.** ``STRIX_E2E=1`` tells the app it is running under the automated end-to-end test harness (driven by a tool called Playwright) so it can skip the onboarding pop-up and the licence start screen and not brick the test run. But that flag must never be honoured in a shipped build — a customer or attacker who set ``STRIX_E2E=1`` could otherwise walk straight past the licence gate. Since the harness only ever runs an unpackaged build, also requiring 'unpackaged' costs the tests nothing and closes the bypass.

.. CG-EXPLANATION-END id=function:e2eLaunchFlag

