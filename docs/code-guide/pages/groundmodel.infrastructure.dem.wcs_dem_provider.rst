groundmodel.infrastructure.dem.wcs_dem_provider
===============================================

.. CG-PAGE source=src/groundmodel/infrastructure/dem/wcs_dem_provider.py complete=true

*Source file:* ``src/groundmodel/infrastructure/dem/wcs_dem_provider.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-59

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/wcs_dem_provider.py
   :language: python
   :lines: 1-59
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the shared base class both DEM providers build on, and imports the pieces it needs: the HTTP and image libraries, the two caches (the on-disk tile store and the in-memory failure memory), the shared grid shape, the constants, the pure line-sampler, the DEM error types, and the project logger.

**Why it is here.** The docstring records the design: the two providers run an identical pipeline — build an HTTP client, pad the box, serve from disk on a warm hit, otherwise request the coverage, extract and cache the image, and decode it into a grid with NoData cells set to ``None`` — so that pipeline is written once here. Subclasses only declare their per-source constants and override the two genuinely different steps. As infrastructure it may use HTTP and image libraries but never the domain or application layers, and because it does real work and logs it, it inherits the project logger.

.. CG-EXPLANATION-END id=module-header

Function ``def _is_permanent_upstream_failure``
-----------------------------------------------

.. CG-BLOCK id=function:_is_permanent_upstream_failure lines=60-85

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/wcs_dem_provider.py
   :language: python
   :lines: 60-85
   :lineno-match:

.. CG-EXPLANATION-START id=function:_is_permanent_upstream_failure

**What this does.** Decides whether a failure is one that asking again cannot fix: a client-side (4xx) status or an undecodable body counts as permanent, while connection errors, timeouts and server (5xx) statuses count as temporary.

**Why it is here.** Only permanent failures are worth remembering in the negative cache. The docstring is explicit that suppressing a temporary failure would be wrong: a dropped connection or a brief server outage self-heals, and a five-minute local blackout on those would keep refusing over a network that is already back.

.. CG-EXPLANATION-END id=function:_is_permanent_upstream_failure

Class ``WcsDemProvider`` — header
---------------------------------

.. CG-BLOCK id=class:WcsDemProvider lines=86-115

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/wcs_dem_provider.py
   :language: python
   :lines: 86-115
   :lineno-match:

.. CG-EXPLANATION-START id=class:WcsDemProvider

**What this does.** Declares the shared pipeline class, listing the five per-source values a subclass must set (web address, coverage name, axis names, default cell size, valid-coordinate box, log label) and noting the two methods it must override.

**Why it is here.** It combines the abstract DEM interface with the project logger. The docstring advises constructing one provider and reusing it within a request so the HTTP client keeps its connections warm — the standard efficiency point for repeated web calls.

.. CG-EXPLANATION-END id=class:WcsDemProvider

Method ``WcsDemProvider``. ``def __init__``
-------------------------------------------

.. CG-BLOCK id=method:WcsDemProvider.__init__ lines=116-133

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/wcs_dem_provider.py
   :language: python
   :lines: 116-133
   :lineno-match:

.. CG-EXPLANATION-START id=method:WcsDemProvider.__init__

**What this does.** Sets up the provider: names the logger after the concrete subclass's module, stores the given tile cache, and opens one reusable HTTP client with connection reuse (HTTP/2), redirect following, and the shared timeout.

**Why it is here.** Naming the logger after the real subclass means log lines say which provider spoke. Opening the client once and reusing it keeps network connections warm across the many tile requests a single build makes. A *timeout* is the limit after which a stuck request is abandoned rather than hanging the app.

.. CG-EXPLANATION-END id=method:WcsDemProvider.__init__

Method ``WcsDemProvider``. ``async def __aenter__``
---------------------------------------------------

.. CG-BLOCK id=method:WcsDemProvider.__aenter__ lines=134-137

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/wcs_dem_provider.py
   :language: python
   :lines: 134-137
   :lineno-match:

