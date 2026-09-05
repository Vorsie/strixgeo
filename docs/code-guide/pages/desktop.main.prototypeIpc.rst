desktop.main.prototypeIpc
=========================

.. CG-PAGE source=desktop/src/main/prototypeIpc.ts complete=true

*Source file:* ``desktop/src/main/prototypeIpc.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-19

.. literalinclude:: ../../../desktop/src/main/prototypeIpc.ts
   :language: typescript
   :lines: 1-19
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring explains this file registers the message handlers for the launch-prototype features in the main process — the app half with full computer access, as opposed to the renderer, the sandboxed web page the user sees. These handlers answer requests the page sends over IPC (inter-process communication — how the page asks the main process to do something and awaits a reply). The imports bring in the licence state types, the activation service, and the three updater actions. The note says every handler here is a thin adapter that only checks the request's shape and forwards to the real service.

**Why it is here.** The handlers were pulled out of the already-huge ``index.ts`` so that god-component (debt #201) does not grow further; the licensing (#3) and updater (#6) wiring lives here instead, and ``index.ts`` just calls one register function. Keeping the handlers as thin pass-throughs — no business logic — means the tested services stay the single home of the actual behaviour.

.. CG-EXPLANATION-END id=module-header

``const PREVIEWABLE_STATES``
----------------------------

.. CG-BLOCK id=const:PREVIEWABLE_STATES lines=20-30

.. literalinclude:: ../../../desktop/src/main/prototypeIpc.ts
   :language: typescript
   :lines: 20-30
   :lineno-match:

.. CG-EXPLANATION-START id=const:PREVIEWABLE_STATES

**What this does.** A fixed set listing every licence state the prototype's preview control is allowed to request — unactivated, trial, active, grace, expired, clock-rollback and device-mismatch.

**Why it is here.** The preview handler checks a requested state against this set and ignores anything not in it, so a stray or crafted value cannot push the licence system into a state that does not exist.

.. CG-EXPLANATION-END id=const:PREVIEWABLE_STATES

``interface PrototypeIpcOptions``
---------------------------------

.. CG-BLOCK id=interface:PrototypeIpcOptions lines=31-52

.. literalinclude:: ../../../desktop/src/main/prototypeIpc.ts
   :language: typescript
   :lines: 31-52
   :lineno-match:

.. CG-EXPLANATION-START id=interface:PrototypeIpcOptions

**What this does.** Describes the two settings passed when registering the handlers: ``previewControl`` (whether to register the dev-only 'preview a state' handler at all) and an optional ``onActivated`` callback run once after a successful activation. (A callback is a function you hand to something else to run later.)

**Why it is here.** ``previewControl`` is set to false in a packaged build so the demo control simply is never wired up there — it cannot ship. The ``onActivated`` hook exists because, while the app is blocked at the licence gate, the main process holds the backend back and needs a signal to start it the moment activation succeeds.

.. CG-EXPLANATION-END id=interface:PrototypeIpcOptions

``function registerPrototypeIpc``
---------------------------------

.. CG-BLOCK id=function:registerPrototypeIpc lines=53-105

.. literalinclude:: ../../../desktop/src/main/prototypeIpc.ts
   :language: typescript
   :lines: 53-105
   :lineno-match:

.. CG-EXPLANATION-START id=function:registerPrototypeIpc

**What this does.** Registers all the activation and updater request handlers. For activation it wires up: report status, activate a key (rejecting an empty key, and running ``onActivated`` on success), start a free trial, deactivate or transfer the device (logging the outcome), and — only when ``previewControl`` is on — the dev preview-state jump. For the updater it wires check, download, and quit-and-install.

**Why it is here.** This is the single wiring point connecting the page's licence and update buttons to the underlying services. The care in it reflects real rulings: deactivate is self-service seat transfer, so its outcome is logged (never the licence key itself) so a support report can tell whether the seat was actually freed; and the preview handler is registered only in a dev build so the demo path can never exist in a customer's copy.

.. CG-EXPLANATION-END id=function:registerPrototypeIpc

