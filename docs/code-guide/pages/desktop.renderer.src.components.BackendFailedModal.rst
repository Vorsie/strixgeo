desktop.renderer.src.components.BackendFailedModal
==================================================

.. CG-PAGE source=desktop/src/renderer/src/components/BackendFailedModal.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/BackendFailedModal.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-28

.. literalinclude:: ../../../desktop/src/renderer/src/components/BackendFailedModal.tsx
   :language: tsx
   :lines: 1-28
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring and imports for the fatal-backend-crash modal, shown when the Python engine process exits before the app is ready. It imports ``useEffect`` and ``useRef``, a portal helper, and the translator.

**Why it is here.** The docstring records the design: the modal listens for the engine-failed signal from the main Electron process (over the inter-process channel between the window and the main process), and because the app cannot function without the engine it is deliberately NOT dismissible — no Escape, no backdrop-close, only a Quit button. It does not reuse the shared ``Modal`` precisely because that one supports Escape and backdrop-close, which must both be disabled here, and it is marked up as an alert-dialog because it is a fatal state the user must acknowledge.

.. CG-EXPLANATION-END id=module-header

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=29-46

.. literalinclude:: ../../../desktop/src/renderer/src/components/BackendFailedModal.tsx
   :language: tsx
   :lines: 29-46
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** The modal's two inputs: whether it is visible, and the path to the logs directory (or none if unavailable).

**Why it is here.** The logs path is passed in so the modal can point the user at the engine's log file for diagnosis, which is the one useful thing left to do when the engine has crashed on startup.

.. CG-EXPLANATION-END id=interface:Props

``function BackendFailedModal``
-------------------------------

.. CG-BLOCK id=function:BackendFailedModal lines=47-113

.. literalinclude:: ../../../desktop/src/renderer/src/components/BackendFailedModal.tsx
   :language: tsx
   :lines: 47-113
   :lineno-match:

.. CG-EXPLANATION-START id=function:BackendFailedModal

**What this does.** The modal component. It focuses the Quit button when it opens, draws nothing when closed, and otherwise draws — through a portal into the page body — a non-dismissible full-window overlay with a red title, an explanation, the log-file path when known, and a single Quit button that tells the main process the user consented to quit.

**Why it is here.** It is drawn through a portal at the very top layer so nothing can sit over a fatal message, and it has no backdrop click handler on purpose so it cannot be dismissed. Quit reuses the standard quit-decision channel so the main process's confirmed-quit guard is exercised and the window does not fall into a recursive close. Auto-focusing Quit gives the keyboard a single obvious action on this dead-end screen.

.. CG-EXPLANATION-END id=function:BackendFailedModal

