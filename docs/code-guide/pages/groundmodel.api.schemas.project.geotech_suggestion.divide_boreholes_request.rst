groundmodel.api.schemas.project.geotech_suggestion.divide_boreholes_request
===========================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/geotech_suggestion/divide_boreholes_request.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/geotech_suggestion/divide_boreholes_request.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-14

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geotech_suggestion/divide_boreholes_request.py
   :language: python
   :lines: 1-14
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the schema and imports ``UUID``, ``Field``, a section-partition input schema, and the strict base.

**Why it is here.** A request schema on the strict base; it reuses the same partition shape the 3-D build receives (imported rather than re-declared).

.. CG-EXPLANATION-END id=module-header

Class ``DivideBoreholesRequest``
--------------------------------

.. CG-BLOCK id=class:DivideBoreholesRequest lines=15-91

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geotech_suggestion/divide_boreholes_request.py
   :language: python
   :lines: 15-91
   :lineno-match:

.. CG-EXPLANATION-START id=class:DivideBoreholesRequest

**What this does.** The optional body of the divide-boreholes endpoint: which boreholes to divide (all by default), whether to skip the accept-your-ties-first gate, whether to skip boreholes that already carry bands, an optional single-section scope, and the 2-D section partitions keyed by section id.

**Why it is here.** Every field defaults to the endpoint's historic behaviour, so a caller sending no body gets the pre-pipeline result. The docstring records the reasoning (dated owner rulings): the ties gate exists because accepted ties steer where each borehole's packing comes from; skip-existing means the first subdivision wins so a tie section never tells a second story; and when a section partition covers a borehole it OUTRANKS the donor rule, because the geometry between two CPTs already says what lies in the gap.

.. CG-EXPLANATION-END id=class:DivideBoreholesRequest

