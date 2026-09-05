desktop.renderer.src.shell.stages.lithology.LithoResolveAction
==============================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/lithology/LithoResolveAction.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/lithology/LithoResolveAction.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-15

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/lithology/LithoResolveAction.tsx
   :language: tsx
   :lines: 1-15
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and imports a refresh icon and the translator type. The comment explains this is the "Resolve instances" action row, lifted out of ``LithologyInspector`` unchanged, and that it is a roster refresh rather than a re-numbering trigger.

**Why it is here.** This row was split off ``LithologyInspector.tsx`` during the god-component decomposition round (debt #201). The comment records the important semantic: instance ordinals (the QHSa1 / QHSa2 labels) are resolved by the engine at accept time, per body, on the section — so pressing this button just re-fetches the roster to reflect the latest engine state, it does not renumber anything. It stays visible whenever a litho model is active so the engineer can explicitly refresh after drawing correlation edges on the section canvas. This component only draws the row; the parent owns the handler and the busy flag.

.. CG-EXPLANATION-END id=module-header

``interface LithoResolveActionProps``
-------------------------------------

.. CG-BLOCK id=interface:LithoResolveActionProps lines=16-42

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/lithology/LithoResolveAction.tsx
   :language: tsx
   :lines: 16-42
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LithoResolveActionProps

**What this does.** Describes the inputs: a ``resolving`` flag that is true while the refresh call is in flight, an ``onResolve`` callback fired on click, and the translator ``t``. It carries a docstring describing each input and the returned row.

**Why it is here.** ``props`` are the inputs a parent hands a component. The ``resolving`` flag exists so the row can show the work is happening (a spinning icon) and stop a second click while the first is running; the parent, not this component, actually runs the refresh.

.. CG-EXPLANATION-END id=interface:LithoResolveActionProps

``function LithoResolveAction``
-------------------------------

.. CG-BLOCK id=function:LithoResolveAction lines=43-70

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/lithology/LithoResolveAction.tsx
   :language: tsx
   :lines: 43-70
   :lineno-match:

.. CG-EXPLANATION-START id=function:LithoResolveAction

**What this does.** Draws one row: an "Instances" label on the left and a refresh button on the right that calls ``onResolve``. While ``resolving`` is true the button is disabled and its icon spins.

**Why it is here.** It is always shown when a litho model is active so the engineer has an explicit way to re-run the resolver after editing on the section canvas. The quiet spinner and the disabled state give plain feedback that the refresh is in progress without a heavier loading indicator.

.. CG-EXPLANATION-END id=function:LithoResolveAction

