desktop.renderer.src.shell.stages.data.DataStage
================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/data/DataStage.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/data/DataStage.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-24

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataStage.ts
   :language: typescript
   :lines: 1-24
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and imports what the descriptor needs: the Database icon, the ``StageDescriptor`` and ``StageSummary`` types, the shared shell bus, and the Data stage's three pieces — its canvas, toolbar and inspector.

**Why it is here.** The Data stage is the first button on the app's left spine (the project's investigation data — CPTs and boreholes). Every stage registers a *descriptor* so the shell knows which canvas (main screen), toolbar (verb row) and inspector (right panel) to show when that stage is active.

.. CG-EXPLANATION-END id=module-header

``function useDataStageSummary``
--------------------------------

.. CG-BLOCK id=function:useDataStageSummary lines=25-34

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataStage.ts
   :language: typescript
   :lines: 25-34
   :lineno-match:

.. CG-EXPLANATION-START id=function:useDataStageSummary

**What this does.** A *hook* (a ``use…`` function that reads live shell state) that produces the spine button's summary for the Data stage: a label counting the visible CPTs and boreholes, and a badge showing the combined total when any exist, or nothing when the project is empty.

**Why it is here.** It lets the spine button show at a glance how much data the project holds, and stays blank rather than showing a zero on an empty project.

.. CG-EXPLANATION-END id=function:useDataStageSummary

``const DataStage``
-------------------

.. CG-BLOCK id=const:DataStage lines=35-44

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataStage.ts
   :language: typescript
   :lines: 35-44
   :lineno-match:

.. CG-EXPLANATION-START id=const:DataStage

**What this does.** The descriptor object that registers the Data stage: its id ``'data'``, the Database icon, the ``'Data'`` spine label, the summary hook, and the canvas, toolbar and inspector components to mount.

**Why it is here.** This is the single record the shell's stage registry reads to wire the Data stage into the spine.

.. CG-EXPLANATION-END id=const:DataStage

``default default``
-------------------

.. CG-BLOCK id=default:default lines=45-45

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataStage.ts
   :language: typescript
   :lines: 45-45
   :lineno-match:

.. CG-EXPLANATION-START id=default:default

**What this does.** Exports the descriptor as the module's default export.

**Why it is here.** So the stage registry can import the Data stage in one line.

.. CG-EXPLANATION-END id=default:default

