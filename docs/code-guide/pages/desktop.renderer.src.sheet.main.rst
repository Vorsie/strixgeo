desktop.renderer.src.sheet.main
===============================

.. CG-PAGE source=desktop/src/renderer/src/sheet/main.tsx complete=false

*Source file:* ``desktop/src/renderer/src/sheet/main.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-13

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/main.tsx
   :language: tsx
   :lines: 1-13
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A documentation comment and the imports for the sheet's own entry page. The comment says this page waits for a payload message — sent either by the preview dialog (through the browser's ``postMessage``) or by the main process (the relay into the hidden print window) — then renders the sheet and reports ``sheet:ready`` back the same way once the fonts and map tiles have settled or the tile wait has expired. The imports bring in React, the translation helper, the whole-sheet component and its geometry helper, the map component, and the payload types.

**Why it is here.** The design uses one drawing behind two viewers: the preview embeds this page in an *iframe* (a small web page inside another), and the export loads the very same page in a hidden window and prints it. This file is that page. *postMessage* is how one web page hands data to another; *IPC* (inter-process communication) is how the main program hands data to a page. Because this page does no data fetching of its own — it only receives a ready-made payload — the preview and the PDF are guaranteed to be the identical drawing.

.. CG-EXPLANATION-END id=module-header

``function isPayloadMessage``
-----------------------------

.. CG-BLOCK id=function:isPayloadMessage lines=14-17

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/main.tsx
   :language: tsx
   :lines: 14-17
   :lineno-match:

.. CG-EXPLANATION-START id=function:isPayloadMessage

**What this does.** Checks whether an incoming message is really a sheet payload by confirming it is an object whose ``type`` field reads ``sheet:payload``.

**Why it is here.** A page can receive stray messages from the browser; this guard makes sure only a genuine payload message is acted on, so an unrelated message can never be mistaken for drawing data.

.. CG-EXPLANATION-END id=function:isPayloadMessage

``function report``
-------------------

.. CG-BLOCK id=function:report lines=18-22

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/main.tsx
   :language: tsx
   :lines: 18-22
   :lineno-match:

.. CG-EXPLANATION-START id=function:report

**What this does.** Sends the ``sheet:ready`` message back by both routes it might need: to the parent page if this page is running inside an iframe, and to the main process through the Electron bridge if one is present.

**Why it is here.** The same page is used in the preview iframe and in the hidden print window, and each needs to be told the sheet has finished laying itself out. Reporting through both channels means whichever viewer is hosting this page hears back, without the page needing to know which one it is.

.. CG-EXPLANATION-END id=function:report

``function SheetApp``
---------------------

.. CG-BLOCK id=function:SheetApp lines=23-44

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/main.tsx
   :language: tsx
   :lines: 23-44
   :lineno-match:

.. CG-EXPLANATION-START id=function:SheetApp

**What this does.** The top-level page piece. It holds the received payload; on start it listens for a payload arriving by ``postMessage`` or through the Electron bridge, and cleans up those listeners when it goes away. Until a payload arrives it renders nothing. Once it has one, it computes the geometry and defines what to do when the sheet is ready: wait for the fonts to finish loading, then report the final paper width and height and whether the map ended up offline. It renders the whole sheet, passing in the map component. The last line attaches this page to the document.

**Why it is here.** Waiting for a payload before drawing, and reporting the true paper size and font-readiness back only when everything has settled, is what lets the print pipeline wait for a fully-laid-out page before it captures the PDF at exactly the right page size. This matches the design note's print handshake: the page signals ``sheet:ready`` once fonts (and tiles) are settled.

.. CG-EXPLANATION-END id=function:SheetApp

