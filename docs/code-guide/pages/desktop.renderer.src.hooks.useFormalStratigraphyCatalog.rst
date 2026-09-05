desktop.renderer.src.hooks.useFormalStratigraphyCatalog
=======================================================

.. CG-PAGE source=desktop/src/renderer/src/hooks/useFormalStratigraphyCatalog.ts complete=true

*Source file:* ``desktop/src/renderer/src/hooks/useFormalStratigraphyCatalog.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-15

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useFormalStratigraphyCatalog.ts
   :language: typescript
   :lines: 1-15
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The doc comment and two imports. This file builds a shared loader for the DOV formal-stratigraphy list (about 403 entries).

**Why it is here.** The list is static across the engine's lifetime and is read by the formation dialog's ``Formal stratigraphy`` autocomplete (the informal-to-formal link). The real work lives in the ``createCatalogHook`` factory (the ``desktop.renderer.src.hooks.createCatalogHook`` page); a failed fetch surfaces as an error so the dialog degrades to a plain code input.

.. CG-EXPLANATION-END id=module-header

``const formalStratigraphyCatalog``
-----------------------------------

.. CG-BLOCK id=const:formalStratigraphyCatalog lines=16-20

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useFormalStratigraphyCatalog.ts
   :language: typescript
   :lines: 16-20
   :lineno-match:

.. CG-EXPLANATION-START id=const:formalStratigraphyCatalog

**What this does.** Builds the single shared catalog by calling the factory with a fetch that asks the API's codelists endpoint for the formal-stratigraphy units.

**Why it is here.** One instance per process, so every consumer shares one cache and one fetch. The fetch runs through the API client, honouring the rule that the window always reaches the engine through the API.

.. CG-EXPLANATION-END id=const:formalStratigraphyCatalog

``function useFormalStratigraphyCatalog``
-----------------------------------------

.. CG-BLOCK id=function:useFormalStratigraphyCatalog lines=21-25

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useFormalStratigraphyCatalog.ts
   :language: typescript
   :lines: 21-25
   :lineno-match:

.. CG-EXPLANATION-START id=function:useFormalStratigraphyCatalog

**What this does.** The hook: returns the shared formal-stratigraphy catalog state (units, loading, error).

**Why it is here.** A thin named wrapper so callers import a clearly-named hook rather than reaching into the factory's returned object.

.. CG-EXPLANATION-END id=function:useFormalStratigraphyCatalog

``function _resetFormalStratigraphyCatalogCacheForTesting``
-----------------------------------------------------------

.. CG-BLOCK id=function:_resetFormalStratigraphyCatalogCacheForTesting lines=26-28

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useFormalStratigraphyCatalog.ts
   :language: typescript
   :lines: 26-28
   :lineno-match:

.. CG-EXPLANATION-START id=function:_resetFormalStratigraphyCatalogCacheForTesting

**What this does.** Clears the module cache and any in-flight request.

**Why it is here.** A test-only escape hatch so a test can stub different fetch responses across runs without state leaking between them.

.. CG-EXPLANATION-END id=function:_resetFormalStratigraphyCatalogCacheForTesting

