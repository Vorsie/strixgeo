groundmodel.api.schemas.borehole.sample_response
================================================

.. CG-PAGE source=src/groundmodel/api/schemas/borehole/sample_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/borehole/sample_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-21

.. literalinclude:: ../../../src/groundmodel/api/schemas/borehole/sample_response.py
   :language: python
   :lines: 1-21
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A one-line docstring and imports of ``date``, ``UUID``, ``BaseModel``, ``ConfigDict``, and the five lab-test response schemas.

**Why it is here.** The response-schema pattern; it composes all the lab families a sample can carry.

.. CG-EXPLANATION-END id=module-header

Class ``SampleResponse``
------------------------

.. CG-BLOCK id=class:SampleResponse lines=22-63

.. literalinclude:: ../../../src/groundmodel/api/schemas/borehole/sample_response.py
   :language: python
   :lines: 22-63
   :lineno-match:

.. CG-EXPLANATION-START id=class:SampleResponse

**What this does.** One material sample from a borehole: its depth interval, source-vocabulary metadata (type, composition, instrument), sampling date, three geotech-provenance fields defaulting to empty, and the six lab-test lists. Reads off the row.

**Why it is here.** The docstring records that the metadata tokens pass through verbatim (translation at display), that the geotech fields default to empty so existing saved bundles still deserialise (additive-only rule), and — a subtle point — that ``from_attributes`` reads the ORM relationship names directly, so the JSON keys are the ORM's plural ``_tests`` names rather than the domain suffixes.

.. CG-EXPLANATION-END id=class:SampleResponse

