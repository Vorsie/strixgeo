desktop.main.sheetPdf
=====================

.. CG-PAGE source=desktop/src/main/sheetPdf.ts complete=true

*Source file:* ``desktop/src/main/sheetPdf.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-15

.. literalinclude:: ../../../desktop/src/main/sheetPdf.ts
   :language: typescript
   :lines: 1-15
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring explains this file handles the ``sheet:print-pdf`` job: it renders the printable cross-section sheet (``sheet.html``) in a hidden window, feeds it the data to draw, prints it through Chromium's built-in PDF engine, and hands back the resulting PDF bytes. A PDF is the fixed-layout document format used for printing and sharing. The imports bring in Electron pieces (the ``app`` info, ``BrowserWindow`` to make a window, ``ipcMain`` to talk to that window, and ``shell`` to open links in the OS browser), Node path helpers, and this project's own window-safety guards from ``windowGuards``.

**Why it is here.** The app has a main process (this file — full computer access) and a renderer (the sandboxed web page the user sees). A hidden window is a real browser window never shown on screen, used only to render something and read the result back. The heavy drawing lives in the web page; this main-process file only spins up the machinery to turn that page into a printed PDF and return the bytes — the renderer keeps the 'where do I save it' dialog and the actual write to disk. The note also records that this file logs through plain console calls like the rest of the startup code, so it needs no special logger handed in.

.. CG-EXPLANATION-END id=module-header

``const PRINT_TIMEOUT_MS``
--------------------------

.. CG-BLOCK id=const:PRINT_TIMEOUT_MS lines=16-16

.. literalinclude:: ../../../desktop/src/main/sheetPdf.ts
   :language: typescript
   :lines: 16-16
   :lineno-match:

.. CG-EXPLANATION-START id=const:PRINT_TIMEOUT_MS

**What this does.** One fixed number — 30,000 milliseconds, i.e. 30 seconds — the longest the code will wait for the hidden sheet page to report that it is ready before giving up.

**Why it is here.** Without a deadline, a page that never reports ready would hang the print forever; 30 seconds is a generous ceiling that still fails cleanly when something is wrong.

.. CG-EXPLANATION-END id=const:PRINT_TIMEOUT_MS

``const MM_PER_INCH``
---------------------

.. CG-BLOCK id=const:MM_PER_INCH lines=17-18

.. literalinclude:: ../../../desktop/src/main/sheetPdf.ts
   :language: typescript
   :lines: 17-18
   :lineno-match:

.. CG-EXPLANATION-START id=const:MM_PER_INCH

**What this does.** The constant 25.4 — the number of millimetres in an inch.

**Why it is here.** The sheet's size is decided in millimetres, but Chromium's PDF printer wants the page size in inches, so this is the single conversion factor used to translate between them.

.. CG-EXPLANATION-END id=const:MM_PER_INCH

``type Log``
------------

.. CG-BLOCK id=type:Log lines=19-20

.. literalinclude:: ../../../desktop/src/main/sheetPdf.ts
   :language: typescript
   :lines: 19-20
   :lineno-match:

.. CG-EXPLANATION-START id=type:Log

**What this does.** A small type describing the shape of a logging function this file uses: something you call with a level (``info``, ``warn`` or ``error``) and a message. A type is just a note about what kind of value is expected.

**Why it is here.** Naming the logger's shape lets the main printing function accept either the real console logger or a stand-in during tests, without caring which it was handed.

.. CG-EXPLANATION-END id=type:Log

``interface ReadyMessage``
--------------------------

.. CG-BLOCK id=interface:ReadyMessage lines=21-27

.. literalinclude:: ../../../desktop/src/main/sheetPdf.ts
   :language: typescript
   :lines: 21-27
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ReadyMessage

**What this does.** Describes the little message the hidden sheet page sends back once it has finished laying itself out: a fixed ``type`` label plus the page width and height it settled on in millimetres and whether it rendered in offline mode. An interface is a written description of the fields a value must carry.

