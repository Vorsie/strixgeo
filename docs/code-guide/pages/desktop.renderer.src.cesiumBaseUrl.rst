desktop.renderer.src.cesiumBaseUrl
==================================

.. CG-PAGE source=desktop/src/renderer/src/cesiumBaseUrl.ts complete=true

*Source file:* ``desktop/src/renderer/src/cesiumBaseUrl.ts``

.. contents::
   :local:
   :depth: 1

Module header — the whole file
------------------------------

.. CG-BLOCK id=module-header lines=1-38

.. literalinclude:: ../../../desktop/src/renderer/src/cesiumBaseUrl.ts
   :language: typescript
   :lines: 1-38
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The whole file is one long comment followed by two small declarations and a single running line. The comment explains why the file exists. The ``declare global`` block then tells the type-checker two things: that the browser ``window`` object may carry a text property called ``CESIUM_BASE_URL``, and that ``import.meta.env`` (the build tool's bag of build-time settings) carries a true/false ``PROD`` flag that is true in a packaged build. The last statement actually runs: it sets ``window.CESIUM_BASE_URL`` to ``'./cesium/'`` in a packaged build and ``'/cesium/'`` while developing. The closing ``export {}`` is an empty export that marks the file as a module (a self-contained unit of code) so the ``declare global`` block is allowed.

**Why it is here.** Cesium is the 3D globe library the geology stage draws on. The comment records the constraint: Cesium reads ``window.CESIUM_BASE_URL`` the first time any Cesium code runs, to find the ``Workers/`` and ``Assets/`` folders it loads at run time. If the value is missing, Cesium guesses its own file location and every one of those fetches fails with a 404 (the two crash messages quoted in the comment). Setting the global here, in the very first import of the app, fixes the location for both the development server and the packaged app, so the answer never depends on the fragile interaction between the build tool's settings that the comment describes.

.. CG-EXPLANATION-END id=module-header

