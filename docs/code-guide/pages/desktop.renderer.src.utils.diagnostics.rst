desktop.renderer.src.utils.diagnostics
======================================

.. CG-PAGE source=desktop/src/renderer/src/utils/diagnostics.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/diagnostics.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-19

.. literalinclude:: ../../../desktop/src/renderer/src/utils/diagnostics.ts
   :language: typescript
   :lines: 1-19
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring introducing the renderer's seam for local crash capture: it hands a diagnostic to the main process, which filters, redacts, and appends it to a local log file, transmitting nothing anywhere.

**Why it is here.** The docstring records that three renderer error paths already reach the main process by other means, and this seam exists for the one that has no equivalent — a backend server error, which the client is the only witness to. It records that every call is fire-and-forget and silent because every caller is already on an error path, and a capture that threw or logged would compete with the failure the engineer actually needs to see (debt #16).

.. CG-EXPLANATION-END id=module-header

``interface RendererDiagnostic``
--------------------------------

.. CG-BLOCK id=interface:RendererDiagnostic lines=20-53

.. literalinclude:: ../../../desktop/src/renderer/src/utils/diagnostics.ts
   :language: typescript
   :lines: 20-53
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RendererDiagnostic

**What this does.** Describes what the renderer may report: the kind of problem, an optional severity, an optional module label, the message, an optional stack trace, and an optional HTTP status.

**Why it is here.** The comment records that the main process's own list is the authority on what actually reaches the log — an unrecognised kind collapses to "unknown" there — and that one kind (an API refusal) is not on that list yet, so until a one-line addition is made on the main side it logs as unknown while still carrying its code; the renderer emits the intended kind so the fix stays a one-line change, not a re-plumb.

.. CG-EXPLANATION-END id=interface:RendererDiagnostic

``function captureDiagnostic``
------------------------------

.. CG-BLOCK id=function:captureDiagnostic lines=54-65

.. literalinclude:: ../../../desktop/src/renderer/src/utils/diagnostics.ts
   :language: typescript
   :lines: 54-65
   :lineno-match:

.. CG-EXPLANATION-START id=function:captureDiagnostic

**What this does.** Reports a diagnostic to the main process if the bridge is present: it looks up the bridge, does nothing if it is absent, and otherwise sends the diagnostic without awaiting it, swallowing any rejection or synchronous throw.

**Why it is here.** The comments record that the send is deliberately not awaited and its rejection is caught so it never surfaces as an unhandled rejection of its own, and that a bridge which throws synchronously (a torn-down window) is treated as the same non-event as a missing one — consistent with the fire-and-forget, silent rule from the header.

.. CG-EXPLANATION-END id=function:captureDiagnostic

