desktop.renderer.src.hooks.createCatalogHook
============================================

.. CG-PAGE source=desktop/src/renderer/src/hooks/createCatalogHook.ts complete=true

*Source file:* ``desktop/src/renderer/src/hooks/createCatalogHook.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-26

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/createCatalogHook.ts
   :language: typescript
   :lines: 1-26
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The doc comment and the two-hook import. This file is a *factory* — a function that builds and returns another function — for ``catalog`` hooks, each of which loads one fixed reference list once and then shares it everywhere. The comment describes the behaviour every hook it builds will have.

**Why it is here.** It cites audit FE-HOOKS-08: the G3Dv3 and the formal-stratigraphy catalog hooks were once verbatim copies of the same ``load once, share the in-flight request, cache forever`` logic, so this factory is the single implementation both now use — the ``extract on the second copy`` rule from CLAUDE.md. The comment also records that the Virtuele Boring catalog deliberately does NOT use this factory, because its own version differs in most of the body.

.. CG-EXPLANATION-END id=module-header

``interface CatalogState``
--------------------------

.. CG-BLOCK id=interface:CatalogState lines=27-48

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/createCatalogHook.ts
   :language: typescript
   :lines: 27-48
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CatalogState

**What this does.** The snapshot every catalog hook hands back: the ``units`` list (or ``null`` until it is known), a ``loading`` flag, and an ``error`` (or ``null``). It is *generic* over the unit type ``T``, so one shape covers every catalog. These lines also carry the documentation of the factory function below.

**Why it is here.** One agreed return shape means a caller reads ``units`` / ``loading`` / ``error`` the same way no matter which catalog it is using.

.. CG-EXPLANATION-END id=interface:CatalogState

``function createCatalogHook``
------------------------------

.. CG-BLOCK id=function:createCatalogHook lines=49-102

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/createCatalogHook.ts
   :language: typescript
   :lines: 49-102
   :lineno-match:

.. CG-EXPLANATION-START id=function:createCatalogHook

**What this does.** The factory. It takes a ``fetchUnits`` function that loads the whole list once, and keeps two values hidden inside it — a ``cache`` and an ``inflight`` request. ``loadCatalog`` returns the cache if it is already filled, or the shared in-flight request if a fetch is already running, otherwise it starts one. The returned ``useCatalog`` hook holds the state (seeded from the cache) and an *effect* that — unless the cache is already filled — calls ``loadCatalog`` and stores either the result or the error, while guarding against a component that went away mid-fetch. It also returns a ``resetForTesting``.

**Why it is here.** The behaviour is exactly the comment's contract: the first mount kicks a single fetch; concurrent first mounts share the one in-flight request so there are never duplicate fetches; a success caches for the whole process so later mounts resolve instantly; a failure is surfaced as ``error`` and deliberately NOT retried (the rejected request is kept, matching the original hooks), and only a page reload resets it. The ``fetchUnits`` each hook supplies goes through the API client, honouring the rule that the window always reaches the engine through the API layer, never the database directly.

.. CG-EXPLANATION-END id=function:createCatalogHook

