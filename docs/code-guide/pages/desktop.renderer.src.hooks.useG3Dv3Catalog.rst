desktop.renderer.src.hooks.useG3Dv3Catalog
==========================================

.. CG-PAGE source=desktop/src/renderer/src/hooks/useG3Dv3Catalog.ts complete=true

*Source file:* ``desktop/src/renderer/src/hooks/useG3Dv3Catalog.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-18

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useG3Dv3Catalog.ts
   :language: typescript
   :lines: 1-18
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The doc comment and two imports. This file builds a shared loader for the G3Dv3 catalog (about 117 entries, roughly 40 KB on the wire).

**Why it is here.** The list is static across the engine's lifetime and is read by several components — the formation dialog autocomplete today, more surfaces later. The real work lives in the ``createCatalogHook`` factory (the ``desktop.renderer.src.hooks.createCatalogHook`` page); a failed fetch surfaces as an error so the caller can fall back to a plain text input.

.. CG-EXPLANATION-END id=module-header

``const g3dv3Catalog``
----------------------

.. CG-BLOCK id=const:g3dv3Catalog lines=19-23

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useG3Dv3Catalog.ts
   :language: typescript
   :lines: 19-23
   :lineno-match:

.. CG-EXPLANATION-START id=const:g3dv3Catalog

**What this does.** Builds the single shared catalog by calling the factory with a fetch that asks the API's codelists endpoint for the G3Dv3 units.

**Why it is here.** One instance per process, so every consumer shares one cache and one fetch, and the fetch goes through the API client (the frontend always reaches the engine through the API).

.. CG-EXPLANATION-END id=const:g3dv3Catalog

``function useG3Dv3Catalog``
----------------------------

.. CG-BLOCK id=function:useG3Dv3Catalog lines=24-29

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useG3Dv3Catalog.ts
   :language: typescript
   :lines: 24-29
   :lineno-match:

.. CG-EXPLANATION-START id=function:useG3Dv3Catalog

**What this does.** The hook: returns the shared G3Dv3 catalog state (units, loading, error).

**Why it is here.** A thin named wrapper so callers import a clearly-named hook rather than the factory's returned object.

.. CG-EXPLANATION-END id=function:useG3Dv3Catalog

``function _resetG3Dv3CatalogCacheForTesting``
----------------------------------------------

.. CG-BLOCK id=function:_resetG3Dv3CatalogCacheForTesting lines=30-32

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useG3Dv3Catalog.ts
   :language: typescript
   :lines: 30-32
   :lineno-match:

.. CG-EXPLANATION-START id=function:_resetG3Dv3CatalogCacheForTesting

**What this does.** Clears the module cache and any in-flight request.

**Why it is here.** A test-only escape hatch so tests can stub different fetch responses across runs without leaking state between them.

.. CG-EXPLANATION-END id=function:_resetG3Dv3CatalogCacheForTesting

