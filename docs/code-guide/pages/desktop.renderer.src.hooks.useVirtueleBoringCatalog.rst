desktop.renderer.src.hooks.useVirtueleBoringCatalog
===================================================

.. CG-PAGE source=desktop/src/renderer/src/hooks/useVirtueleBoringCatalog.ts complete=true

*Source file:* ``desktop/src/renderer/src/hooks/useVirtueleBoringCatalog.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-25

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useVirtueleBoringCatalog.ts
   :language: typescript
   :lines: 1-25
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The comment and three imports. This file keeps a session-scoped cache of the DOV Virtuele Boring layer-model list (12 entries), shared by the three components that need it — the section strip and the two dropdowns on the CPT chart and borelog overlays.

**Why it is here.** It uses a module-level shared request rather than React state alone so exactly ONE network call happens per session and the cache survives every component unmount and remount; concurrent first openings share the one in-flight request. It is invalidated only on a page reload, because DOV's catalogue does not change within a session. The comment records that it deliberately does NOT use the ``createCatalogHook`` factory (audit FE-HOOKS-08) because its differences are most of the body: a defer-the-fetch gate, a retry after an error, a bare list-or-null return, and warn-logging.

.. CG-EXPLANATION-END id=module-header

``let cachedCatalog``
---------------------

.. CG-BLOCK id=let:cachedCatalog lines=26-26

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useVirtueleBoringCatalog.ts
   :language: typescript
   :lines: 26-26
   :lineno-match:

.. CG-EXPLANATION-START id=let:cachedCatalog

**What this does.** The module-level cache holding the loaded list, or ``null`` before it has loaded.

**Why it is here.** Living at module level (outside any component) means it survives component remounts, so the list is fetched once per session and reused.

.. CG-EXPLANATION-END id=let:cachedCatalog

``let inflight``
----------------

.. CG-BLOCK id=let:inflight lines=27-37

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useVirtueleBoringCatalog.ts
   :language: typescript
   :lines: 27-37
   :lineno-match:

.. CG-EXPLANATION-START id=let:inflight

**What this does.** The shared in-flight request while a fetch is running, or ``null`` otherwise. These lines also carry the documentation of the hook below.

**Why it is here.** Concurrent first mounts share this one request so two pickers opening at once do not fire two fetches; it is cleared when a fetch rejects so the next attempt can retry.

.. CG-EXPLANATION-END id=let:inflight

``function useVirtueleBoringCatalog``
-------------------------------------

.. CG-BLOCK id=function:useVirtueleBoringCatalog lines=38-83

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useVirtueleBoringCatalog.ts
   :language: typescript
   :lines: 38-83
   :lineno-match:

.. CG-EXPLANATION-START id=function:useVirtueleBoringCatalog

**What this does.** The hook. It takes an ``enabled`` flag, keeps the list in *state* seeded from the module cache, and runs an *effect* that — only when enabled — either syncs from the cache or starts (or joins) the shared fetch, storing the result in both the module cache and local state; on failure it warns and leaves the value at null. It guards against a component that went away mid-fetch and returns the list or ``null`` (the hook building-blocks introduced on the ``desktop.renderer.src.hooks.usePersistedJSON`` page).

**Why it is here.** Passing ``enabled=false`` defers the fetch until the user actually opens a picker, because most sessions never need the catalogue (engineers leave DOV overlays off). A failed fetch leaves the value ``null`` so the caller can show a graceful ``couldn't reach DOV`` hint, and a retry happens on the next enable while the cache is still empty. The fetch runs through the API client, honouring the rule that the window always reaches the engine through the API.

.. CG-EXPLANATION-END id=function:useVirtueleBoringCatalog

