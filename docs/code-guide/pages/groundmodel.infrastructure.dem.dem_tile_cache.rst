groundmodel.infrastructure.dem.dem_tile_cache
=============================================

.. CG-PAGE source=src/groundmodel/infrastructure/dem/dem_tile_cache.py complete=true

*Source file:* ``src/groundmodel/infrastructure/dem/dem_tile_cache.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-45

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/dem_tile_cache.py
   :language: python
   :lines: 1-45
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the on-disk store of downloaded DEM image tiles and its two tuning numbers: how often to check the folder's total size (every 32 writes) and how far below the ceiling to sweep when it is over (down to 90 %).

**Why it is here.** The docstring says this deliberately mirrors the DOV XML cache: filesystem first, the network only on a cold cell, and a wipe is always safe because the DEM is public data that can be re-fetched. Each tile is one file whose name encodes its box and resolution, so no separate index is needed. The size sweep bounds disk use; sweeping to a little below the ceiling leaves headroom so the very next write does not immediately trigger another sweep.

.. CG-EXPLANATION-END id=module-header

Function ``def _tile_filename``
-------------------------------

.. CG-BLOCK id=function:_tile_filename lines=46-75

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/dem_tile_cache.py
   :language: python
   :lines: 46-75
   :lineno-match:

.. CG-EXPLANATION-START id=function:_tile_filename

**What this does.** Turns a tile's four box edges and cell size into a stable filename, each number written to two decimal places and joined with underscores, ending in ``.tiff``.

**Why it is here.** Rounding to two decimals means two requests for the same logical tile always produce the same filename, so they hit the same cached file rather than missing. The fixed ``.tiff`` ending lets the size sweep skip any unrelated files in the folder.

.. CG-EXPLANATION-END id=function:_tile_filename

Class ``DemTileCache`` — header
-------------------------------

.. CG-BLOCK id=class:DemTileCache lines=76-92

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/dem_tile_cache.py
   :language: python
   :lines: 76-92
   :lineno-match:

.. CG-EXPLANATION-START id=class:DemTileCache

**What this does.** Declares the persistent tile cache, taking the root folder, the provider name (used as a sub-folder), and an optional soft size ceiling above which the oldest tiles are deleted.

**Why it is here.** Storing each provider's tiles in its own sub-folder keeps Belgian and Dutch tiles from colliding. This class inherits the project logger (per the logging-by-inheritance convention) because it acts and reports; a ``None`` ceiling turns eviction off, which suits tests and slow-growing caches.

.. CG-EXPLANATION-END id=class:DemTileCache

Method ``DemTileCache``. ``def __init__``
-----------------------------------------

.. CG-BLOCK id=method:DemTileCache.__init__ lines=93-116

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/dem_tile_cache.py
   :language: python
   :lines: 93-116
   :lineno-match:

.. CG-EXPLANATION-START id=method:DemTileCache.__init__

**What this does.** Sets up the cache: records the per-provider folder and the ceiling, tries to create the folder, and — if a ceiling is set — runs one clean-up sweep at start-up. If the folder cannot be created it logs a warning and quietly disables the cache for the session.

**Why it is here.** A cache that cannot make its folder must never stop the app: every read then simply misses and every write does nothing, so sampling transparently falls back to the network. The start-up sweep matters because the write counter resets each launch; without it, many short sessions could each add a few tiles and drift past the ceiling forever.

.. CG-EXPLANATION-END id=method:DemTileCache.__init__

Method ``DemTileCache``. ``def get``
------------------------------------

.. CG-BLOCK id=method:DemTileCache.get lines=117-154

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/dem_tile_cache.py
   :language: python
   :lines: 117-154
   :lineno-match:

.. CG-EXPLANATION-START id=method:DemTileCache.get

**What this does.** Returns the stored image bytes for a tile, or ``None`` on a miss or any read error; it logs a hit or miss at the finest log level.

**Why it is here.** This is the fast path checked before any download. Treating a read error the same as a miss keeps the rule that a cache problem never breaks sampling — it just falls through to the network.

.. CG-EXPLANATION-END id=method:DemTileCache.get

Method ``DemTileCache``. ``def put``
------------------------------------

.. CG-BLOCK id=method:DemTileCache.put lines=155-198

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/dem_tile_cache.py
   :language: python
   :lines: 155-198
   :lineno-match:

.. CG-EXPLANATION-START id=method:DemTileCache.put

**What this does.** Writes a tile safely by writing to a temporary file first and then renaming it into place; any failure is logged, the temporary file is cleaned up, and the method returns without raising. Every so often it also triggers a size-check sweep.

**Why it is here.** The write-then-rename step is for crash safety: a half-written image would later decode as broken and confuse sampling, and renaming only ever publishes a complete file. As always, a cache failure is swallowed so an import or a build is never blocked by disk trouble.

.. CG-EXPLANATION-END id=method:DemTileCache.put

Method ``DemTileCache``. ``def _path_for``
------------------------------------------

.. CG-BLOCK id=method:DemTileCache._path_for lines=199-213

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/dem_tile_cache.py
   :language: python
   :lines: 199-213
   :lineno-match:

.. CG-EXPLANATION-START id=method:DemTileCache._path_for

**What this does.** Works out the file path for a tile, returning ``None`` when the provider folder does not exist.

**Why it is here.** Centralises the filename rule and gives every read and write one honest way to say "the cache is unusable", which is how the disabled-cache case stays transparent.

.. CG-EXPLANATION-END id=method:DemTileCache._path_for

Method ``DemTileCache``. ``def _maybe_evict``
---------------------------------------------

.. CG-BLOCK id=method:DemTileCache._maybe_evict lines=214-253

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/dem_tile_cache.py
   :language: python
   :lines: 214-253
   :lineno-match:

.. CG-EXPLANATION-START id=method:DemTileCache._maybe_evict

**What this does.** When a ceiling is set, totals the folder's ``.tiff`` files and, if over the ceiling, deletes them oldest-first until the total drops to about 90 % of the ceiling; every step tolerates an error, and it logs how much it freed.

**Why it is here.** This is what actually bounds the cache's disk use. It only touches ``.tiff`` files it owns (never the hidden temporary files), and sweeping to below the ceiling leaves headroom so the next write does not immediately sweep again.

.. CG-EXPLANATION-END id=method:DemTileCache._maybe_evict

