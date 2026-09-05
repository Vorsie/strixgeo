desktop.renderer.src.shell.stages.geology.GeologyInspectorHeader
================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/geology/GeologyInspectorHeader.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/geology/GeologyInspectorHeader.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-14

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/GeologyInspectorHeader.tsx
   :language: tsx
   :lines: 1-14
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the file — the geology inspector's header — and imports the Layers icon and the translator type.

**Why it is here.** Extracted from the inspector during the god-component decomposition round (debt #201); presentation only, with the parent owning the formation count and the active-model name. The comment notes that the lithostratigraphic model picker was moved to the dedicated Lithology stage (#55) — a stage inspector is not an editing surface — so only the geological stratigraphy label remains here.

.. CG-EXPLANATION-END id=module-header

``interface GeologyInspectorHeaderProps``
-----------------------------------------

.. CG-BLOCK id=interface:GeologyInspectorHeaderProps lines=15-40

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/GeologyInspectorHeader.tsx
   :language: tsx
   :lines: 15-40
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeologyInspectorHeaderProps

**What this does.** Declares the header's inputs: the number of visible formations shown next to the label, the active geological model name (or ``null`` when none is active), and the translator.

**Why it is here.** The header shows data it does not own; the parent supplies the count and the model name as props.

.. CG-EXPLANATION-END id=interface:GeologyInspectorHeaderProps

``function GeologyInspectorHeader``
-----------------------------------

.. CG-BLOCK id=function:GeologyInspectorHeader lines=41-64

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/GeologyInspectorHeader.tsx
   :language: tsx
   :lines: 41-64
   :lineno-match:

.. CG-EXPLANATION-START id=function:GeologyInspectorHeader

**What this does.** Draws the header: a Layers icon, the "Formations" label with the formation count beside it, and — when a model is active — a smaller sub-line naming the active stratigraphy model.

**Why it is here.** It gives the inspector a titled section and names the active stratigraphy so the engineer can see at a glance which geological model the formation list below belongs to.

.. CG-EXPLANATION-END id=function:GeologyInspectorHeader

