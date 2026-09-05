desktop.renderer.src.shell.stages.sections.downloadSectionExport
================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/sections/downloadSectionExport.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/sections/downloadSectionExport.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-13

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/downloadSectionExport.ts
   :language: typescript
   :lines: 1-13
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the shared file-writing step every section export uses: propose a filename, ask the operating system where to save it, fetch the bytes, write the file, and tell the engineer.

**Why it is here.** This shape is copied from the DXF export handler; making it a module rather than a fourth copy heads off debt #110 (export-path duplication) — the D-Series pair would have pushed the copy count to five. The three handlers still in the App file can adopt it later with no observable change.

.. CG-EXPLANATION-END id=module-header

``interface SectionExportDownload``
-----------------------------------

.. CG-BLOCK id=interface:SectionExportDownload lines=14-55

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/downloadSectionExport.ts
   :language: typescript
   :lines: 14-55
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SectionExportDownload

**What this does.** Describes what the caller must supply for one export: the section name (sanitised into the filename), the file extension, a human name for the save dialog's filter row, a function that fetches the artefact bytes, the success and failure messages, a log label, and the toast function.

**Why it is here.** The byte-fetching function is called only AFTER the engineer has chosen a path, so a cancelled dialog costs no request — the same order the DXF handler uses.

.. CG-EXPLANATION-END id=interface:SectionExportDownload

``function downloadSectionExport``
----------------------------------

.. CG-BLOCK id=function:downloadSectionExport lines=56-85

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/downloadSectionExport.ts
   :language: typescript
   :lines: 56-85
   :lineno-match:

.. CG-EXPLANATION-START id=function:downloadSectionExport

**What this does.** Runs the save-dialog then fetch then write then notify sequence. It sanitises the name to safe characters, opens the OS save dialog, returns quietly if the engineer cancels, otherwise fetches the bytes, writes them to the chosen path, and shows a success toast. Any failure is caught and shown as an error toast rather than thrown.

**Why it is here.** It never throws because there is nothing for a caller to recover — the export either produced a file or it did not. The backend's own refusal messages are written for the engineer, so they go into the toast unchanged. The name is sanitised the same way the backend does, so the proposed default matches what the engineer would see.

.. CG-EXPLANATION-END id=function:downloadSectionExport

