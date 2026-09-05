desktop.renderer.src.shell.stages.sections.boreholePreviewGate
==============================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/sections/boreholePreviewGate.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/sections/boreholePreviewGate.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-32

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/boreholePreviewGate.ts
   :language: typescript
   :lines: 1-32
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A long comment recording why the geotech 'borehole preview' ghosts appear only when the engineer switches them on. Two rounds of dogfeed killed every automatic rule that opened them.

**Why it is here.** The ghosts are a dry run of the 'Divide boreholes' step. Owner ruling 2026-08-07: they are opt-in. Earlier the ghosts auto-appeared whenever the pending-tie count hit zero, and the owner twice read them as 'my boreholes got subdivided before I asked'. The pure predicate below stays so the rule and its history have a named, testable home.

.. CG-EXPLANATION-END id=module-header

``function shouldShowBoreholePreview``
--------------------------------------

.. CG-BLOCK id=function:shouldShowBoreholePreview lines=33-35

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/boreholePreviewGate.ts
   :language: typescript
   :lines: 33-35
   :lineno-match:

.. CG-EXPLANATION-START id=function:shouldShowBoreholePreview

**What this does.** Returns whether the preview ghosts should draw — which is exactly the state of the engineer's 'Show borehole preview' toggle, and nothing else.

**Why it is here.** It is a pure function (its answer depends only on its input, and it touches nothing else), so the opt-in rule is one line that a test can pin. No tie state is allowed to open the gate; only the toggle does.

.. CG-EXPLANATION-END id=function:shouldShowBoreholePreview

