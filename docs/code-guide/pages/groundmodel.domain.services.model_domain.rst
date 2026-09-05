groundmodel.domain.services.model_domain
========================================

.. CG-PAGE source=src/groundmodel/domain/services/model_domain.py complete=true

*Source file:* ``src/groundmodel/domain/services/model_domain.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-65

.. literalinclude:: ../../../src/groundmodel/domain/services/model_domain.py
   :language: python
   :lines: 1-65
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the geometry that frames the 3-D litho model: the concave footprint of the tests, which tests reach deep enough to anchor the model base, and a value class answering three spatial questions for any map point. It imports numpy and the TIN helpers, and lists what it exports.

**Why it is here.** The docstring states its purity carefully: only numpy and scipy are used, both already used by the TIN code in this same package, and scipy is imported lazily inside the one function that triangulates so importing this module at boot does not drag scipy onto the start-up path. A TIN, a triangulated irregular network, is a surface built from a mesh of triangles through scattered points. The value class computes rather than acts, so it does not inherit the logging base.

.. CG-EXPLANATION-END id=module-header

Class ``DomainTest``
--------------------

.. CG-BLOCK id=class:DomainTest lines=66-97

.. literalinclude:: ../../../src/groundmodel/domain/services/model_domain.py
   :language: python
   :lines: 66-97
   :lineno-match:

.. CG-EXPLANATION-START id=class:DomainTest

**What this does.** A frozen data holder for one test that contributes to the model: its id, its map position (easting and northing in metres), its ground-surface elevation, and the elevation of its deepest measured point.

**Why it is here.** The domain geometry needs each test's horizontal position and its top and bottom elevation, and nothing else. Bundling exactly those into a read-only value keeps the geometry independent of how tests are stored.

.. CG-EXPLANATION-END id=class:DomainTest

Function ``def alpha_hull_polygon``
-----------------------------------

.. CG-BLOCK id=function:alpha_hull_polygon lines=98-235

.. literalinclude:: ../../../src/groundmodel/domain/services/model_domain.py
   :language: python
   :lines: 98-235
   :lineno-match:

.. CG-EXPLANATION-START id=function:alpha_hull_polygon

**What this does.** Computes the concave outline (the alpha shape) of a cloud of map points. It triangulates the points, keeps only triangles small enough by a circumradius rule, collects the edges that belong to just one kept triangle as the outer shell, and walks them into a closed ring. When the shape fragments into several loops it returns the largest by area.

**Why it is here.** A concave hull hugs the real spread of the tests, unlike a convex hull that would bridge across empty ground; the model footprint must not claim ground nobody investigated. The docstring notes the circumradius rule matches the TIN code exactly so the two trims agree. The walk fails loudly on a non-manifold boundary (where an over-tight trim pinches the hull at a shared vertex) rather than silently dropping part of the outline.

.. CG-EXPLANATION-END id=function:alpha_hull_polygon

Function ``def deep_reaching_mask``
-----------------------------------

.. CG-BLOCK id=function:deep_reaching_mask lines=236-287

.. literalinclude:: ../../../src/groundmodel/domain/services/model_domain.py
   :language: python
   :lines: 236-287
   :lineno-match:

.. CG-EXPLANATION-START id=function:deep_reaching_mask

**What this does.** Classifies each test as deep-reaching or shallow. A test is deep-reaching when its base elevation is at or below the deepest geological band at its location, within a tolerance. With geology present each test is judged against its own local band; without it, all tests are judged against the deepest base overall.

**Why it is here.** The model base must be interpolated only through tests that actually reach the bottom, so shallow tests do not pull the base up locally. The docstring is precise that elevations are negative-downward, so at-or-deeper-than is the correct comparison; getting that direction wrong would invert deep and shallow.

.. CG-EXPLANATION-END id=function:deep_reaching_mask

Function ``def ring_contains``
------------------------------

.. CG-BLOCK id=function:ring_contains lines=288-325

