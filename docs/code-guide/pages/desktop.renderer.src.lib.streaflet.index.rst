desktop.renderer.src.lib.streaflet.index
========================================

.. CG-PAGE source=desktop/src/renderer/src/lib/streaflet/index.ts complete=true

*Source file:* ``desktop/src/renderer/src/lib/streaflet/index.ts``

.. contents::
   :local:
   :depth: 1

Module header — the whole file
------------------------------

.. CG-BLOCK id=module-header lines=1-60

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/index.ts
   :language: typescript
   :lines: 1-60
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The library's single public entry point. It re-exports, grouped by kind, everything the rest of the app is allowed to use: the root ``MapContainer``; the tile and raster layers; panes and the two group layers; markers and the vector shapes; the tooltip and popup overlays; the four map controls; the three hooks; and the two shared input types. Each item is exported alongside its inputs type.

**Why it is here.** This is a **barrel** file — a file that only re-exports names from other files so that callers use one tidy import path (``from '.../lib/streaflet'``) instead of reaching into each component's own file. Grouping the exports by kind, with a comment per group, doubles as a table of contents for the whole library. It also draws the public boundary: the core factories and internal helpers are deliberately not re-exported here, so the rest of the app builds maps only from these finished pieces and never depends on the machinery inside.

.. CG-EXPLANATION-END id=module-header

