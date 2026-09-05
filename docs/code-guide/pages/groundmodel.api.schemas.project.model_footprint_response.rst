groundmodel.api.schemas.project.model_footprint_response
========================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/model_footprint_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/model_footprint_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-10

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/model_footprint_response.py
   :language: python
   :lines: 1-10
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports datetime, UUID, and the Pydantic base class.

**Why it is here.** Standard imports for a response schema (the reply shape of an endpoint).

.. CG-EXPLANATION-END id=module-header

Class ``ModelFootprintResponse``
--------------------------------

.. CG-BLOCK id=class:ModelFootprintResponse lines=11-46

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/model_footprint_response.py
   :language: python
   :lines: 11-46
   :lineno-match:

.. CG-EXPLANATION-START id=class:ModelFootprintResponse

**What this does.** The reply for a model's footprint: the closed ring of x/y vertices the last 3-D build clipped to, the build-generation id it came from, that build's timestamp, and a plain-English reason when no ring is available.

**Why it is here.** The docstring records a single-source-of-truth decision: the ring is re-derived from the stored build-generation row on the server, never recomputed on the desktop, because a client-side re-derivation would be a second source of truth that could draw an edge not matching the actual build geometry. The ring is returned without a repeated closing vertex because that is exactly what the hull function produces; the caller closes it when drawing.

.. CG-EXPLANATION-END id=class:ModelFootprintResponse

