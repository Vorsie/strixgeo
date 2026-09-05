desktop.renderer.src.shell.stages.sections.pendingTieRevealBridge
=================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/sections/pendingTieRevealBridge.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/sections/pendingTieRevealBridge.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-25

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/pendingTieRevealBridge.ts
   :language: typescript
   :lines: 1-25
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Sets up a shared box that lets the toolbar call a function that lives under the canvas. The toolbar and the canvas are sibling parts of the stage — they share the shell bus and nothing else — so the pending-tie chip in the toolbar cannot directly reach the pan-and-highlight code that lives with the columns.

**Why it is here.** The chip must centre and flash the next pending correlation tie, but the inputs a press needs (the packing edges, the placed columns, the pan) all live under the canvas, not the toolbar. A module-level box both files import — the same trick the 'Divide boreholes' verb already uses — bridges the gap. When the canvas is not mounted the box holds null and the chip stays passive rather than advertising something nothing can do.

.. CG-EXPLANATION-END id=module-header

``const sectionsRevealPendingTieCallback``
------------------------------------------

.. CG-BLOCK id=const:sectionsRevealPendingTieCallback lines=26-30

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/pendingTieRevealBridge.ts
   :language: typescript
   :lines: 26-30
   :lineno-match:

.. CG-EXPLANATION-START id=const:sectionsRevealPendingTieCallback

**What this does.** The shared box (a ``current`` slot holding either a function or null). The canvas fills it with its reveal function while mounted; the toolbar reads it when the chip is pressed and turns the result into a toast.

**Why it is here.** ``null`` while no canvas is mounted keeps the chip honest — a press then finds nothing to call and says so, rather than pretending.

.. CG-EXPLANATION-END id=const:sectionsRevealPendingTieCallback

