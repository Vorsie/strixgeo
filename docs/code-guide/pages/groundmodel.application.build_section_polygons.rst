groundmodel.application.build_section_polygons
==============================================

.. CG-PAGE source=src/groundmodel/application/build_section_polygons.py complete=true

*Source file:* ``src/groundmodel/application/build_section_polygons.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-56

.. literalinclude:: ../../../src/groundmodel/application/build_section_polygons.py
   :language: python
   :lines: 1-56
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the section-polygon resolver. It imports the closed-polygon value objects it produces, the section snapshot, the partition input types from the voxel builder, the formation row, the geology repository and the logger, and defines the minimum column count for a gap.

**Why it is here.** The docstring records the central decision: the two-dimensional partition fill is computed in the renderer and POSTed to the backend, exactly as the 3-D build already receives it, because the section is the editing surface — what the engineer sees filled is the model, and re-deriving polygons on the backend would produce a different, plausible geometry that disagrees with the screen. So this use case only converts the renderer's gap-local fractions (0 at a gap's left column, 1 at its right) into absolute along-distances and attaches each region's unit identity — the same linear mapping the voxel builder uses, so a D-Stability export and a 3-D build describe the same ground.

.. CG-EXPLANATION-END id=module-header

Class ``BuildSectionPolygons`` — header
---------------------------------------

.. CG-BLOCK id=class:BuildSectionPolygons lines=57-59

.. literalinclude:: ../../../src/groundmodel/application/build_section_polygons.py
   :language: python
   :lines: 57-59
   :lineno-match:

.. CG-EXPLANATION-START id=class:BuildSectionPolygons

**What this does.** Declares the use-case class that turns a renderer-drawn partition into a set of closed section polygons.

**Why it is here.** Why: recorded in the class + module docstrings.

.. CG-EXPLANATION-END id=class:BuildSectionPolygons

Method ``BuildSectionPolygons``. ``def __init__``
-------------------------------------------------

.. CG-BLOCK id=method:BuildSectionPolygons.__init__ lines=60-82

.. literalinclude:: ../../../src/groundmodel/application/build_section_polygons.py
   :language: python
   :lines: 60-82
   :lineno-match:

.. CG-EXPLANATION-START id=method:BuildSectionPolygons.__init__

**What this does.** Stores the session and either the supplied geology repository or a fresh one over the session, and names the logger.

**Why it is here.** The repository can be overridden so the fraction-to-metres conversion can be unit-tested without a database; the production path leaves it unset and builds the default.

.. CG-EXPLANATION-END id=method:BuildSectionPolygons.__init__

Method ``BuildSectionPolygons``. ``async def execute``
------------------------------------------------------

.. CG-BLOCK id=method:BuildSectionPolygons.execute lines=83-155

.. literalinclude:: ../../../src/groundmodel/application/build_section_polygons.py
   :language: python
   :lines: 83-155
   :lineno-match:

.. CG-EXPLANATION-START id=method:BuildSectionPolygons.execute

**What this does.** Resolves the partition against the project's formations. It loads the formations, reads the column along-distances, returns an empty set with a warning if there are fewer than two columns (so no gap exists), converts every region to absolute coordinates, declares the units actually used, logs any dropped regions, and returns the polygon set.

**Why it is here.** An empty result is returned rather than a crash when the partition has too few columns; the closed-geometry exporters refuse an empty set rather than writing an empty file. The section metadata is taken from the already-scope-guarded snapshot the caller passes, so this method does no re-checking of project ownership.

.. CG-EXPLANATION-END id=method:BuildSectionPolygons.execute

Method ``BuildSectionPolygons``. ``def _convert_regions``
---------------------------------------------------------

.. CG-BLOCK id=method:BuildSectionPolygons._convert_regions lines=156-213

.. literalinclude:: ../../../src/groundmodel/application/build_section_polygons.py
   :language: python
   :lines: 156-213
   :lineno-match:

.. CG-EXPLANATION-START id=method:BuildSectionPolygons._convert_regions

**What this does.** Maps each region to absolute coordinates and counts the ones that cannot be placed. For each region it parses the formation id, drops it with a numbered warning if the id is not a real formation in the project or the gap index is out of range, otherwise reads the two bracketing column positions and turns every (fraction, elevation) vertex into an (along-metres, elevation) point.

**Why it is here.** A dropped region is reported with a ``[i/total]`` progress prefix — the Definition-of-Done loop-logging rule — and names the reason: a region referencing an absent formation means the partition outlived the model it was drawn against. The linear interpolation between the two columns' own along-distances is the shared mapping named in the module docstring.

.. CG-EXPLANATION-END id=method:BuildSectionPolygons._convert_regions

Method ``BuildSectionPolygons``. ``def _units_in_use``
------------------------------------------------------

.. CG-BLOCK id=method:BuildSectionPolygons._units_in_use lines=214-235

.. literalinclude:: ../../../src/groundmodel/application/build_section_polygons.py
   :language: python
   :lines: 214-235
   :lineno-match:

.. CG-EXPLANATION-START id=method:BuildSectionPolygons._units_in_use

**What this does.** Declares one unit per formation that actually fills a polygon — its id, name, NAD class, soil code, colour and display order — sorted by display order then name.

**Why it is here.** Only units that fill something are declared, so a downstream tool never receives an empty layer; sorting gives a stable, engineer-preferred order.

.. CG-EXPLANATION-END id=method:BuildSectionPolygons._units_in_use

Method ``BuildSectionPolygons``. ``def _empty``
-----------------------------------------------

.. CG-BLOCK id=method:BuildSectionPolygons._empty lines=236-253

.. literalinclude:: ../../../src/groundmodel/application/build_section_polygons.py
   :language: python
   :lines: 236-253
   :lineno-match:

.. CG-EXPLANATION-START id=method:BuildSectionPolygons._empty

**What this does.** Builds a polygon set that carries the section metadata but no geometry.

**Why it is here.** Returned when there is no gap to place regions in; the exporters refuse this empty set rather than writing a meaningless artefact.

.. CG-EXPLANATION-END id=method:BuildSectionPolygons._empty

Function ``def _as_uuid``
-------------------------

.. CG-BLOCK id=function:_as_uuid lines=254-259

.. literalinclude:: ../../../src/groundmodel/application/build_section_polygons.py
   :language: python
   :lines: 254-259
   :lineno-match:

.. CG-EXPLANATION-START id=function:_as_uuid

**What this does.** A small helper that parses a payload-supplied formation id string into an id, returning nothing when it is not a valid one.

**Why it is here.** The region ids arrive from the renderer's POSTed payload as text, so they must be validated before use; a malformed id drops its region rather than crashing the resolve.

.. CG-EXPLANATION-END id=function:_as_uuid

