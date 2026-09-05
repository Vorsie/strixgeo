groundmodel.infrastructure.gis.spatial_query
============================================

.. CG-PAGE source=src/groundmodel/infrastructure/gis/spatial_query.py complete=true

*Source file:* ``src/groundmodel/infrastructure/gis/spatial_query.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-62

.. literalinclude:: ../../../src/groundmodel/infrastructure/gis/spatial_query.py
   :language: python
   :lines: 1-62
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the defensive helpers for PostGIS spatial queries, imports the geometry types and query builders, and defines the canonical query system (WGS84, EPSG:4326) plus the sanity range for its coordinates.

**Why it is here.** The docstring records the trap: each location is stored in its own source system with no fixed system id on the column, so one column can hold Belgian and Dutch rows, and PostGIS hard-errors the moment a query compares two different systems. A developer testing with single-system fixtures never sees it. These helpers force every spatial filter to convert both sides to one system first, and they are the only supported path for new spatial queries — a raw comparison that skips them is a review-blocker. WGS84 is chosen as the common system because incoming boxes already use it, every accepted system converts to it cleanly, and PostGIS ships its grid built in. An *SRID* is the numeric system id attached to a geometry.

.. CG-EXPLANATION-END id=module-header

Function ``def transformed_bbox_filter``
----------------------------------------

.. CG-BLOCK id=function:transformed_bbox_filter lines=63-132

.. literalinclude:: ../../../src/groundmodel/infrastructure/gis/spatial_query.py
   :language: python
   :lines: 63-132
   :lineno-match:

.. CG-EXPLANATION-START id=function:transformed_bbox_filter

**What this does.** Builds a "is this location inside this box" filter that first converts the stored geometry column into the box's system, then tests it against a box built in that same system; it rejects a backwards or out-of-range box up front.

**Why it is here.** Converting the column side to the box's system before the test is what lets rows in different source systems all be compared safely — the fix for the mixed-system crash. The up-front range check catches the common mistake of passing metre coordinates as degrees, surfacing a clear error instead of a confusing empty result.

.. CG-EXPLANATION-END id=function:transformed_bbox_filter

Function ``def transformed_distance_filter``
--------------------------------------------

.. CG-BLOCK id=function:transformed_distance_filter lines=133-186

.. literalinclude:: ../../../src/groundmodel/infrastructure/gis/spatial_query.py
   :language: python
   :lines: 133-186
   :lineno-match:

.. CG-EXPLANATION-START id=function:transformed_distance_filter

**What this does.** Builds a "within N metres of this point" filter by casting both sides to the geography type, whose distances are always in metres; it validates the centre coordinates and requires a positive radius.

**Why it is here.** The geography cast measures distance in real metres regardless of the source system and forces both sides into one system internally, which sidesteps the mixed-system risk entirely — the right tool for a "everything within 500 m of the pin" query.

.. CG-EXPLANATION-END id=function:transformed_distance_filter

Function ``def assert_consistent_epsg``
---------------------------------------

.. CG-BLOCK id=function:assert_consistent_epsg lines=187-226

.. literalinclude:: ../../../src/groundmodel/infrastructure/gis/spatial_query.py
   :language: python
   :lines: 187-226
   :lineno-match:

.. CG-EXPLANATION-START id=function:assert_consistent_epsg

**What this does.** Given a list of system ids (some possibly missing), returns the single shared id, or nothing when all are missing or the list is empty, and raises when two different ids appear.

**Why it is here.** Lets a caller bail loudly on mixed-system input before building a query, rather than relying on PostGIS's later error message. Missing ids are skipped because a row can legitimately lack a system when its source file did not tag one.

.. CG-EXPLANATION-END id=function:assert_consistent_epsg

