desktop.renderer.src.hooks.useWgs84
===================================

.. CG-PAGE source=desktop/src/renderer/src/hooks/useWgs84.ts complete=true

*Source file:* ``desktop/src/renderer/src/hooks/useWgs84.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-30

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useWgs84.ts
   :language: typescript
   :lines: 1-30
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Brings in the ``proj4`` projection library and registers two coordinate systems by their EPSG numbers, then declares two module-level caches. A *projection* turns map coordinates from one coordinate reference system (a *CRS*) into another; an *EPSG* number names a specific CRS — here 31370 is Belgian Lambert 72 and 28992 is Dutch RD New. Distances are metres only inside a projected metric CRS like these.

**Why it is here.** DOV files report a different EPSG in their headers, but their coordinate values are really Lambert 72, so the code always projects with the Lambert 72 definition (comment). The two caches exist because the map re-projected once per marker on every redraw — easily a thousand-plus calls per change on a real project — and projection is a *pure function* (its answer depends only on its inputs), so caching each result is safe forever. This is the ``Caching pure functions`` rule from CLAUDE.md: the cache is bounded by how many coordinates the project touches, not by how many times the screen redraws.

.. CG-EXPLANATION-END id=module-header

``const TO_WGS_CACHE``
----------------------

.. CG-BLOCK id=const:TO_WGS_CACHE lines=31-31

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useWgs84.ts
   :language: typescript
   :lines: 31-31
   :lineno-match:

.. CG-EXPLANATION-START id=const:TO_WGS_CACHE

**What this does.** The forward *memo cache* — a Map from a coordinate key to the [lat, lng] pair already computed for it.

**Why it is here.** So a coordinate seen before is looked up instead of re-projected; it grows only with new coordinates, bounded by the dataset.

.. CG-EXPLANATION-END id=const:TO_WGS_CACHE

``const FROM_WGS_CACHE``
------------------------

.. CG-BLOCK id=const:FROM_WGS_CACHE lines=32-39

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useWgs84.ts
   :language: typescript
   :lines: 32-39
   :lineno-match:

.. CG-EXPLANATION-START id=const:FROM_WGS_CACHE

**What this does.** The inverse memo cache, for turning [lat, lng] back into projected coordinates. These lines also carry the opening documentation of the first converter below.

**Why it is here.** Same memo-cache reasoning as the forward cache — the reverse conversion is just as pure and just as repeated, so it earns its own cache.

.. CG-EXPLANATION-END id=const:FROM_WGS_CACHE

``function lambertToWgs84``
---------------------------

.. CG-BLOCK id=function:lambertToWgs84 lines=40-47

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useWgs84.ts
   :language: typescript
   :lines: 40-47
   :lineno-match:

.. CG-EXPLANATION-START id=function:lambertToWgs84

**What this does.** Converts a Belgian Lambert 72 (x, y) pair into an [lat, lng] pair for the map library.

**Why it is here.** Kept for the existing Belgium-only call sites; new code should prefer the general ``projectedToWgs84`` so the Netherlands case routes through the same path naturally (comment).

.. CG-EXPLANATION-END id=function:lambertToWgs84

``function projectedToWgs84``
-----------------------------

.. CG-BLOCK id=function:projectedToWgs84 lines=48-65

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useWgs84.ts
   :language: typescript
   :lines: 48-65
   :lineno-match:

.. CG-EXPLANATION-START id=function:projectedToWgs84

**What this does.** Converts a projected (x, y) in the given EPSG into an [lat, lng] pair, looking in the cache first and storing the result if it is new. It supports 31370 and 28992 and throws for any other CRS.

**Why it is here.** This is the caching wrapper around ``proj4``. Callers are expected to check the project's horizontal EPSG before calling, and the throw makes an unsupported CRS a loud error rather than a silent wrong answer; the result is returned in [lat, lng] order because that is what the map library expects.

.. CG-EXPLANATION-END id=function:projectedToWgs84

``function wgs84ToProjected``
-----------------------------

.. CG-BLOCK id=function:wgs84ToProjected lines=66-92

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useWgs84.ts
   :language: typescript
   :lines: 66-92
   :lineno-match:

.. CG-EXPLANATION-START id=function:wgs84ToProjected

**What this does.** The inverse of the previous function: turns an [lat, lng] pair back into the given projected CRS, cached on the same key shape.

**Why it is here.** Used when a user clicks on the map and the click has to be stored as a section endpoint in the project's own native coordinate system.

.. CG-EXPLANATION-END id=function:wgs84ToProjected

``function clearProjectScopedCaches``
-------------------------------------

.. CG-BLOCK id=function:clearProjectScopedCaches lines=93-110

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useWgs84.ts
   :language: typescript
   :lines: 93-110
   :lineno-match:

.. CG-EXPLANATION-START id=function:clearProjectScopedCaches

**What this does.** Empties both projection caches. These lines also carry the documentation of the test-only helper below.

**Why it is here.** The caches grow with every coordinate a project touches, so the project lifecycle calls this on project open and close (see the ``useProject`` page) to keep them bounded by the ACTIVE project's data rather than the whole session's. It is safe to call at any moment — projection is pure, so the next lookup simply recomputes; this is memory hygiene, never a change to any coordinate.

.. CG-EXPLANATION-END id=function:clearProjectScopedCaches

``function __wgs84CacheSizesForTest``
-------------------------------------

.. CG-BLOCK id=function:__wgs84CacheSizesForTest lines=111-113

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useWgs84.ts
   :language: typescript
   :lines: 111-113
   :lineno-match:

.. CG-EXPLANATION-START id=function:__wgs84CacheSizesForTest

**What this does.** Returns the current entry counts of the forward and inverse caches.

**Why it is here.** The caches are module-private, so a test that wants to assert ``the cache filled`` or ``the cache emptied`` needs this narrow window; it mirrors the reset-for-tests convention used elsewhere in the codebase.

.. CG-EXPLANATION-END id=function:__wgs84CacheSizesForTest

