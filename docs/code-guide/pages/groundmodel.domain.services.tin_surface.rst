groundmodel.domain.services.tin_surface
=======================================

.. CG-PAGE source=src/groundmodel/domain/services/tin_surface.py complete=true

*Source file:* ``src/groundmodel/domain/services/tin_surface.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-79

.. literalinclude:: ../../../src/groundmodel/domain/services/tin_surface.py
   :language: python
   :lines: 1-79
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the pure-geometry services that turn a formation's contact points into an interpolated surface and cut that surface along a section line. It imports the maths and hashing libraries and numpy, the concave-hull tightness constant, and the value objects for a contact point, a section line, a slice point and the surface itself, and sets up a logger.

**Why it is here.** The docstring explains why a TIN is the default surface method: it is sub-millisecond to compute so the surface refreshes as the engineer drags a contact, it is exact at the picks so a hand-placed top is not smoothed away, every export tool handles triangulated surfaces natively, and it has one tightness knob rather than a data-driven fit, so the same contacts always give the same surface. A ``method`` column leaves room for kriging or other methods later. Empty or degenerate inputs return an empty surface so the caller renders nothing rather than crashing.

.. CG-EXPLANATION-END id=module-header

Function ``def compute_tin``
----------------------------

.. CG-BLOCK id=function:compute_tin lines=80-242

.. literalinclude:: ../../../src/groundmodel/domain/services/tin_surface.py
   :language: python
   :lines: 80-242
   :lineno-match:

.. CG-EXPLANATION-START id=function:compute_tin

**What this does.** Triangulates a formation's contact points into a surface. It drops non-finite points, returns a vertices-only surface when fewer than three valid points remain, collapses duplicate map positions, runs Delaunay triangulation (which connects scattered points into non-overlapping triangles), then trims boundary triangles whose circumscribed-circle radius exceeds a multiple of the median edge length. If the trim would remove every triangle it keeps them all and warns.

**Why it is here.** Delaunay triangulates the full convex hull, which drapes large triangles across regions with no boreholes — the "drooping edges". The concave-hull trim (an alpha-shape) drops those void-spanning triangles so the surface hugs the borehole footprint and simply does not exist where the data cannot constrain it. The radius test is the canonical alpha-shape: it removes fat-but-large boundary triangles and near-collinear slivers, and the tightness auto-scales per formation off the median spacing so a sparse formation is not judged against a dense one's. The never-wipe guard degrades a hopeless spread to a droopy-but-present surface rather than a vanished one. Scipy is imported inside the function so it stays off the boot path.

.. CG-EXPLANATION-END id=function:compute_tin

Function ``def checksum_contacts``
----------------------------------

.. CG-BLOCK id=function:checksum_contacts lines=243-267

.. literalinclude:: ../../../src/groundmodel/domain/services/tin_surface.py
   :language: python
   :lines: 243-267
   :lineno-match:

.. CG-EXPLANATION-START id=function:checksum_contacts

**What this does.** Computes a short, stable hash over a set of contact points — their ids and coordinates, sorted by id — and returns a sixteen-byte digest.

**Why it is here.** The recompute hook uses it to skip work when the contacts have not really changed, for example a no-op edit that round-trips the same depth. Sorting by id makes the hash order-insensitive, since the source set is a set; including the id means swapping two contacts at identical coordinates still triggers a recompute, because downstream interpretation can differ even when the geometry does not.

.. CG-EXPLANATION-END id=function:checksum_contacts

Function ``def evaluate_tin_at``
--------------------------------

.. CG-BLOCK id=function:evaluate_tin_at lines=268-324

.. literalinclude:: ../../../src/groundmodel/domain/services/tin_surface.py
   :language: python
   :lines: 268-324
   :lineno-match:

.. CG-EXPLANATION-START id=function:evaluate_tin_at

**What this does.** Returns the surface's elevation at a map point by finding the triangle whose flat projection contains the point and blending its three corner elevations by their barycentric weights. Barycentric weights are the proportions in which a point divides a triangle. It returns nothing when the point is outside every triangle or the surface has none.

**Why it is here.** This is the sampling primitive the crossing validator and the band bounds rest on. The weights are computed from signed-area ratios, numerically stable for real triangles; a point on a shared edge matches only one triangle within noise, and even if it matched both they give the same elevation. The cost is proportional to the triangle count per call, acceptable at the model's cardinality, with a KD-tree noted as the upgrade if it ever becomes a bottleneck.

.. CG-EXPLANATION-END id=function:evaluate_tin_at

Function ``def nearest_vertex_elevation``
-----------------------------------------

.. CG-BLOCK id=function:nearest_vertex_elevation lines=325-361

.. literalinclude:: ../../../src/groundmodel/domain/services/tin_surface.py
   :language: python
   :lines: 325-361
   :lineno-match:

.. CG-EXPLANATION-START id=function:nearest_vertex_elevation

**What this does.** Returns the elevation of the vertex closest to a map point, comparing squared distances to avoid a square root, and returns zero for an empty vertex list.

**Why it is here.** It is the shared off-footprint fallback for TIN sampling: when the interpolation returns nothing because the point is outside every triangle, callers degrade to the nearest vertex so they always hand back a finite elevation. It replaces two hand-rolled copies that lived in the model domain and the band bound, keeping the fallback single-sourced.

.. CG-EXPLANATION-END id=function:nearest_vertex_elevation

Function ``def slice_tin``
--------------------------

.. CG-BLOCK id=function:slice_tin lines=362-451

.. literalinclude:: ../../../src/groundmodel/domain/services/tin_surface.py
   :language: python
   :lines: 362-451
   :lineno-match:

.. CG-EXPLANATION-START id=function:slice_tin

**What this does.** Cuts the surface with a vertical plane along a section line and returns the resulting polyline. It projects every vertex onto the line as an along-distance and a perpendicular offset, finds the triangle edges that cross the line by a sign change in offset, interpolates the crossing point's along-position and elevation on each, and sorts the crossings by along-distance.

**Why it is here.** Cutting the triangles, rather than connecting picks projected onto the line, is what lets off-line vertices contribute through their triangle's intersection — the previous render silently dropped off-line picks. Duplicate along-values where the line passes through a vertex are kept rather than merged, because the export consumers treat them as harmless zero-length segments. A zero-length line returns an empty polyline with a warning.

.. CG-EXPLANATION-END id=function:slice_tin

