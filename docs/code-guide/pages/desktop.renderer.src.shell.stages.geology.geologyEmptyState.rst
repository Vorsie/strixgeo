desktop.renderer.src.shell.stages.geology.geologyEmptyState
===========================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/geology/geologyEmptyState.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/geology/geologyEmptyState.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-9

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geologyEmptyState.ts
   :language: typescript
   :lines: 1-9
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the file — a pure decision function for the geology canvas empty-state — and imports the translator type. A pure function just turns inputs into an answer with no side effects.

**Why it is here.** Extracted from the canvas (debt #33) so the decision can be unit-tested WITHOUT mounting Cesium: the canvas imports the 3-D viewer at load, and the viewer needs WebGL (the graphics-card interface for 3-D), which a plain test cannot supply (debt #41). Keeping the logic in a pure function isolates it from that heavyweight import.

.. CG-EXPLANATION-END id=module-header

``interface GeologyEmptyState``
-------------------------------

.. CG-BLOCK id=interface:GeologyEmptyState lines=10-46

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geologyEmptyState.ts
   :language: typescript
   :lines: 10-46
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeologyEmptyState

**What this does.** Declares the shape the decision returns: a guidance sentence to show under the icon, and a flag for whether to render the "Add formation" button. The docstring that follows lists the three cases the function distinguishes.

**Why it is here.** The three cases are: formations already exist, so prompt the engineer to Build the 3-D model; no formations but boreholes present, so Fill-from-boreholes is the fast path and manual add is the fallback; no formations and no boreholes, where Fill is permanently disabled so manual add is the ONLY path and must be surfaced. This last case is debt #33 — a CPT-only project must not dead-end at a disabled Fill button.

.. CG-EXPLANATION-END id=interface:GeologyEmptyState

``function geologyEmptyState``
------------------------------

.. CG-BLOCK id=function:geologyEmptyState lines=47-68

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geologyEmptyState.ts
   :language: typescript
   :lines: 47-68
   :lineno-match:

.. CG-EXPLANATION-START id=function:geologyEmptyState

**What this does.** The function. Given the translator and two yes/no facts — whether the model has any formations, and whether the project has any visible boreholes — it returns the right guidance sentence and whether to show the Add-formation button. The button shows whenever there are no formations, in both no-formation cases.

**Why it is here.** Manual formation creation is always valid, so the canvas must never point at a button the engineer cannot reach. Threading the translator in as a parameter is what keeps this a pure, testable function rather than one that reaches for global state.

.. CG-EXPLANATION-END id=function:geologyEmptyState

