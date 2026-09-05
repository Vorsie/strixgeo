groundmodel.api.schemas.cpt.cpt_response
========================================

.. CG-PAGE source=src/groundmodel/api/schemas/cpt/cpt_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/cpt/cpt_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-7

.. literalinclude:: ../../../src/groundmodel/api/schemas/cpt/cpt_response.py
   :language: python
   :lines: 1-7
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A one-line docstring and imports of ``UUID`` and ``BaseModel``.

**Why it is here.** The response-schema pattern; the full CPT header.

.. CG-EXPLANATION-END id=module-header

Class ``CptResponse``
---------------------

.. CG-BLOCK id=class:CptResponse lines=8-72

.. literalinclude:: ../../../src/groundmodel/api/schemas/cpt/cpt_response.py
   :language: python
   :lines: 8-72
   :lineno-match:

.. CG-EXPLANATION-START id=class:CptResponse

**What this does.** The full CPT header returned for one record: id, name, cone type, location and coordinate system, elevation with its vertical system and source, pre-drill depth, cone area ratio, water depth with its source, max depth, and row count. The two water-depth fields default to empty.

**Why it is here.** It is the API-boundary mirror of the stored header, kept separate from the row so storage can change without breaking the contract. The docstring records that the elevation source drives a provenance badge (debt #8) and that the water table is empty for every DOV CPT, whose consumers fall back to the project-wide assumption. The comment on the water fields makes the additive-only rule explicit: they default to empty so any caller that builds a response without them keeps working (``docs/api.md``).

.. CG-EXPLANATION-END id=class:CptResponse

