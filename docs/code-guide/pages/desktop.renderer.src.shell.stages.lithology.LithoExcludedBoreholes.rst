desktop.renderer.src.shell.stages.lithology.LithoExcludedBoreholes
==================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/lithology/LithoExcludedBoreholes.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/lithology/LithoExcludedBoreholes.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-18

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/lithology/LithoExcludedBoreholes.tsx
   :language: tsx
   :lines: 1-18
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and imports two icons (a drill and a counter-clockwise arrow) and the translator type. The comment explains this is the excluded-boreholes list (debt #65): it surfaces the boreholes the active litho model has left out, each with an "Include again" control.

**Why it is here.** The litho model carries its own ``excluded_borehole_ids``, which the engine sets during the build when a borehole disagrees with its corridor. Showing that list lets the engineer bring a borehole back into the build from the panel, without an edit behind the scenes. The comment records two decisions: the whole section is the exclusion set, so it draws nothing when nothing is excluded — an empty box would read as a permanent feature rather than the exception it is — and each "Include again" is a reversible action that fires immediately, its undo being the parent's Ctrl+Z stack plus a confirmation toast. This component only draws the list; the parent owns the model and the toggle handler.

.. CG-EXPLANATION-END id=module-header

``interface LithoExcludedBoreholesProps``
-----------------------------------------

.. CG-BLOCK id=interface:LithoExcludedBoreholesProps lines=19-49

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/lithology/LithoExcludedBoreholes.tsx
   :language: tsx
   :lines: 19-49
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LithoExcludedBoreholesProps

**What this does.** Describes the inputs: ``excludedBoreholeIds`` (the excluded ids, in the model's order), a ``boreholeNameById`` lookup from id to display name, an ``onIncludeAgain`` callback fired with a borehole id, and the translator ``t``. It carries a docstring describing each input and the return value.

**Why it is here.** ``props`` are the inputs a parent hands a component. The comment explains the lookup falls back to a generic label for a missing id, so a borehole that was since removed from the project is still listed and still recoverable — the engineer can put it back even though its name is gone. Returning nothing when the list is empty is part of the contract, stated in the docstring.

.. CG-EXPLANATION-END id=interface:LithoExcludedBoreholesProps

``function LithoExcludedBoreholes``
-----------------------------------

.. CG-BLOCK id=function:LithoExcludedBoreholes lines=50-106

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/lithology/LithoExcludedBoreholes.tsx
   :language: tsx
   :lines: 50-106
   :lineno-match:

.. CG-EXPLANATION-START id=function:LithoExcludedBoreholes

**What this does.** Draws the excluded list. It returns nothing when nothing is excluded. Otherwise it draws a header with a drill icon, a heading, and a count, a one-line hint, and a scrollable list with one row per excluded borehole: the borehole's name (or a generic fallback when the id no longer resolves) beside an "Include again" button that calls ``onIncludeAgain`` with that id.

**Why it is here.** Rendering nothing on an empty set keeps the exception from looking like a standing feature. Each "Include again" is the reversible toggle in the include direction (see ``docs/ux.md``): it fires immediately, and the same shared toggle in the parent supplies the Ctrl+Z undo and the confirmation toast. The generic fallback name keeps a since-removed borehole recoverable.

.. CG-EXPLANATION-END id=function:LithoExcludedBoreholes

