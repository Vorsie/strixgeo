groundmodel.infrastructure.dem.dem_provider
===========================================

.. CG-PAGE source=src/groundmodel/infrastructure/dem/dem_provider.py complete=true

*Source file:* ``src/groundmodel/infrastructure/dem/dem_provider.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-38

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/dem_provider.py
   :language: python
   :lines: 1-38
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the abstract DEM-provider interface and the shared grid value object both concrete providers return, and imports only the tools needed to declare an interface.

**Why it is here.** The docstring states two rules. First, this file lives in the infrastructure layer, so it may use I/O and image libraries but must never reach into the domain or application layers — the one-way dependency rule. Second, the interface itself is a pure *abstract base class* (a template that names required methods but supplies no body), while the concrete providers add the project's logging behaviour. It also records why the code decodes images with the lightweight Pillow library rather than the heavier standard GIS library, whose native pieces are awkward to install on Windows.

.. CG-EXPLANATION-END id=module-header

Class ``DemZGrid`` — header
---------------------------

.. CG-BLOCK id=class:DemZGrid lines=39-79

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/dem_provider.py
   :language: python
   :lines: 39-79
   :lineno-match:

.. CG-EXPLANATION-START id=class:DemZGrid

**What this does.** Declares the frozen data holder that carries one sampled DEM tile: the four box edges, the cell size, the number of columns and rows, the flat list of height values (top row first, ``None`` for cells with no data), and a flag saying whether it came from the disk cache.

**Why it is here.** Both providers return this same shape, which insulates everything above them from the web-service details. It is a *frozen dataclass* — a small class whose only job is to hold named values and which cannot be changed after creation, so a tile once sampled is never accidentally mutated.

.. CG-EXPLANATION-END id=class:DemZGrid

Method ``DemZGrid``. ``def sample_at``
--------------------------------------

.. CG-BLOCK id=method:DemZGrid.sample_at lines=80-135

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/dem_provider.py
   :language: python
   :lines: 80-135
   :lineno-match:

.. CG-EXPLANATION-START id=method:DemZGrid.sample_at

**What this does.** Reads the ground height at any point inside the tile by *bilinear interpolation* — a weighted blend of the four surrounding grid cells — and returns ``None`` when the point is outside the tile or any of those four cells has no data.

**Why it is here.** The grid is a coarse lattice of measured heights, but the cross-section needs the height at arbitrary in-between points; blending the four neighbours gives a smooth, honest estimate. Refusing to blend when a neighbour is NoData is deliberate: averaging a real height with a "no data" marker would invent a nonsense value.

.. CG-EXPLANATION-END id=method:DemZGrid.sample_at

Class ``DemProvider`` — header
------------------------------

.. CG-BLOCK id=class:DemProvider lines=136-146

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/dem_provider.py
   :language: python
   :lines: 136-146
   :lineno-match:

.. CG-EXPLANATION-START id=class:DemProvider

**What this does.** Declares the abstract interface every DEM provider must satisfy: it can be used as an async context manager, and it promises the methods below (close, an id, a native CRS number, fetch a grid, sample along a line).

**Why it is here.** Naming the contract in one place lets the ground-surface build and the section-profile endpoint work against "a DEM provider" without caring whether it is the Belgian or the Dutch one. It is a pure abstract base class; concrete providers add logging themselves.

.. CG-EXPLANATION-END id=class:DemProvider

Method ``DemProvider``. ``async def __aenter__``
------------------------------------------------

.. CG-BLOCK id=method:DemProvider.__aenter__ lines=147-150

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/dem_provider.py
   :language: python
   :lines: 147-150
   :lineno-match:

.. CG-EXPLANATION-START id=method:DemProvider.__aenter__

**What this does.** The entry half of ``async with``; hands back the provider unchanged.

**Why it is here.** An *async context manager* is a way to guarantee clean-up (here, closing the network client) runs even if the work between fails. This entry step simply makes the provider usable in that form.

