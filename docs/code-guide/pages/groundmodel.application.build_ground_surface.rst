groundmodel.application.build_ground_surface
============================================

.. CG-PAGE source=src/groundmodel/application/build_ground_surface.py complete=true

*Source file:* ``src/groundmodel/application/build_ground_surface.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-45

.. literalinclude:: ../../../src/groundmodel/application/build_ground_surface.py
   :language: python
   :lines: 1-45
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the ground-surface builder. It imports the terrain-mesh domain helpers, the ground-margin constant, the issue value object, the borehole/CPT/contact rows, the abstract elevation-data provider with its grid type, and the logger. The docstring sketches the pipeline and the layer rules.

**Why it is here.** The docstring records the architecture: this use case orchestrates a digital elevation model (DEM — a grid of ground heights) provider, tile cache and the clip domain service, but owns no geotechnical logic itself, and it only reads the database (to find the investigation locations), never writing. It deliberately imports the abstract provider, not a concrete Flemish or Dutch one, so a factory chooses the source and this code uses the interface — the one-directional-dependency rule from the start-here page.

.. CG-EXPLANATION-END id=module-header

Class ``GroundSurfaceResult``
-----------------------------

.. CG-BLOCK id=class:GroundSurfaceResult lines=46-73

.. literalinclude:: ../../../src/groundmodel/application/build_ground_surface.py
   :language: python
   :lines: 46-73
   :lineno-match:

.. CG-EXPLANATION-START id=class:GroundSurfaceResult

**What this does.** A frozen data holder for the build output: the terrain mesh as vertices and triangles, a list of coverage issues, which provider answered, and whether every tile came from the local cache.

**Why it is here.** The result is a pure value object so the web layer converts it into the response without the exporter or the database being involved; each field's meaning is documented in the docstring. Why: recorded there.

.. CG-EXPLANATION-END id=class:GroundSurfaceResult

Class ``BuildGroundSurface`` — header
-------------------------------------

.. CG-BLOCK id=class:BuildGroundSurface lines=74-93

.. literalinclude:: ../../../src/groundmodel/application/build_ground_surface.py
   :language: python
   :lines: 74-93
   :lineno-match:

.. CG-EXPLANATION-START id=class:BuildGroundSurface

**What this does.** Declares the use-case class and documents its inputs: the read-only session, a pre-built DEM provider, and the sample-grid spacing (default 10 m) and margin.

**Why it is here.** The docstring records why the provider is passed in rather than built here — the web layer selects it from the project's coordinate system, and the caller owns opening and closing it. The 10 m grid is coarser than the native DEM resolution but fine enough for a visual terrain mesh; finer spacing costs more compute for little gain at typical project sizes.

.. CG-EXPLANATION-END id=class:BuildGroundSurface

Method ``BuildGroundSurface``. ``def __init__``
-----------------------------------------------

.. CG-BLOCK id=method:BuildGroundSurface.__init__ lines=94-108

.. literalinclude:: ../../../src/groundmodel/application/build_ground_surface.py
   :language: python
   :lines: 94-108
   :lineno-match:

.. CG-EXPLANATION-START id=method:BuildGroundSurface.__init__

**What this does.** Stores the session, the provider, the grid spacing and the margin, and names the logger.

**Why it is here.** Keeps the tuning knobs on the instance so the one build call reads cleanly; the margin defaults to the shared ground-surface constant so it stays in one place.

.. CG-EXPLANATION-END id=method:BuildGroundSurface.__init__

Method ``BuildGroundSurface``. ``async def execute``
----------------------------------------------------

.. CG-BLOCK id=method:BuildGroundSurface.execute lines=109-259

.. literalinclude:: ../../../src/groundmodel/application/build_ground_surface.py
   :language: python
   :lines: 109-259
   :lineno-match:

.. CG-EXPLANATION-START id=method:BuildGroundSurface.execute

**What this does.** Builds the terrain mesh. It loads the model's investigation locations (its "hull"), returns an empty result if there are none, computes the bounding box, fetches a DEM tile covering the box plus the margin, collects any test whose own surveyed collar elevation should override the DEM, builds the triangulated terrain by sampling the grid, checks which investigations sit over DEM no-data, logs, and returns the mesh with its issues and provenance.

**Why it is here.** The comments cite the reasons. The bounding-box line is logged at INFO, not DEBUG, because a 2026-08-02 flood of failing tile requests could not be traced to a model when the only record was a DEBUG line nobody had enabled — it costs one line per build and names the offending model. The tile is fetched with the margin included so the skirt of grid nodes does not sample outside the raster and drop out. A test's surveyed collar outranks the web DEM at its location (owner ruling 2026-08-28), and a real 0.0 m TAW collar on the Belgian coast is kept as an override, never treated as missing.

.. CG-EXPLANATION-END id=method:BuildGroundSurface.execute

Method ``BuildGroundSurface``. ``async def _load_hull_points``
--------------------------------------------------------------

.. CG-BLOCK id=method:BuildGroundSurface._load_hull_points lines=260-364

.. literalinclude:: ../../../src/groundmodel/application/build_ground_surface.py
   :language: python
   :lines: 260-364
   :lineno-match:

.. CG-EXPLANATION-START id=method:BuildGroundSurface._load_hull_points

**What this does.** Loads the labelled locations of every investigation that has a contact in the model: the distinct borehole and CPT ids from the contacts, then each one's name, easting, northing and elevation. It skips any with no coordinates and de-duplicates on location.

**Why it is here.** The name travels with the location because the coverage report has to name the test the DEM could not answer for, and a raw id would be unusable in the interface. De-duplication is required because several contacts at one anchor produce the same point, and the triangulation library rejects coincident points. A collar of exactly 0.0 is kept as a real value, not coerced to missing.

.. CG-EXPLANATION-END id=method:BuildGroundSurface._load_hull_points

