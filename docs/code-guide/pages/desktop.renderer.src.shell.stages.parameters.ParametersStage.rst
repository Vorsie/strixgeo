desktop.renderer.src.shell.stages.parameters.ParametersStage
============================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/parameters/ParametersStage.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/parameters/ParametersStage.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-29

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/ParametersStage.ts
   :language: typescript
   :lines: 1-29
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file ("Parameters stage descriptor") and pulls in the one thing it needs: the ``Calculator`` icon for the spine button, the ``StageDescriptor`` / ``StageSummary`` types that say what shape a stage must have, and the two screen halves it wires up — ``ParametersCanvas`` (the main screen) and ``ParametersInspector`` (the right-hand panel).

**Why it is here.** The app is a left spine of stages (Data, Stratigraphy, Lithology, Geotechnical, Sections, Parameters, Export); Parameters is the sixth slot, sitting between the geotechnical NAD-class assignment and the Export step that writes the chosen parameter set to Plaxis or D-Stability. The docstring records the owner directive of 2026-05-21: eventually derive design-ready values per test and per unit, with the two method families (formula-driven correlations and spreadsheet lookups) kept strictly apart, plus statistics, distribution wiring and machine-learning hooks. Those design-ready values are Phase 5 work; this descriptor only opens the surface today with three tabs and what can already be filled in. The full reasoning lives in ``memory/project_parameters_stage_architecture.md``.

.. CG-EXPLANATION-END id=module-header

``function ParametersToolbar``
------------------------------

.. CG-BLOCK id=function:ParametersToolbar lines=30-43

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/ParametersStage.ts
   :language: typescript
   :lines: 30-43
   :lineno-match:

.. CG-EXPLANATION-START id=function:ParametersToolbar

**What this does.** A component (a small function that returns a piece of screen) that returns ``null`` — nothing. It is the stage's toolbar, and it draws no verb row.

**Why it is here.** The toolbar is reserved for Phase 5 analysis verbs, so there is nothing to put on it yet. The docstring is careful to note the contrast: the INSPECTOR (right-hand panel) is no longer a placeholder — an owner ruling on 2026-08-03 turned it into the per-CPT plot surface — but the toolbar still is.

.. CG-EXPLANATION-END id=function:ParametersToolbar

``function useParametersStageSummary``
--------------------------------------

.. CG-BLOCK id=function:useParametersStageSummary lines=44-47

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/ParametersStage.ts
   :language: typescript
   :lines: 44-47
   :lineno-match:

.. CG-EXPLANATION-START id=function:useParametersStageSummary

**What this does.** A hook (a ``use…`` function that lets the stage plug into a React feature) that returns the little summary the spine shows for this stage: the fixed label "Parameters & analyses", with no badge.

**Why it is here.** The count that belongs here — something like "N parameters resolved of M total" — cannot be produced until the per-cell method pickers are wired in Phase 5, so for now the label is static.

.. CG-EXPLANATION-END id=function:useParametersStageSummary

``const ParametersStage``
-------------------------

.. CG-BLOCK id=const:ParametersStage lines=48-57

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/ParametersStage.ts
   :language: typescript
   :lines: 48-57
   :lineno-match:

.. CG-EXPLANATION-START id=const:ParametersStage

**What this does.** The descriptor object that registers the stage: its id ``'parameters'``, the ``Calculator`` spine icon, the spine label "Parameters", the summary hook above, and the three parts that make up the stage — the canvas, the (empty) toolbar and the inspector.

**Why it is here.** Every stage hands the shell one ``StageDescriptor`` naming its canvas, toolbar and optional inspector; the shell's registry reads this object to know how to draw the Parameters slot and what to show on its spine button.

.. CG-EXPLANATION-END id=const:ParametersStage

``default default``
-------------------

.. CG-BLOCK id=default:default lines=58-58

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/ParametersStage.ts
   :language: typescript
   :lines: 58-58
   :lineno-match:

.. CG-EXPLANATION-START id=default:default

**What this does.** Makes the descriptor the file's default export.

**Why it is here.** The stage registry imports each stage by its default export, so this is how the shell finds and mounts the Parameters stage.

.. CG-EXPLANATION-END id=default:default

