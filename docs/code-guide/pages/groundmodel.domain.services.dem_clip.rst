groundmodel.domain.services.dem_clip
====================================

.. CG-PAGE source=src/groundmodel/domain/services/dem_clip.py complete=true

*Source file:* ``src/groundmodel/domain/services/dem_clip.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-49

.. literalinclude:: ../../../src/groundmodel/domain/services/dem_clip.py
   :language: python
   :lines: 1-49
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the rule that clamps a formation surface down to the ground, and imports what it needs: the two issue-kind labels, the TIN types and the triangulation function, and the plain problem-record holder. A TIN is a triangulated irregular network, a surface built from triangles through scattered points.

**Why it is here.** The rule from the geology-stage design is that no formation surface may sit above the ground surface at the same map point, so each surface vertex is lowered to the DEM (digital elevation model, a grid of ground heights) where a sample exists. The module is pure: the caller samples the DEM grid and passes the results in as a plain function, which keeps the domain from importing infrastructure. It never raises — a conflict is recorded as a problem item, following Data Integrity Rule 5, and the clamp still applies so the rendered model stays geologically valid.

.. CG-EXPLANATION-END id=module-header

Class ``GroundPoint``
---------------------

.. CG-BLOCK id=class:GroundPoint lines=50-73

.. literalinclude:: ../../../src/groundmodel/domain/services/dem_clip.py
   :language: python
   :lines: 50-73
   :lineno-match:

.. CG-EXPLANATION-START id=class:GroundPoint

**What this does.** A frozen data holder for one location whose ground elevation matters — an investigation collar: its display label, its map coordinates, and its own surveyed collar elevation when one was recorded.

**Why it is here.** The label is used verbatim in the issue text so the engineer can find the test without looking up an internal id. The collar elevation outranks the DEM at that spot (owner ruling 2026-08-28), and a collar of exactly zero metres is a real surveyed value, deliberately kept distinct from "no elevation recorded".

.. CG-EXPLANATION-END id=class:GroundPoint

Class ``ClipResult``
--------------------

.. CG-BLOCK id=class:ClipResult lines=74-93

.. literalinclude:: ../../../src/groundmodel/domain/services/dem_clip.py
   :language: python
   :lines: 74-93
   :lineno-match:

.. CG-EXPLANATION-START id=class:ClipResult

**What this does.** A frozen data holder for the output of the clip: the clamped surface, a list of problem findings, and the count of vertices that were actually lowered.

**Why it is here.** Bundling the surface with its findings and the clamp count lets the caller both render the corrected surface and report what it had to change. An empty findings list means a clean clip; the count tells the caller how much of the surface overshot the terrain.

.. CG-EXPLANATION-END id=class:ClipResult

Function ``def clip_tin_to_dem``
--------------------------------

.. CG-BLOCK id=function:clip_tin_to_dem lines=94-189

.. literalinclude:: ../../../src/groundmodel/domain/services/dem_clip.py
   :language: python
   :lines: 94-189
   :lineno-match:

.. CG-EXPLANATION-START id=function:clip_tin_to_dem

**What this does.** Clamps every surface vertex to the DEM at its map location. For each vertex it samples the DEM: a NoData cell leaves the vertex unchanged but records a low-confidence finding; a vertex above the terrain is lowered to it, and if the overshoot is more than five centimetres a contact-above-DEM finding is recorded; a vertex at or below the terrain passes through. Triangle indices are never touched.

**Why it is here.** Clamping at build time, not just at render, keeps the stored model geologically valid. A NoData cell is left unchanged because there is no reliable target to clamp to — it may be outside coverage or over water. The five-centimetre threshold suppresses findings for tiny differences that are just rounding at the survey-versus-model boundary and not worth the engineer's attention. Only elevations move; no vertex is removed or reordered, so the triangles stay valid.

.. CG-EXPLANATION-END id=function:clip_tin_to_dem

Function ``def build_ground_surface_tin``
-----------------------------------------

.. CG-BLOCK id=function:build_ground_surface_tin lines=190-333

.. literalinclude:: ../../../src/groundmodel/domain/services/dem_clip.py
   :language: python
   :lines: 190-333
   :lineno-match:

.. CG-EXPLANATION-START id=function:build_ground_surface_tin

**What this does.** Builds a terrain surface over the model. It samples the DEM on a regular grid across the investigations' bounding box plus a margin, and also places a vertex at each investigation, then triangulates the valid samples. Where an investigation has a surveyed collar it uses that instead of the DEM sample, and it skips any grid node that lands on an anchor.

**Why it is here.** The surface exists so the engineer can read the vertical daylight between the terrain and the interpreted model top at a column, so a vertex is anchored at each test: a regular grid alone puts the nearest ground point up to half a step away and averages out a local dip, making the daylight wrong by that amount. A surveyed collar wins over the DEM (owner ruling 2026-08-28: "I trust surface elevation of a test more than a DEM we pulled off the web"), and a collar of exactly zero is used as a value, not treated as absent. Anchoring first then skipping coincident grid nodes is what lets a collar win even for the tests on the bounding-box edge.

.. CG-EXPLANATION-END id=function:build_ground_surface_tin

Function ``def assess_ground_coverage``
---------------------------------------

.. CG-BLOCK id=function:assess_ground_coverage lines=334-382

.. literalinclude:: ../../../src/groundmodel/domain/services/dem_clip.py
   :language: python
   :lines: 334-382
   :lineno-match:

.. CG-EXPLANATION-START id=function:assess_ground_coverage

**What this does.** Reports the investigations the DEM has no ground elevation for, returning one low-confidence finding per uncovered test, naming it.

**Why it is here.** The terrain surface triangulates only the nodes the DEM could answer, so a NoData region is spanned by triangulation and looks complete even over water — this function is what says otherwise, per Data Integrity Rule 5: record the finding, do not raise. It is scoped to the tests, not every grid node, because one finding per test is actionable while one per node would drown the signal for a site beside a river. Modelling the bed of a water body is out of scope for now (debt #27); flagging the affected tests is the honest half that ships.

.. CG-EXPLANATION-END id=function:assess_ground_coverage