.. CG-EXPLANATION-START id=method:WcsDemProvider.__aenter__

**What this does.** The entry half of ``async with``; returns the provider unchanged.

**Why it is here.** Lets the provider be used in the guaranteed-clean-up form.

.. CG-EXPLANATION-END id=method:WcsDemProvider.__aenter__

Method ``WcsDemProvider``. ``async def __aexit__``
--------------------------------------------------

.. CG-BLOCK id=method:WcsDemProvider.__aexit__ lines=138-141

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/wcs_dem_provider.py
   :language: python
   :lines: 138-141
   :lineno-match:

.. CG-EXPLANATION-START id=method:WcsDemProvider.__aexit__

**What this does.** The exit half of ``async with``; closes the HTTP client.

**Why it is here.** So the network connection is always released when the block ends.

.. CG-EXPLANATION-END id=method:WcsDemProvider.__aexit__

Method ``WcsDemProvider``. ``async def close``
----------------------------------------------

.. CG-BLOCK id=method:WcsDemProvider.close lines=142-149

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/wcs_dem_provider.py
   :language: python
   :lines: 142-149
   :lineno-match:

.. CG-EXPLANATION-START id=method:WcsDemProvider.close

**What this does.** Closes the HTTP client explicitly.

**Why it is here.** For callers that manage the provider by hand rather than through ``async with``.

.. CG-EXPLANATION-END id=method:WcsDemProvider.close

Method ``WcsDemProvider``. ``def _extract_tiff``
------------------------------------------------

.. CG-BLOCK id=method:WcsDemProvider._extract_tiff lines=150-167

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/wcs_dem_provider.py
   :language: python
   :lines: 150-167
   :lineno-match:

.. CG-EXPLANATION-START id=method:WcsDemProvider._extract_tiff

**What this does.** A placeholder that raises "not implemented" — the real behaviour is supplied by each subclass.

**Why it is here.** This is one of the two genuinely different steps: the Belgian service returns a two-part reply, the Dutch service a plain image, so each pulls the raw image out its own way. Declaring it here documents the seam.

.. CG-EXPLANATION-END id=method:WcsDemProvider._extract_tiff

Method ``WcsDemProvider``. ``def _is_nodata``
---------------------------------------------

.. CG-BLOCK id=method:WcsDemProvider._is_nodata lines=168-186

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/wcs_dem_provider.py
   :language: python
   :lines: 168-186
   :lineno-match:

.. CG-EXPLANATION-START id=method:WcsDemProvider._is_nodata

**What this does.** A placeholder that raises "not implemented" — each subclass supplies its own NoData test.

**Why it is here.** The second of the two different steps: Belgium uses a ``-9999`` marker, the Netherlands a huge-float threshold.

.. CG-EXPLANATION-END id=method:WcsDemProvider._is_nodata

Method ``WcsDemProvider``. ``async def fetch_grid``
---------------------------------------------------

.. CG-BLOCK id=method:WcsDemProvider.fetch_grid lines=187-253

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/wcs_dem_provider.py
   :language: python
   :lines: 187-253
   :lineno-match:

.. CG-EXPLANATION-START id=method:WcsDemProvider.fetch_grid

**What this does.** Returns a DEM grid tile for a box: it pads the box a little, fetches the image (from cache or the network), and decodes it into a grid; on a fresh network fetch it logs a success line with the pixel size and how many cells were empty.

**Why it is here.** This is the main entry point for a 2-D tile. The small padding guarantees every edge pixel has a neighbour to blend with, so sampling near the box edge still works. The cache-versus-network distinction is carried on the grid so callers and logs can tell a warm hit from a download.

.. CG-EXPLANATION-END id=method:WcsDemProvider.fetch_grid

Method ``WcsDemProvider``. ``async def sample_along_line``
----------------------------------------------------------

