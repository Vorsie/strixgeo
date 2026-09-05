desktop.renderer.src.shell.stages.shared.exportFenceDxf
=======================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/shared/exportFenceDxf.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/shared/exportFenceDxf.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-23

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/shared/exportFenceDxf.ts
   :language: typescript
   :lines: 1-23
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and pulls in its tools. Its job is to export the 3-D fence diagram — the section walls stood up in 3-D over the map — as a DXF file. DXF is the AutoCAD drawing format that CAD packages read. It imports the API client (the desktop-side wrapper that calls the engine over the network), the formation type, the fence-wall type, the helper that builds the export request, the logging helper, and the translation function.

**Why it is here.** The long comment records why a DXF and not a screenshot: a picture of the 3-D scene cannot be measured, laid over a site plan, or dropped into the drawing set the engineer actually delivers; it is also the less robust option, needing a costly per-frame setting and having no clean answer in the two-pane split. The DXF instead carries the real world-space geometry, layered by unit, and opens in AutoCAD or Civil3D unassisted. It records too that the save-then-fetch-then-write shape deliberately mirrors the section-DXF export, but lives in its own file because the fence walls are screen-local state that never reaches the shared shell, and the main app file is already the oversized 'god component' tracked as debt #201.

.. CG-EXPLANATION-END id=module-header

``interface FenceExportOptions``
--------------------------------

.. CG-BLOCK id=interface:FenceExportOptions lines=24-57

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/shared/exportFenceDxf.ts
   :language: typescript
   :lines: 24-57
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FenceExportOptions

**What this does.** A written note of everything one fence export needs (an 'interface' names the exact shape of a bundle of values). The fields are: the project id, the model id, the model name (which names the downloaded file), the fence walls the viewer is currently painting, the formations handed to the viewer (colours included), and a 'toast' dispatcher — a toast being a small temporary message that appears and fades.

**Why it is here.** Each value is needed either to build the export request or to report the outcome to the engineer. The model name is carried so the proposed file name can be cleaned up the same way the engine cleans it, so the name the user is offered is the name the file would have had anyway.

.. CG-EXPLANATION-END id=interface:FenceExportOptions

``function exportFenceDxf``
---------------------------

.. CG-BLOCK id=function:exportFenceDxf lines=58-93

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/shared/exportFenceDxf.ts
   :language: typescript
   :lines: 58-93
   :lineno-match:

.. CG-EXPLANATION-START id=function:exportFenceDxf

**What this does.** The export routine. It is 'async', meaning it can pause partway and wait for slow work (a save dialog, a network call) while the rest of the app keeps running. It first builds the export request from the walls and formations; if there are no drawable walls it shows a warning toast and stops. Otherwise it proposes a cleaned-up default file name, opens the Save dialog, and stops quietly if the user cancels. Then it fetches the DXF bytes from the engine, writes them to the chosen path, logs success and shows a success toast. Any failure along the way is caught and reported as an error toast.

**Why it is here.** It refuses an empty export up front because an empty DXF looks exactly like a successful export of an empty model — the one outcome an engineer must never get silently — so the refusal is a warning that says what to do, not an error, because nothing actually went wrong: there is simply nothing to write. It never throws its failure back at the click that started it; an export failure is always turned into a message for the engineer, so a click can never surface a raw crash.

.. CG-EXPLANATION-END id=function:exportFenceDxf

