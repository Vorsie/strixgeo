desktop.renderer.src.main
=========================

.. CG-PAGE source=desktop/src/renderer/src/main.tsx complete=true

*Source file:* ``desktop/src/renderer/src/main.tsx``

.. contents::
   :local:
   :depth: 1

Module header — the whole file
------------------------------

.. CG-BLOCK id=module-header lines=1-58

.. literalinclude:: ../../../desktop/src/renderer/src/main.tsx
   :language: tsx
   :lines: 1-58
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This is the very first piece of interface code that runs when the desktop window opens. (React is the library that builds the on-screen interface out of small reusable pieces called *components*; this file switches the whole thing on.) In order, it: imports ``cesiumBaseUrl`` first of all, then React itself, ReactDOM (the part of React that actually puts the interface onto the page), the top-level ``App`` component, an ``ErrorBoundary`` component, the logger, and the global stylesheet. It then installs two catch-all safety nets on the window: ``window.onerror`` catches an ordinary error thrown outside a redraw (in a click handler or a timer, say), and the ``unhandledrejection`` listener catches a *promise* that failed with nothing to handle it (a promise is a value that will arrive later; a failed one with no catch would otherwise vanish). Both write the error to the developer console through the ``[ui …]`` logger and, when the bridge to the main program is present, forward it to the main log file. Finally it mounts the app: it finds the empty ``root`` element on the page and renders ``App`` wrapped inside ``ErrorBoundary`` inside React's ``StrictMode``.

**Why it is here.** ``main.tsx`` is the renderer's entry point — the file the web page loads first — so it is the natural place to arm the interface and its safety nets. ``cesiumBaseUrl`` is imported before everything because ``App``'s tree pulls in Cesium (the 3-D globe library), and Cesium reads ``window.CESIUM_BASE_URL`` the instant it loads; setting that address any later would be too late (see the comment and ``cesiumBaseUrl.ts``). The two window handlers exist because React's ``ErrorBoundary`` only catches an error thrown *during* a redraw inside the component tree — these catch everything else, so no crash is silent (change #214a). ``window.onerror`` deliberately returns ``false`` so the browser still prints the error to the console as well. ``StrictMode`` is React's development-time double-check that flags unsafe patterns; it does nothing in the shipped build.

.. CG-EXPLANATION-END id=module-header

