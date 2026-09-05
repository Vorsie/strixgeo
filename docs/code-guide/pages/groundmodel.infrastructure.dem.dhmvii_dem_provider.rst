groundmodel.infrastructure.dem.dhmvii_dem_provider
==================================================

.. CG-PAGE source=src/groundmodel/infrastructure/dem/dhmvii_dem_provider.py complete=true

*Source file:* ``src/groundmodel/infrastructure/dem/dhmvii_dem_provider.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-40

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/dhmvii_dem_provider.py
   :language: python
   :lines: 1-40
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the Belgian (Flanders) DEM provider and, in its docstring, records where the data comes from: the Geopunt web service for DHMV II, the 1 m bare-ground LiDAR height model, in the Belgian grid (EPSG:31370 Lambert 72). It imports that provider's fixed values, the multipart splitter it needs, and the shared base class.

**Why it is here.** Like the Dutch file, this holds only what is different about the Belgian source; the shared base does the work. The docstring records the live web address (verified 2026-05-11) and the water-body limitation that matches the recorded DEM design: over rivers and canals DHMV II reports the water surface, not the bed, and cells with no data are marked ``-9999``. Per-waterway bed data is out of scope for the ground-surface feature (G7).

.. CG-EXPLANATION-END id=module-header

Class ``DhmviiDemProvider`` — header
------------------------------------

.. CG-BLOCK id=class:DhmviiDemProvider lines=41-50

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/dhmvii_dem_provider.py
   :language: python
   :lines: 41-50
   :lineno-match:

.. CG-EXPLANATION-START id=class:DhmviiDemProvider

**What this does.** Declares the Belgian provider as a small subclass of the shared WCS base, filling in the five per-source values: the web address, the coverage name, the axis names ``X``/``Y``, the 1 m native cell size, the sensible-coordinate box, and the log label.

**Why it is here.** As with the Dutch provider, listing these values is all it takes to turn the shared download-and-decode pipeline into a complete Belgian provider without repeating any of it.

.. CG-EXPLANATION-END id=class:DhmviiDemProvider

Method ``DhmviiDemProvider``. ``def provider_id``
-------------------------------------------------

.. CG-BLOCK id=method:DhmviiDemProvider.provider_id lines=51-55

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/dhmvii_dem_provider.py
   :language: python
   :lines: 51-55
   :lineno-match:

.. CG-EXPLANATION-START id=method:DhmviiDemProvider.provider_id

**What this does.** Returns the short name ``"dhmvii"``.

**Why it is here.** This becomes the cache sub-folder, keeping Belgian tiles separate from Dutch ones on disk.

.. CG-EXPLANATION-END id=method:DhmviiDemProvider.provider_id

Method ``DhmviiDemProvider``. ``def native_epsg``
-------------------------------------------------

.. CG-BLOCK id=method:DhmviiDemProvider.native_epsg lines=56-60

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/dhmvii_dem_provider.py
   :language: python
   :lines: 56-60
   :lineno-match:

.. CG-EXPLANATION-START id=method:DhmviiDemProvider.native_epsg

**What this does.** Returns 31370, the numeric name of the Belgian grid (Lambert 72).

**Why it is here.** The factory matches a project's map system to a provider by this number.

.. CG-EXPLANATION-END id=method:DhmviiDemProvider.native_epsg

Method ``DhmviiDemProvider``. ``def _extract_tiff``
---------------------------------------------------

.. CG-BLOCK id=method:DhmviiDemProvider._extract_tiff lines=61-64

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/dhmvii_dem_provider.py
   :language: python
   :lines: 61-64
   :lineno-match:

.. CG-EXPLANATION-START id=method:DhmviiDemProvider._extract_tiff

**What this does.** Pulls the image out of the response by handing it to the multipart splitter.

**Why it is here.** The Geopunt service replies with two parts glued together — an XML description then the image — so unlike the Dutch service its image must be extracted before it can be decoded.

.. CG-EXPLANATION-END id=method:DhmviiDemProvider._extract_tiff

Method ``DhmviiDemProvider``. ``def _is_nodata``
------------------------------------------------

.. CG-BLOCK id=method:DhmviiDemProvider._is_nodata lines=65-67

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/dhmvii_dem_provider.py
   :language: python
   :lines: 65-67
   :lineno-match:

.. CG-EXPLANATION-START id=method:DhmviiDemProvider._is_nodata

**What this does.** Reports a pixel as having no data when its value exactly equals ``-9999``.

**Why it is here.** That is the marker DHMV II embeds in its metadata for cells with no real height (water bodies, hill shadows, outside coverage). An exact match is right here because it is a fixed integer sentinel, not a huge float.

.. CG-EXPLANATION-END id=method:DhmviiDemProvider._is_nodata