.. literalinclude:: ../../../src/groundmodel/domain/services/model_domain.py
   :language: python
   :lines: 288-325
   :lineno-match:

.. CG-EXPLANATION-START id=function:ring_contains

**What this does.** Reports whether a map point is inside a closed ring, using the standard ray-casting parity test, with an optional tolerance that admits a point sitting on or just outside the boundary.

**Why it is here.** The docstring explains this lives at module level so the coverage check can ask the question before a model object exists, keeping a single ray-cast in the codebase rather than two. The tolerance matters because the voxel builder tests grid-cell centres against the hull, and strict parity flips roughly half of the on-boundary cells to outside; a cell whose centre sits on the edge still overlaps the data footprint, so it should count as inside.

.. CG-EXPLANATION-END id=function:ring_contains

Function ``def distance_to_ring``
---------------------------------

.. CG-BLOCK id=function:distance_to_ring lines=326-362

.. literalinclude:: ../../../src/groundmodel/domain/services/model_domain.py
   :language: python
   :lines: 326-362
   :lineno-match:

.. CG-EXPLANATION-START id=function:distance_to_ring

**What this does.** Returns the shortest distance from a map point to a closed ring, taken as the minimum over every edge of the point-to-segment distance.

**Why it is here.** The containment test needs to know how far a point is from the boundary to admit boundary-coincident cells within a tolerance. Measuring to the nearest edge segment, with the along-edge position clamped to the segment, gives the true shortest distance even when the nearest point is an edge's end.

.. CG-EXPLANATION-END id=function:distance_to_ring

Class ``ModelDomain`` — header
------------------------------

.. CG-BLOCK id=class:ModelDomain lines=363-389

.. literalinclude:: ../../../src/groundmodel/domain/services/model_domain.py
   :language: python
   :lines: 363-389
   :lineno-match:

.. CG-EXPLANATION-START id=class:ModelDomain

**What this does.** A class that holds the model's spatial bounds: the footprint ring, the ids of any tests the footprint does not cover, and two TIN surfaces, one for the ground top and one for the deep base. It answers whether a point is inside, its top elevation, and its base elevation.

**Why it is here.** The docstring makes the uncovered-tests list load-bearing: when the alpha shape fragments and only its largest ring survives, dropped tests get no model at all, so the caller MUST surface a non-empty list rather than report a build that quietly modelled half a project. The top surface uses all tests while the base uses only deep-reaching ones, which is what keeps shallow tests from truncating the base.

.. CG-EXPLANATION-END id=class:ModelDomain

Method ``ModelDomain``. ``def __init__``
----------------------------------------

.. CG-BLOCK id=method:ModelDomain.__init__ lines=390-421

.. literalinclude:: ../../../src/groundmodel/domain/services/model_domain.py
   :language: python
   :lines: 390-421
   :lineno-match:

.. CG-EXPLANATION-START id=method:ModelDomain.__init__

**What this does.** Stores the footprint ring and the uncovered-test ids, and builds the two TIN surfaces from the vertex lists and triangle index lists it is handed.

**Why it is here.** The object is created only by the factory below, which has already done the triangulation, so the constructor just wraps the pre-computed pieces into the two surfaces the query methods read. Keeping construction dumb keeps all the real geometry in one factory.

.. CG-EXPLANATION-END id=method:ModelDomain.__init__

Method ``ModelDomain``. ``def contains``
----------------------------------------

.. CG-BLOCK id=method:ModelDomain.contains lines=422-450

.. literalinclude:: ../../../src/groundmodel/domain/services/model_domain.py
   :language: python
   :lines: 422-450
   :lineno-match:

.. CG-EXPLANATION-START id=method:ModelDomain.contains

**What this does.** Reports whether a map point is inside the footprint, delegating to the module-level ring test, with the same optional boundary tolerance.

