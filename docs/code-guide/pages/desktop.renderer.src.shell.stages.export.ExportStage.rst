desktop.renderer.src.shell.stages.export.ExportStage
====================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/export/ExportStage.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/export/ExportStage.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-16

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/export/ExportStage.ts
   :language: typescript
   :lines: 1-16
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and imports the Download icon, the ``StageDescriptor`` and ``StageSummary`` types, the shared shell bus, and the export canvas.

**Why it is here.** This is the descriptor for the spine's final stage. Its toolbar and inspector stay empty because the export targets are picked on the canvas itself (the agreed fix for debt #30); the comment notes DXF and Plaxis 3D ship today, with Plaxis 2D, D-Stability, D-Sheet, GeoStudio and IFC to land as further cards.

.. CG-EXPLANATION-END id=module-header

``function ExportToolbar``
--------------------------

.. CG-BLOCK id=function:ExportToolbar lines=17-17

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/export/ExportStage.ts
   :language: typescript
   :lines: 17-17
   :lineno-match:

.. CG-EXPLANATION-START id=function:ExportToolbar

**What this does.** A stub that returns nothing — the Export stage has no toolbar.

**Why it is here.** There are no import-style verbs to show; the exports are chosen on the canvas, so the toolbar slot is intentionally empty.

.. CG-EXPLANATION-END id=function:ExportToolbar

``function ExportInspector``
----------------------------

.. CG-BLOCK id=function:ExportInspector lines=18-33

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/export/ExportStage.ts
   :language: typescript
   :lines: 18-33
   :lineno-match:

.. CG-EXPLANATION-START id=function:ExportInspector

**What this does.** A stub that returns nothing — the Export stage has no inspector. This block also opens the documentation comment for the stage-summary hook that follows.

**Why it is here.** Exports are chosen on the canvas, so there is no per-export side panel to show.

.. CG-EXPLANATION-END id=function:ExportInspector

``function useExportStageSummary``
----------------------------------

.. CG-BLOCK id=function:useExportStageSummary lines=34-46

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/export/ExportStage.ts
   :language: typescript
   :lines: 34-46
   :lineno-match:

.. CG-EXPLANATION-START id=function:useExportStageSummary

**What this does.** A hook that reports how many export targets are currently runnable: the DXF card counts when there is both an active model and at least one section, and the Plaxis-3D card counts when there is an active model. The badge shows that count, or nothing when nothing can be exported yet.

**Why it is here.** The docstring explains this lets the spine communicate readiness — showing how many exports are possible — instead of the final stage looking inert.

.. CG-EXPLANATION-END id=function:useExportStageSummary

``const ExportStage``
---------------------

.. CG-BLOCK id=const:ExportStage lines=47-56

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/export/ExportStage.ts
   :language: typescript
   :lines: 47-56
   :lineno-match:

.. CG-EXPLANATION-START id=const:ExportStage

**What this does.** The descriptor object registering the Export stage: its id ``'export'``, the Download icon, the ``'Export'`` spine label, the summary hook, the export canvas, and the empty toolbar and inspector stubs.

**Why it is here.** This is the single record the shell's stage registry reads to wire the Export stage into the spine.

.. CG-EXPLANATION-END id=const:ExportStage

``default default``
-------------------

.. CG-BLOCK id=default:default lines=57-57

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/export/ExportStage.ts
   :language: typescript
   :lines: 57-57
   :lineno-match:

.. CG-EXPLANATION-START id=default:default

**What this does.** Exports the descriptor as the module's default export.

**Why it is here.** So the stage registry can import the Export stage in one line.

.. CG-EXPLANATION-END id=default:default

