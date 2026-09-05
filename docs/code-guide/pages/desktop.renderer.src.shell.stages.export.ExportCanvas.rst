desktop.renderer.src.shell.stages.export.ExportCanvas
=====================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/export/ExportCanvas.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/export/ExportCanvas.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-36

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/export/ExportCanvas.tsx
   :language: tsx
   :lines: 1-36
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and imports React's ``useState``, three icons, the shared shell bus and the translation helper. The docstring says this canvas renders one card per available export target and takes no props.

**Why it is here.** This closes a launch-demo dead-end (debt #30): the export verbs used to live only in the Sections toolbar, so an engineer walking the spine (Data, then Stratigraphy, Sections, Geotechnical, Export) hit a 'coming soon' stub at the exact moment it was time to take the result home. This canvas surfaces every available export as a real, actionable card. It owns no export logic itself — the handlers (a save dialog, the file write, and a *toast* confirmation, which is a small temporary message that appears and fades) live on the shell bus and are shared word-for-word with the Sections toolbar, so the two affordances stay in lockstep. Each card also disables itself with guidance pointing to the stage that unblocks it, rather than showing a silent greyed-out button. The desktop exports to design tools: DXF (the AutoCAD drawing format) and Plaxis scripts here, with D-Stability, D-Sheet, GeoStudio and PDF report cards alongside as they ship.

.. CG-EXPLANATION-END id=module-header

``function ExportCanvas``
-------------------------

.. CG-BLOCK id=function:ExportCanvas lines=37-181

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/export/ExportCanvas.tsx
   :language: tsx
   :lines: 37-181
   :lineno-match:

.. CG-EXPLANATION-START id=function:ExportCanvas

**What this does.** Reads the project, the section list and the currently selected section, the active geological model and its Plaxis-3D handler, and the section DXF and Plaxis-2D handlers from the shell. It keeps local state for the chosen section (seeded from the last-selected section, falling back to the first), a single flag for which section export is running, and a flag for the Plaxis-3D export. Two small async handlers run an export and flip the busy flag around it. It draws a heading and a blurb, then two cards: a section-scoped card with one section picker driving both the DXF and Plaxis-2D buttons, and a model-wide Plaxis-3D card — each replaced by stage-pointing guidance when its prerequisite (an active model, or a section) is missing.

**Why it is here.** The comments record the choices. One picker drives every section-scoped export, so the engineer chooses the section once. The local state re-seeds on each visit, because the shell rebuilds this component every time the stage is entered, so it always starts from the current selection. And a single busy flag (not one per button) disables the picker and both buttons together while either export runs, so a second export cannot start mid-write.

.. CG-EXPLANATION-END id=function:ExportCanvas

``interface ExportCardProps``
-----------------------------

.. CG-BLOCK id=interface:ExportCardProps lines=182-208

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/export/ExportCanvas.tsx
   :language: tsx
   :lines: 182-208
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ExportCardProps

**What this does.** The props for one export card: an icon, a title, a description, and the children that fill its action slot.

**Why it is here.** It names the inputs the card widget needs.

.. CG-EXPLANATION-END id=interface:ExportCardProps

``function ExportCard``
-----------------------

.. CG-BLOCK id=function:ExportCard lines=209-238

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/export/ExportCanvas.tsx
   :language: tsx
   :lines: 209-238
   :lineno-match:

.. CG-EXPLANATION-START id=function:ExportCard

**What this does.** Draws one export-target card: the icon, the title, the one-line description, and below them the action slot (the picker and buttons, or a guidance block).

**Why it is here.** It gives every export target the same card layout so the hub reads as one consistent set of choices.

.. CG-EXPLANATION-END id=function:ExportCard

``function Guidance``
---------------------

.. CG-BLOCK id=function:Guidance lines=239-259

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/export/ExportCanvas.tsx
   :language: tsx
   :lines: 239-259
   :lineno-match:

.. CG-EXPLANATION-START id=function:Guidance

**What this does.** Draws a muted block of guidance text, shown inside a card when an export prerequisite is not yet met; the text may contain emphasised stage names.

**Why it is here.** It is the 'tell the engineer where to go' pattern — instead of a silent disabled button, the card explains which stage to visit to unblock the export.

.. CG-EXPLANATION-END id=function:Guidance

``function Stage``
------------------

.. CG-BLOCK id=function:Stage lines=260-263

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/export/ExportCanvas.tsx
   :language: tsx
   :lines: 260-263
   :lineno-match:

.. CG-EXPLANATION-START id=function:Stage

**What this does.** Draws a stage name emphasised inside a guidance sentence.

**Why it is here.** It highlights the stage the engineer should go to, so the instruction stands out within the surrounding sentence.

.. CG-EXPLANATION-END id=function:Stage

``interface ActionButtonProps``
-------------------------------

.. CG-BLOCK id=interface:ActionButtonProps lines=264-287

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/export/ExportCanvas.tsx
   :language: tsx
   :lines: 264-287
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ActionButtonProps

**What this does.** The props for the export action button: its label, its click handler, and an optional disabled flag.

**Why it is here.** It names the inputs the button needs.

.. CG-EXPLANATION-END id=interface:ActionButtonProps

``function ActionButton``
-------------------------

.. CG-BLOCK id=function:ActionButton lines=288-305

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/export/ExportCanvas.tsx
   :language: tsx
   :lines: 288-305
   :lineno-match:

.. CG-EXPLANATION-START id=function:ActionButton

**What this does.** Draws the accent-filled export button, dimmed and non-interactive when disabled and swapping its label to 'Exporting…' while an export is in flight.

**Why it is here.** The docstring notes it uses the same visual language as the Sections toolbar's primary verb, so the two export affordances read as one.

.. CG-EXPLANATION-END id=function:ActionButton

