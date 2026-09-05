desktop.renderer.src.components.ErrorBoundary
=============================================

.. CG-PAGE source=desktop/src/renderer/src/components/ErrorBoundary.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/ErrorBoundary.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-28

.. literalinclude:: ../../../desktop/src/renderer/src/components/ErrorBoundary.tsx
   :language: tsx
   :lines: 1-28
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring and imports for the top-level error boundary. The docstring explains it catches render exceptions React cannot recover from and shows a fallback screen — with the log-file location and a Reload button — instead of a blank window, and notes that a native renderer crash (out-of-memory, GPU fault) is a different thing caught elsewhere. It imports React, the logger, and the module-level translator.

**Why it is here.** The comment explains why it uses the plain translator rather than the ``useT`` hook: this is a *class component* — an older React style written as a class rather than a function — and class components cannot call hooks. An error screen is shown after a crash and is not expected to re-draw on a live language switch, so reading the language once at render time is fine. An error boundary must be a class because only the class form has the error-catching lifecycle methods React calls.

.. CG-EXPLANATION-END id=module-header

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=29-34

.. literalinclude:: ../../../desktop/src/renderer/src/components/ErrorBoundary.tsx
   :language: tsx
   :lines: 29-34
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** The boundary's inputs: the app subtree it protects, and an optional logs-path override for tests.

**Why it is here.** The children are what it wraps and guards; the logs-path override lets a test supply the path directly instead of going through the main process.

.. CG-EXPLANATION-END id=interface:Props

``interface State``
-------------------

.. CG-BLOCK id=interface:State lines=35-51

.. literalinclude:: ../../../desktop/src/renderer/src/components/ErrorBoundary.tsx
   :language: tsx
   :lines: 35-51
   :lineno-match:

.. CG-EXPLANATION-START id=interface:State

**What this does.** The boundary's remembered state: whether an error has been caught, the error message, and the logs path (or none).

**Why it is here.** It has to remember that a crash happened so it can keep showing the fallback instead of re-attempting the broken subtree, and hold the message and log path to display on that fallback.

.. CG-EXPLANATION-END id=interface:State

``class ErrorBoundary``
-----------------------

.. CG-BLOCK id=class:ErrorBoundary lines=52-134

.. literalinclude:: ../../../desktop/src/renderer/src/components/ErrorBoundary.tsx
   :language: tsx
   :lines: 52-134
   :lineno-match:

.. CG-EXPLANATION-START id=class:ErrorBoundary

**What this does.** The error-boundary class. When a child throws, one lifecycle method flips it into the error state with the message, and another logs the error and its component stack (also forwarding it to the main process log when the bridge is present). On mount it fetches the logs directory path from the main process for the fallback screen. Its draw method shows the children normally, or — once an error is caught — a centred fallback with a red title, the message, the log-file path, and a Reload button.

**Why it is here.** This is the last line of defence: a thrown exception anywhere in the component tree is caught here and turned into a readable screen rather than a blank window, and it is logged both locally and to the main process so a user-reported crash is diagnosable. The log-path fetch is best-effort — skipped silently when the bridge is unavailable (tests, early boot) — and the Reload button simply reloads the window, which reloads state from the database, since the interpretation was never in the window to begin with.

.. CG-EXPLANATION-END id=class:ErrorBoundary