**Why it is here.** The docstring explains the tolerance in detail: the voxel labeller gates every grid column on this call, and strict parity is numerically unstable for cell centres landing exactly on a hull edge, voiding about half of them even though the labeller produces a full stack there. Passing a tolerance of about half a cell diagonal makes a boundary-coincident cell count as inside, which fixed the 2-D fill going discontinuous across hull-edge corridors.

.. CG-EXPLANATION-END id=method:ModelDomain.contains

Method ``ModelDomain``. ``def _distance_to_boundary``
-----------------------------------------------------

.. CG-BLOCK id=method:ModelDomain._distance_to_boundary lines=451-468

.. literalinclude:: ../../../src/groundmodel/domain/services/model_domain.py
   :language: python
   :lines: 451-468
   :lineno-match:

.. CG-EXPLANATION-START id=method:ModelDomain._distance_to_boundary

**What this does.** Returns the shortest distance from a point to the footprint boundary, delegating to the module-level ring-distance helper.

**Why it is here.** The containment test uses this to admit boundary-coincident grid nodes within a tolerance. It is a thin method so the object exposes the distance in its own terms while the one real implementation stays at module level.

.. CG-EXPLANATION-END id=method:ModelDomain._distance_to_boundary

Method ``ModelDomain``. ``def top_at``
--------------------------------------

.. CG-BLOCK id=method:ModelDomain.top_at lines=469-489

.. literalinclude:: ../../../src/groundmodel/domain/services/model_domain.py
   :language: python
   :lines: 469-489
   :lineno-match:

.. CG-EXPLANATION-START id=method:ModelDomain.top_at

**What this does.** Returns the ground-surface elevation at a map point by interpolating the top TIN, falling back to the nearest surface vertex when the point lies outside the triangulated area.

**Why it is here.** Callers must always receive a finite ground level, even just outside the mesh, so the nearest-vertex fallback replaces a would-be no-answer. The top surface is built from all tests, so it reflects the full ground shape.

.. CG-EXPLANATION-END id=method:ModelDomain.top_at

Method ``ModelDomain``. ``def deep_base_at``
--------------------------------------------

.. CG-BLOCK id=method:ModelDomain.deep_base_at lines=490-517

.. literalinclude:: ../../../src/groundmodel/domain/services/model_domain.py
   :language: python
   :lines: 490-517
   :lineno-match:

.. CG-EXPLANATION-START id=method:ModelDomain.deep_base_at

**What this does.** Returns the model's base elevation at a map point by interpolating the base TIN, falling back to the nearest base vertex when the point lies outside the triangulated area.

**Why it is here.** The base TIN is built from deep-reaching tests only, so shallow tests never pull the base up locally, per the design. The nearest-vertex fallback guarantees a finite base at every node just as the top surface does.

.. CG-EXPLANATION-END id=method:ModelDomain.deep_base_at

Function ``def build_model_domain``
-----------------------------------

.. CG-BLOCK id=function:build_model_domain lines=518-632

.. literalinclude:: ../../../src/groundmodel/domain/services/model_domain.py
   :language: python
   :lines: 518-632
   :lineno-match:

.. CG-EXPLANATION-START id=function:build_model_domain

**What this does.** Builds a model domain from a list of tests. It computes the footprint over all test positions, builds the top TIN through every test's surface, selects the deep-reaching tests and builds the base TIN through their bases, then records which tests the footprint failed to cover. It refuses fewer than three tests, collinear tests, or a case where no test reaches the lowest band.

**Why it is here.** This is the one factory for the value class. The docstring justifies each refusal: fewer than three or collinear points cannot be triangulated, and an empty deep set means the lowest band sits deeper than every test reaches, so silently building the base from shallow data would mask the mismatch. The coverage check uses a millimetre tolerance because every hull vertex is itself a test sitting exactly on the ring, and strict parity would falsely report about half of them as outside; the tolerance keeps the check about genuine exclusion of hundreds of metres, not boundary noise.

.. CG-EXPLANATION-END id=function:build_model_domain