.. CG-BLOCK id=method:WcsDemProvider.sample_along_line lines=254-323

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/wcs_dem_provider.py
   :language: python
   :lines: 254-323
   :lineno-match:

.. CG-EXPLANATION-START id=method:WcsDemProvider.sample_along_line

**What this does.** Returns evenly-spaced elevation samples along a line: it builds the padded box around the line's ends, fetches that one strip (cache or network), and samples the image directly with the pure line-sampler — skipping the full grid decode for a 1-D profile.

**Why it is here.** This backs the ground-surface line across a cross-section (feature #234). It rides the same tile cache as the grid fetch, so re-opening a section never re-downloads its strip, and it skips the heavier full-grid decode because a profile only needs values along one line.

.. CG-EXPLANATION-END id=method:WcsDemProvider.sample_along_line

Method ``WcsDemProvider``. ``async def _fetch_tile_tiff``
---------------------------------------------------------

.. CG-BLOCK id=method:WcsDemProvider._fetch_tile_tiff lines=324-436

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/wcs_dem_provider.py
   :language: python
   :lines: 324-436
   :lineno-match:

.. CG-EXPLANATION-START id=method:WcsDemProvider._fetch_tile_tiff

**What this does.** The single cache-first fetch shared by both the grid and the line paths: it checks the disk cache first; on a miss it refuses an impossible box and a recently-failed box, then requests the coverage, extracts the image, records permanent failures in the negative cache, writes the image to the disk cache, and returns it.

**Why it is here.** Putting the whole fetch in one place means both callers get identical caching, guarding and failure-suppression. The docstring records the deliberate ordering: a cached tile is served even for an odd-looking box (the bytes settle the question), but nothing walks to the network for a box that cannot exist or one that just failed permanently — the fix for the 2026-08-02 request flood.

.. CG-EXPLANATION-END id=method:WcsDemProvider._fetch_tile_tiff

Method ``WcsDemProvider``. ``def _refuse_impossible_extent``
------------------------------------------------------------

.. CG-BLOCK id=method:WcsDemProvider._refuse_impossible_extent lines=437-510

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/wcs_dem_provider.py
   :language: python
   :lines: 437-510
   :lineno-match:

.. CG-EXPLANATION-START id=method:WcsDemProvider._refuse_impossible_extent

**What this does.** Raises a "refused" error for a box that no service can ever answer: a non-finite edge (from arithmetic on a missing coordinate), a box outside the map system's own area of use, or a box wider than the 25 km per-axis cap. A zero-height or zero-width box is allowed.

**Why it is here.** These three shapes are always caller bugs, not real requests, and each would otherwise cause an endless string of impossible network calls. The origin-anchored strip from the 2026-08-02 dogfeed is the outside-the-CRS case. A dead-straight east–west section line legitimately has a zero-height box, so that is explicitly not refused. The refused box is echoed on the error so the interface can name the offending numbers back to the caller.

.. CG-EXPLANATION-END id=method:WcsDemProvider._refuse_impossible_extent

Method ``WcsDemProvider``. ``def _decode_tiff``
-----------------------------------------------

.. CG-BLOCK id=method:WcsDemProvider._decode_tiff lines=511-596

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/wcs_dem_provider.py
   :language: python
   :lines: 511-596
   :lineno-match:

.. CG-EXPLANATION-START id=method:WcsDemProvider._decode_tiff

**What this does.** Turns raw image bytes into a grid: it reads the width and height, refuses to decode a tile whose declared pixel count exceeds the 100-million cap, works out the cell size from the box and dimensions, then reads every pixel and maps NoData cells to ``None``.

**Why it is here.** The image's declared size comes from the untrusted server, so the pixel cap is checked before the decode loop allocates one object per pixel — the guard that stops a hostile or broken server from hanging or exhausting the backend's memory. Because the DEM is only a fallback, an over-cap tile becomes a clean "no DEM here" rather than a crash.

.. CG-EXPLANATION-END id=method:WcsDemProvider._decode_tiff

