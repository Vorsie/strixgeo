desktop.renderer.src.api.client
===============================

.. CG-PAGE source=desktop/src/renderer/src/api/client.ts complete=true

*Source file:* ``desktop/src/renderer/src/api/client.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-228

.. literalinclude:: ../../../desktop/src/renderer/src/api/client.ts
   :language: typescript
   :lines: 1-228
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment for the whole API-client layer, followed by a long list of re-exports. The comment explains that all the real code — the data-shape descriptions, the error classes, the helper functions and the ``api`` object — lives in smaller files under ``api/clients/``, and that this file simply hands those same names back out. The re-exports are grouped by subject: first the shared HTTP layer (``setBaseUrl`` and the ``ApiError`` failure class), then one group each for CPT soundings, boreholes, projects, cross-sections and the DEM ground line, then the large geology group, then the codelists and the Virtuele Boring predictions. ``export type { … }`` lines pass through the data-shape descriptions; plain ``export { … }`` lines pass through the runnable error classes.

**Why it is here.** This file is a *barrel re-export* — a file that only re-exports names from other files so that every caller keeps a single, unchanging import path (``./api/client``) even though the code behind it was split into per-subject modules. It exists so the split could happen without editing hundreds of call sites. It also carries the layer's founding rule, *the frontend always goes through the API* (CLAUDE.md; ``docs/api.md``): the window never reaches into the database or the Python engine directly — every read and every write is one of these client calls over the local web connection, which is the whole reason an ``api/`` layer exists at all. The comment beside ``ApiError`` records a hard-won exception: code that must decide behaviour from an HTTP status imports that class straight from ``clients/shared`` rather than through this barrel, because a unit test that replaces this module with a stand-in would otherwise hand back an empty binding and silently break the ``instanceof`` check at run time.

.. CG-EXPLANATION-END id=module-header

``const api``
-------------

.. CG-BLOCK id=const:api lines=229-239

.. literalinclude:: ../../../desktop/src/renderer/src/api/client.ts
   :language: typescript
   :lines: 229-239
   :lineno-match:

.. CG-EXPLANATION-START id=const:api

**What this does.** Builds the single ``api`` object that the rest of the app calls. It pulls in each subject's client object — CPT, borehole, project, DEM, geology, review, section, codelists, Virtuele Boring — and nests them under short names, so a caller writes ``api.geology.listContacts(...)`` or ``api.cpt.plotBatch(...)``.

**Why it is here.** The per-subject split changed where the code lives but must not change how it is called; nesting the clients back under the original names here means every existing call site keeps working untouched. One structured object also gives a reader a single map of everything the app can ask the engine to do.

.. CG-EXPLANATION-END id=const:api

