groundmodel.api.schemas.borehole.admixture_response
===================================================

.. CG-PAGE source=src/groundmodel/api/schemas/borehole/admixture_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/borehole/admixture_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-5

.. literalinclude:: ../../../src/groundmodel/api/schemas/borehole/admixture_response.py
   :language: python
   :lines: 1-5
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A one-line docstring and imports of ``BaseModel`` and ``ConfigDict``.

**Why it is here.** This is a *response* schema — a shape the API builds and sends to the desktop, as opposed to a request it validates. Response schemas use plain ``BaseModel`` and do not inherit the strict request base, because strictness only guards data coming in from a client.

.. CG-EXPLANATION-END id=module-header

Class ``AdmixtureResponse``
---------------------------

.. CG-BLOCK id=class:AdmixtureResponse lines=6-19

.. literalinclude:: ../../../src/groundmodel/api/schemas/borehole/admixture_response.py
   :language: python
   :lines: 6-19
   :lineno-match:

.. CG-EXPLANATION-START id=class:AdmixtureResponse

**What this does.** A three-field response for one admixture (a secondary soil component) inside an observation layer: the ``soil_code``, the ``amount``, and a ``locally`` flag. It sets ``model_config = ConfigDict(from_attributes=True)``.

**Why it is here.** ``from_attributes=True`` lets Pydantic build this response by reading the fields straight off a loaded database row, so the endpoint does not copy field by field. Each field is *typed* (a text string, a true/false flag) so the outgoing JSON — the plain text format the desktop receives — has a guaranteed shape. Crucially the docstring records that DOV's own vocabulary tokens are passed through verbatim: translation to English is a display concern the desktop handles, so the domain and the API keep the raw source token (Data Integrity Rule 2; the DOV codelists memory). This response-schema pattern — typed fields, ``from_attributes`` off the row, raw tokens kept — recurs on every borehole and CPT response below.

.. CG-EXPLANATION-END id=class:AdmixtureResponse

