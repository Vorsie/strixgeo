groundmodel.domain.services.voxel_litho.geo_bands
=================================================

.. CG-PAGE source=src/groundmodel/domain/services/voxel_litho/geo_bands.py complete=true

*Source file:* ``src/groundmodel/domain/services/voxel_litho/geo_bands.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-48

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/geo_bands.py
   :language: python
   :lines: 1-48
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the helpers that reason about geological bands inside the voxel builder, and imports the surface type. A set of geological surfaces (each held as a TIN — a triangulated irregular network, a surface built from a mesh of triangles through scattered points) splits 3-D space into vertical bands: band 0 is above every surface, and the last band is below every surface. The three operations answer: which band a point is in, what the top and bottom elevations of a band are at a place, and whether an investigation's logged stack overlaps a band there.

**Why it is here.** The docstring records the band rule, ported verbatim from the retired strat-field builder: a point's band index is the number of surfaces whose elevation at that map point is strictly above the point, and the strict comparison means a point exactly on a surface belongs to the deeper band. It notes several deliberate choices: the outermost bands have an open bound written as nothing rather than a fake number, so callers treat them as plus or minus infinity explicitly; surfaces need not arrive sorted, so each function sorts them at the query point, which is well-defined because geological surfaces do not cross within a project. The functions take an immutable tuple rather than a list to match the builder's frozen style. Each helper has a fast twin that takes elevations already computed once per column, to avoid millions of redundant surface look-ups.

.. CG-EXPLANATION-END id=module-header

Function ``def band_of``
------------------------

.. CG-BLOCK id=function:band_of lines=49-92

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/geo_bands.py
   :language: python
   :lines: 49-92
   :lineno-match:

.. CG-EXPLANATION-START id=function:band_of

**What this does.** Returns which geological band a 3-D point falls in. It evaluates each surface's elevation at the point's map position once, then counts how many sit strictly above the point.

**Why it is here.** This is the thin, convenient form of the band rule for a caller that has a point but not the surface elevations yet. The docstring notes that a caller looping over a whole column should instead compute the surface elevations once and call the fast twin, because the voxel labeller would otherwise repeat about 13 million surface scans. It accepts a tuple so callers need not build a mutable list, and an empty tuple puts everything in band 0.

.. CG-EXPLANATION-END id=function:band_of

Function ``def band_of_from_elevs``
-----------------------------------

.. CG-BLOCK id=function:band_of_from_elevs lines=93-119

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/geo_bands.py
   :language: python
   :lines: 93-119
   :lineno-match:

.. CG-EXPLANATION-START id=function:band_of_from_elevs

**What this does.** Returns the band index from surface elevations that were already computed at the query point: it simply counts how many of those elevations sit strictly above the point.

**Why it is here.** This is the fast form used inside the labelling loop, where the surface elevations for a column are worked out once and reused for every voxel in that column. The docstring guarantees it is byte-identical to the slow form when fed the same evaluated elevations, because the rule is purely the count of elevations above the point — order does not matter and the same strict comparison is used.

.. CG-EXPLANATION-END id=function:band_of_from_elevs

Function ``def band_extent``
----------------------------

.. CG-BLOCK id=function:band_extent lines=120-174

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/geo_bands.py
   :language: python
   :lines: 120-174
   :lineno-match:

.. CG-EXPLANATION-START id=function:band_extent

**What this does.** Returns the top and bottom elevations of one geological band at a map point. It evaluates each surface there, sorts them shallowest-first, and reads off the surface just above and just below the requested band, giving nothing for an open bound at the shallowest top or deepest base.

**Why it is here.** The labeller needs the elevation window of a band to know where to place material within it. The docstring pins the boundary convention so it matches the band rule exactly: because a point exactly on a surface belongs to the shallower band, a band occupies the half-open window from its base up to but not including its top. As with the other helpers, a caller holding the per-column elevations should call the fast twin to avoid re-scanning the surfaces.

.. CG-EXPLANATION-END id=function:band_extent

Function ``def band_extent_from_elevs``
---------------------------------------

.. CG-BLOCK id=function:band_extent_from_elevs lines=175-219

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/geo_bands.py
   :language: python
   :lines: 175-219
   :lineno-match:

.. CG-EXPLANATION-START id=function:band_extent_from_elevs

**What this does.** Returns a band's top and bottom elevations from surface elevations already computed at the query point. It sorts the elevations shallowest-first, then picks the one above and the one below the requested band, returning nothing for an open outermost bound.

**Why it is here.** This is the fast form used inside the labelling loop. The docstring is careful that it is byte-identical to the slow form on the same evaluated elevations: the descending sort reproduces the surface sort on identical numbers, Python's stable sort keeps equal elevations in the same order in both paths, and the open-bound and index rules are unchanged. Two short comments name which sorted position is the top bound and which is the base.

.. CG-EXPLANATION-END id=function:band_extent_from_elevs

Function ``def section_reaches_band``
-------------------------------------

.. CG-BLOCK id=function:section_reaches_band lines=220-266

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/geo_bands.py
   :language: python
   :lines: 220-266
   :lineno-match:

.. CG-EXPLANATION-START id=function:section_reaches_band

**What this does.** Returns whether any interval of an investigation's logged stack overlaps a geological band at a map point. It evaluates the surfaces there and checks each logged interval's elevation range against the band's window, requiring a real overlap, not just a boundary touch.

**Why it is here.** The band-aware labeller needs to know whether an investigation actually said anything about the ground inside a band before it lets that log speak there. The docstring fixes two edge rules: an open band bound is treated as plus or minus infinity, and an overlap of exactly zero (a mere touch) does not count, guarded by a tiny numeric tolerance. It delegates to the fast twin so a caller with the per-column elevations avoids re-scanning the surfaces.

.. CG-EXPLANATION-END id=function:section_reaches_band

Function ``def section_reaches_band_from_elevs``
------------------------------------------------

.. CG-BLOCK id=function:section_reaches_band_from_elevs lines=267-314

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/geo_bands.py
   :language: python
   :lines: 267-314
   :lineno-match:

.. CG-EXPLANATION-START id=function:section_reaches_band_from_elevs

**What this does.** Returns whether any interval of a logged stack overlaps a band, using surface elevations already computed at the query point. An empty stack answers no; otherwise it takes the band's window, treats open bounds as infinities, and returns yes as soon as one interval overlaps the window by more than the tiny tolerance.

**Why it is here.** This is the fast form used inside the labelling loop, byte-identical to the slow form on the same elevations because the band window comes from the byte-identical band-extent twin and the overlap arithmetic is unchanged. The early return on an empty stack avoids pointless work when an investigation logged nothing.

.. CG-EXPLANATION-END id=function:section_reaches_band_from_elevs

