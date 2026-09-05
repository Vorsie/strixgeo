desktop.renderer.src.shell.stages.geology.GeologyConfidenceFadeToggle
=====================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/geology/GeologyConfidenceFadeToggle.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/geology/GeologyConfidenceFadeToggle.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-18

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/GeologyConfidenceFadeToggle.tsx
   :language: tsx
   :lines: 1-18
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the file — a confidence-fade toggle switch for the geology inspector — and imports the translator type. The comment explains the switch: off means low-confidence triangles and segments render at full colour; on fades them so the engineer can see where the interpolated surface mesh (the TIN) is extrapolating away from the data.

**Why it is here.** Extracted verbatim from the inspector during the god-component decomposition round (debt #201). It is presentation only — the parent owns the project-wide ``show_confidence_fade`` flag and its setter. A near-identical control ships in the Lithology inspector reading and writing the SAME flag; the two are kept as sibling copies rather than folded into one shared component, because folding would reach into the lithology folder, which was out of scope for this round.

.. CG-EXPLANATION-END id=module-header

``interface GeologyConfidenceFadeToggleProps``
----------------------------------------------

.. CG-BLOCK id=interface:GeologyConfidenceFadeToggleProps lines=19-44

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/GeologyConfidenceFadeToggle.tsx
   :language: tsx
   :lines: 19-44
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeologyConfidenceFadeToggleProps

**What this does.** Declares the switch's inputs: the current project-wide confidence-fade flag, a callback fired with the next value when the switch is clicked, and the translator.

**Why it is here.** An interface names the shape of an object — here the props. The component draws only; the parent owns the flag and the setter, so both arrive as props.

.. CG-EXPLANATION-END id=interface:GeologyConfidenceFadeToggleProps

``function GeologyConfidenceFadeToggle``
----------------------------------------

.. CG-BLOCK id=function:GeologyConfidenceFadeToggle lines=45-77

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/GeologyConfidenceFadeToggle.tsx
   :language: tsx
   :lines: 45-77
   :lineno-match:

.. CG-EXPLANATION-START id=function:GeologyConfidenceFadeToggle

**What this does.** Draws a labelled toggle switch — a ``role="switch"`` button with a sliding knob — wired to the flag. Clicking it calls ``onToggle`` with the opposite value; the accessible checked-state and the knob's position both follow the current flag.

**Why it is here.** This is a reversible view preference, so per the UX rules it fires immediately with no confirmation dialog. The ``role="switch"`` plus ``aria-checked`` make it announce its on/off state correctly to assistive technology.

.. CG-EXPLANATION-END id=function:GeologyConfidenceFadeToggle