.. CG-EXPLANATION-END id=method:DemProvider.__aenter__

Method ``DemProvider``. ``async def __aexit__``
-----------------------------------------------

.. CG-BLOCK id=method:DemProvider.__aexit__ lines=151-154

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/dem_provider.py
   :language: python
   :lines: 151-154
   :lineno-match:

.. CG-EXPLANATION-START id=method:DemProvider.__aexit__

**What this does.** The exit half of ``async with``; releases the provider's network resources by calling close.

**Why it is here.** So the open HTTP connection is always closed when the block ends, whether it finished normally or raised.

.. CG-EXPLANATION-END id=method:DemProvider.__aexit__

Method ``DemProvider``. ``async def close``
-------------------------------------------

.. CG-BLOCK id=method:DemProvider.close lines=155-164

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/dem_provider.py
   :language: python
   :lines: 155-164
   :lineno-match:

.. CG-EXPLANATION-START id=method:DemProvider.close

**What this does.** A required-but-empty method promising that a provider can release its network client.

**Why it is here.** It is declared on the interface because callers who do not use the ``async with`` form must still be able to close the provider explicitly, and both real users of a provider manage it through the abstract type.

.. CG-EXPLANATION-END id=method:DemProvider.close

Method ``DemProvider``. ``def provider_id``
-------------------------------------------

.. CG-BLOCK id=method:DemProvider.provider_id lines=165-175

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/dem_provider.py
   :language: python
   :lines: 165-175
   :lineno-match:

.. CG-EXPLANATION-START id=method:DemProvider.provider_id

**What this does.** A required property returning the provider's short, stable name (such as ``"dhmvii"`` or ``"ahn4"``).

**Why it is here.** That name is used as the cache sub-folder, so every provider must supply one.

.. CG-EXPLANATION-END id=method:DemProvider.provider_id

Method ``DemProvider``. ``def native_epsg``
-------------------------------------------

.. CG-BLOCK id=method:DemProvider.native_epsg lines=176-186

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/dem_provider.py
   :language: python
   :lines: 176-186
   :lineno-match:

.. CG-EXPLANATION-START id=method:DemProvider.native_epsg

**What this does.** A required property returning the numeric name of the provider's native map system (31370 for Belgium, 28992 for the Netherlands).

**Why it is here.** The factory matches a project's map system to the right provider by this number.

.. CG-EXPLANATION-END id=method:DemProvider.native_epsg

Method ``DemProvider``. ``async def fetch_grid``
------------------------------------------------

.. CG-BLOCK id=method:DemProvider.fetch_grid lines=187-221

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/dem_provider.py
   :language: python
   :lines: 187-221
   :lineno-match:

.. CG-EXPLANATION-START id=method:DemProvider.fetch_grid

**What this does.** A required method promising to return a DEM tile covering a given box, either freshly fetched or served from cache; its docstring lists the errors it may raise for a network failure or an undecodable response.

**Why it is here.** This is the core promise of the interface: give it a rectangle in the provider's own map units, get back a filled grid. Naming the possible failures on the contract lets callers handle them uniformly.

.. CG-EXPLANATION-END id=method:DemProvider.fetch_grid

Method ``DemProvider``. ``async def sample_along_line``
-------------------------------------------------------

.. CG-BLOCK id=method:DemProvider.sample_along_line lines=222-259

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/dem_provider.py
   :language: python
   :lines: 222-259
   :lineno-match:

.. CG-EXPLANATION-START id=method:DemProvider.sample_along_line

**What this does.** A required method promising a row of evenly-spaced elevation samples from one endpoint of a line to the other, with ``None`` on cells that have no data.

**Why it is here.** This backs the ground-surface line drawn across the top of a cross-section (feature #234). The docstring notes it rides the same tile cache as the grid fetch, so re-opening a section never re-downloads its strip.

.. CG-EXPLANATION-END id=method:DemProvider.sample_along_line

