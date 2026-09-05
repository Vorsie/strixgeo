groundmodel.api.schemas.project.geotech_suggestion.subdivide_all_bodies_request
===============================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/geotech_suggestion/subdivide_all_bodies_request.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/geotech_suggestion/subdivide_all_bodies_request.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-11

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geotech_suggestion/subdivide_all_bodies_request.py
   :language: python
   :lines: 1-11
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the schema and imports ``UUID``, ``Field``, and the strict base.

**Why it is here.** A request schema on the strict base.

.. CG-EXPLANATION-END id=module-header

Class ``SubdivideAllBodiesRequest``
-----------------------------------

.. CG-BLOCK id=class:SubdivideAllBodiesRequest lines=12-61

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geotech_suggestion/subdivide_all_bodies_request.py
   :language: python
   :lines: 12-61
   :lineno-match:

.. CG-EXPLANATION-START id=class:SubdivideAllBodiesRequest

**What this does.** The body of the subdivide-all-bodies and subdivide-cpts endpoints: the parent litho model, an optional single-section scope, a skip-existing flag, and the representative-cone-resistance statistic to create the model under.

**Why it is here.** The docstring records that which investigations take part is decided by section membership, and (dated owner rulings) that the statistic is honoured ONLY when this call creates the geotech model — on a re-run the model's own choice stands and the dedicated statistic endpoint is the one way to change it — because choosing the statistic before the model exists would be needless friction.

.. CG-EXPLANATION-END id=class:SubdivideAllBodiesRequest

