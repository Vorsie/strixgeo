desktop.renderer.src.shell.stages.lithology.LithoConfidenceFadeToggle
=====================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/lithology/LithoConfidenceFadeToggle.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/lithology/LithoConfidenceFadeToggle.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-14

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/lithology/LithoConfidenceFadeToggle.tsx
   :language: tsx
   :lines: 1-14
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and imports one thing — the translator type. The comment explains this is the confidence-fade toggle switch, lifted out of ``LithologyInspector`` unchanged, and that the parent owns the project-wide flag and its setter.

**Why it is here.** This switch was split off ``LithologyInspector.tsx`` during the god-component decomposition round (debt #201). The confidence fade is a 3-D view setting: it fades the model where it is poorly constrained (far from the investigations). The litho 3-D pane already honoured this setting, but the only control lived on the geology stage, so an engineer working only in litho could not flip it without switching stages. This toggle reads and writes the SAME project-wide value as the geology control, so the two stay in lockstep.

.. CG-EXPLANATION-END id=module-header

``interface LithoConfidenceFadeToggleProps``
--------------------------------------------

.. CG-BLOCK id=interface:LithoConfidenceFadeToggleProps lines=15-40

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/lithology/LithoConfidenceFadeToggle.tsx
   :language: tsx
   :lines: 15-40
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LithoConfidenceFadeToggleProps

**What this does.** Describes the inputs: ``showConfidenceFade`` (the current project-wide flag, which drives the switch's on/off look), an ``onToggle`` callback called with the next value when the switch is clicked, and the translator ``t``. It carries a docstring describing each input and the returned row.

**Why it is here.** ``props`` are the inputs a parent hands a component. Naming their shape keeps the contract explicit. The docstring records that the flag both sets the accessibility "checked" state and positions the sliding knob, and that clicking sends the opposite value back to the parent — the parent, not this component, actually stores the flag.

.. CG-EXPLANATION-END id=interface:LithoConfidenceFadeToggleProps

``function LithoConfidenceFadeToggle``
--------------------------------------

.. CG-BLOCK id=function:LithoConfidenceFadeToggle lines=41-73

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/lithology/LithoConfidenceFadeToggle.tsx
   :language: tsx
   :lines: 41-73
   :lineno-match:

.. CG-EXPLANATION-START id=function:LithoConfidenceFadeToggle

**What this does.** Draws one row: a label on the left and a small pill switch on the right. The switch reports its state to assistive technology as a ``role="switch"`` with an ``aria-checked`` value, colours itself when on, and slides its white knob left or right; clicking it calls ``onToggle`` with the flipped value.

**Why it is here.** It is built as a proper switch (with the accessibility role and checked state) and mirrors the geology inspector's control exactly, so the same setting looks and behaves the same on both stages. Because it reads and writes the one shared project-wide value, flipping it here immediately agrees with the geology toggle rather than drifting out of sync.

.. CG-EXPLANATION-END id=function:LithoConfidenceFadeToggle

