groundmodel.api.schemas.project.geotech_suggestion.subdivide_all_bodies_response
================================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/geotech_suggestion/subdivide_all_bodies_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/geotech_suggestion/subdivide_all_bodies_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-9

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geotech_suggestion/subdivide_all_bodies_response.py
   :language: python
   :lines: 1-9
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the schema and imports ``UUID`` and the Pydantic tools.

**Why it is here.** A response schema; same pattern.

.. CG-EXPLANATION-END id=module-header

Class ``SubdivideAllBodiesResponse``
------------------------------------

.. CG-BLOCK id=class:SubdivideAllBodiesResponse lines=10-188

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geotech_suggestion/subdivide_all_bodies_response.py
   :language: python
   :lines: 10-188
   :lineno-match:

.. CG-EXPLANATION-START id=class:SubdivideAllBodiesResponse

**What this does.** The result of the main subdivision: the model used, formations created, rows inserted, body counts (total, multi-band split, single-class, borehole-only), sections processed, and the full set of tie-carry counters (re-anchored, flagged, lost, with human-readable labels), plus whether ties were proposed and how many.

**Why it is here.** The docstring explains the body-count split as a characterisation outcome: consistent CPT profiles give a multi-band split, inconsistent ones a single representative class, and borehole-only groups a skeleton with no class until divide-boreholes runs. As on the divide response, lost ties carry a naming label because a count alone leaves the engineer nowhere to redraw. The ``borehole_endpoint_deferred`` reason can only appear here, since divide-boreholes is the step that later materialises those bands. NAD packing class follows NBN EN 1997-1 ANB Tabel 2.1; design-ready parameters stay Phase 5.

.. CG-EXPLANATION-END id=class:SubdivideAllBodiesResponse

