groundmodel.infrastructure.dem.ahn4_dem_provider
================================================

.. CG-PAGE source=src/groundmodel/infrastructure/dem/ahn4_dem_provider.py complete=true

*Source file:* ``src/groundmodel/infrastructure/dem/ahn4_dem_provider.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-43

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/ahn4_dem_provider.py
   :language: python
   :lines: 1-43
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the Dutch DEM provider and, in its docstring, records exactly where the data comes from: the PDOK web service for AHN4, the 0.5 m bare-ground LiDAR height model, in the Dutch national grid (EPSG:28992 RD New). It then imports that provider's four fixed values and the shared base class the provider builds on.

**Why it is here.** This file holds only what is different about the Dutch source; the heavy machinery (fetching, caching, decoding) lives once in the shared base. The docstring is the reference for the live web address and its quirks: a *coordinate reference system (CRS)* is a way of turning a place on Earth into map numbers, an *EPSG code* is a numeric name for one such system, and PDOK's service names its two request axes ``E`` (Easting) and ``N`` (Northing) because the OGC WCS 2.0 standard takes axis names from the CRS definition. It also notes that over rivers and canals the model gives the water surface, not the bed — the same limitation the Belgian source has.

.. CG-EXPLANATION-END id=module-header

Class ``Ahn4DemProvider`` — header
----------------------------------

.. CG-BLOCK id=class:Ahn4DemProvider lines=44-53

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/ahn4_dem_provider.py
   :language: python
   :lines: 44-53
   :lineno-match:

.. CG-EXPLANATION-START id=class:Ahn4DemProvider

**What this does.** Declares the Dutch DEM provider as a small subclass of the shared WCS base, filling in the five per-source values: the web address, the coverage name, the axis names ``E``/``N``, the 0.5 m native cell size, the sensible-coordinate box, and a short label for the log.

**Why it is here.** The shared base does all the work but needs to be told which source it is talking to. *WCS* (Web Coverage Service) is a standard web request that returns a rectangle of gridded values; listing these values as class attributes is how one small file becomes a complete provider without repeating the download-and-decode code.

.. CG-EXPLANATION-END id=class:Ahn4DemProvider

Method ``Ahn4DemProvider``. ``def provider_id``
-----------------------------------------------

.. CG-BLOCK id=method:Ahn4DemProvider.provider_id lines=54-58

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/ahn4_dem_provider.py
   :language: python
   :lines: 54-58
   :lineno-match:

.. CG-EXPLANATION-START id=method:Ahn4DemProvider.provider_id

**What this does.** Returns the short name ``"ahn4"``.

**Why it is here.** This name becomes the sub-folder the tiles are cached under, so Dutch tiles never mix with Belgian ones on disk.

.. CG-EXPLANATION-END id=method:Ahn4DemProvider.provider_id

Method ``Ahn4DemProvider``. ``def native_epsg``
-----------------------------------------------

.. CG-BLOCK id=method:Ahn4DemProvider.native_epsg lines=59-63

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/ahn4_dem_provider.py
   :language: python
   :lines: 59-63
   :lineno-match:

.. CG-EXPLANATION-START id=method:Ahn4DemProvider.native_epsg

**What this does.** Returns 28992, the numeric name of the Dutch national grid (Amersfoort / RD New).

**Why it is here.** The factory that picks a provider matches a project's map system to a provider by this number, so it must state the CRS it speaks natively.

.. CG-EXPLANATION-END id=method:Ahn4DemProvider.native_epsg

Method ``Ahn4DemProvider``. ``def _extract_tiff``
-------------------------------------------------

.. CG-BLOCK id=method:Ahn4DemProvider._extract_tiff lines=64-76

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/ahn4_dem_provider.py
   :language: python
   :lines: 64-76
   :lineno-match:

.. CG-EXPLANATION-START id=method:Ahn4DemProvider._extract_tiff

**What this does.** Takes the raw response body, checks its first two bytes are one of the two markers that begin every TIFF image, and passes it straight through; anything else raises a clear error saying the box was probably outside the Netherlands.

**Why it is here.** PDOK returns the image on its own, so there is nothing to unwrap — only to verify. A *GeoTIFF* is an image file whose pixels are ground heights; when the request lands outside coverage the server sends an XML error message instead, and catching that here turns it into a readable explanation rather than a confusing decode crash. (The docstring records this behaviour.)

.. CG-EXPLANATION-END id=method:Ahn4DemProvider._extract_tiff

Method ``Ahn4DemProvider``. ``def _is_nodata``
----------------------------------------------

.. CG-BLOCK id=method:Ahn4DemProvider._is_nodata lines=77-79

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/ahn4_dem_provider.py
   :language: python
   :lines: 77-79
   :lineno-match:

.. CG-EXPLANATION-START id=method:Ahn4DemProvider._is_nodata

**What this does.** Reports a pixel as having no data when its value is at or above a very large threshold.

**Why it is here.** PDOK marks cells with no real height (outside coverage, or permanent water) using the largest number a 32-bit float can hold. Comparing against a threshold rather than an exact number is safer, because decoding the image can nudge that huge value slightly. A *NoData* value is a stand-in that means "no measurement here".

.. CG-EXPLANATION-END id=method:Ahn4DemProvider._is_nodata

