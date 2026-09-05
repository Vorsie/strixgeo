desktop.renderer.src.shell.stages.sections.SectionsStage
========================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/sections/SectionsStage.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/sections/SectionsStage.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-22

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/SectionsStage.ts
   :language: typescript
   :lines: 1-22
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This small file names one of the app's top-level workspaces, called a stage. The app's left spine has a button per stage; pressing the Sections button opens this one. The file brings in (imports) the three parts that make up the stage — the drawing area (``SectionsCanvas``), the row of action buttons at the top (``SectionsToolbar``), and the panel down the right side (``SectionsInspector``) — plus a shared data bus called the shell that every part reads from.

**Why it is here.** A stage descriptor is how the app registers a workspace once, in one place, so the shell knows which components to mount when the engineer clicks the Sections spine button. Keeping the three parts named here, and everything else in their own files, is the project's one-class-per-file convention.

.. CG-EXPLANATION-END id=module-header

``function useSectionsStageSummary``
------------------------------------

.. CG-BLOCK id=function:useSectionsStageSummary lines=23-32

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/SectionsStage.ts
   :language: typescript
   :lines: 23-32
   :lineno-match:

.. CG-EXPLANATION-START id=function:useSectionsStageSummary

**What this does.** Produces the little label and badge shown on the Sections spine button. It reads how many cross-sections are visible and how many geological surfaces are out of date, then returns a word like '3 sections' plus a badge — an amber '2 stale' when surfaces need rebuilding, otherwise just the count. (A function whose name starts with ``use`` is a React hook — a helper a screen component calls to read live values; here it reads them from the shell bus.)

**Why it is here.** The spine button has to tell the engineer at a glance how much is in this stage and whether anything needs attention, without opening it. Amber is the project's colour for 'stale, act on it' — never red, which is reserved for destructive actions.

.. CG-EXPLANATION-END id=function:useSectionsStageSummary

``const SectionsStage``
-----------------------

.. CG-BLOCK id=const:SectionsStage lines=33-42

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/SectionsStage.ts
   :language: typescript
   :lines: 33-42
   :lineno-match:

.. CG-EXPLANATION-START id=const:SectionsStage

**What this does.** The descriptor object itself: it pins the stage's id, its icon (a stacked-layers glyph), the word 'Sections' on the spine, the summary hook above, and the three components that render the canvas, toolbar and inspector.

**Why it is here.** The shell reads exactly these fields to build the stage, so gathering them in one constant is the whole registration. A constant is a fixed, named value the rest of the code refers to rather than repeating.

.. CG-EXPLANATION-END id=const:SectionsStage

``default default``
-------------------

.. CG-BLOCK id=default:default lines=43-43

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/SectionsStage.ts
   :language: typescript
   :lines: 43-43
   :lineno-match:

.. CG-EXPLANATION-START id=default:default

**What this does.** Hands the descriptor to any file that imports this one.

**Why it is here.** This is how the shell's stage registry picks the Sections stage up — one default export per stage file, so the registry can list them uniformly.

.. CG-EXPLANATION-END id=default:default