**Why it is here.** The main process needs the page's final width and height to tell the PDF printer what paper size to use; agreeing the message shape in one place keeps the page and the main process speaking the same language.

.. CG-EXPLANATION-END id=interface:ReadyMessage

``function consoleLog``
-----------------------

.. CG-BLOCK id=function:consoleLog lines=28-34

.. literalinclude:: ../../../desktop/src/main/sheetPdf.ts
   :language: typescript
   :lines: 28-34
   :lineno-match:

.. CG-EXPLANATION-START id=function:consoleLog

**What this does.** The default logger — it prefixes the message with ``[main]`` and prints it to the console at the matching level (error, warning, or info).

**Why it is here.** It gives the printing function a working logger out of the box that lands in the same ``backend.log`` as the rest of the app, so a caller normally passes nothing.

.. CG-EXPLANATION-END id=function:consoleLog

``function sheetTarget``
------------------------

.. CG-BLOCK id=function:sheetTarget lines=35-49

.. literalinclude:: ../../../desktop/src/main/sheetPdf.ts
   :language: typescript
   :lines: 35-49
   :lineno-match:

.. CG-EXPLANATION-START id=function:sheetTarget

**What this does.** Works out where to load the sheet page from: in development it uses the running Vite dev server's address with ``/sheet.html`` on the end; in a packaged build it uses the ``sheet.html`` file shipped inside the app.

**Why it is here.** The same page is served two different ways in development versus a shipped build, so this one helper hides that difference from the rest of the code.

.. CG-EXPLANATION-END id=function:sheetTarget

``function printSheetToPdf``
----------------------------

.. CG-BLOCK id=function:printSheetToPdf lines=50-115

.. literalinclude:: ../../../desktop/src/main/sheetPdf.ts
   :language: typescript
   :lines: 50-115
   :lineno-match:

.. CG-EXPLANATION-START id=function:printSheetToPdf

**What this does.** The heart of the file. It creates a hidden browser window (never shown on screen), locks it down with the safe preload script, sandboxing and no developer tools in a shipped build, and attaches the shared window guards. It then waits for the page to report ``sheet:ready`` (or times out), sends the data to draw once the page has loaded, asks Chromium to print the page to a PDF at the exact paper size the page reported, logs the sizes, and returns the PDF bytes — always destroying the hidden window at the end. It is an async function, meaning it can pause and wait for slow steps (loading the page, printing) while the rest of the app keeps running.

**Why it is here.** Rendering the sheet in a hidden, sandboxed window is how the app reuses the real on-screen drawing code to produce a print-perfect PDF without flashing a window at the user. The safe preload script is a tiny fixed bridge that gives the page only a small set of approved functions instead of raw computer access; sandboxing means the page cannot touch the operating system directly; developer tools are off in a shipped build; and the same deny-by-default guards as the main window are applied — all because this window renders project (``.strix``) content and so is treated as untrusted exactly like the main window. Destroying the window in the ``finally`` block guarantees no hidden window is ever leaked, even when printing failed.

.. CG-EXPLANATION-END id=function:printSheetToPdf

``function registerSheetPdfIpc``
--------------------------------

.. CG-BLOCK id=function:registerSheetPdfIpc lines=116-121

.. literalinclude:: ../../../desktop/src/main/sheetPdf.ts
   :language: typescript
   :lines: 116-121
   :lineno-match:

.. CG-EXPLANATION-START id=function:registerSheetPdfIpc

**What this does.** Registers the ``sheet:print-pdf`` request handler so the web page can ask for a sheet PDF: when asked, it runs ``printSheetToPdf`` and returns the PDF to the renderer as a raw block of bytes.

**Why it is here.** This is the one wiring point that connects the sandboxed web page's 'print' request to the main-process printing code (this cross-program request-and-reply is called IPC, inter-process communication); keeping it a thin one-liner leaves all the real work in the tested function above.

.. CG-EXPLANATION-END id=function:registerSheetPdfIpc

