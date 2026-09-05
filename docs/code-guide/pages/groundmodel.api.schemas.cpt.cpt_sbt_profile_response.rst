groundmodel.api.schemas.cpt.cpt_sbt_profile_response
====================================================

.. CG-PAGE source=src/groundmodel/api/schemas/cpt/cpt_sbt_profile_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/cpt/cpt_sbt_profile_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-8

.. literalinclude:: ../../../src/groundmodel/api/schemas/cpt/cpt_sbt_profile_response.py
   :language: python
   :lines: 1-8
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A one-line docstring and imports of ``Literal``, ``UUID``, and ``BaseModel``.

**Why it is here.** The response-schema pattern; the two soil-behaviour-type strips plus the water-table provenance.

.. CG-EXPLANATION-END id=module-header

Class ``CptSbtProfileResponse``
-------------------------------

.. CG-BLOCK id=class:CptSbtProfileResponse lines=9-59

.. literalinclude:: ../../../src/groundmodel/api/schemas/cpt/cpt_sbt_profile_response.py
   :language: python
   :lines: 9-59
   :lineno-match:

.. CG-EXPLANATION-START id=class:CptSbtProfileResponse

**What this does.** For one CPT: the depths, the normalised Ic curve and its Robertson zone, the non-normalised index and its zone, and the water depth with its provenance (pinned to "recorded", "engineer", or "assumed"). Empties mark depths that could not be classified.

**Why it is here.** The arrays are parallel and share the plot response's depth axis so both draw on one axis without re-indexing. The docstring records that nothing is stored — the profile is derived on read — which is exactly why the water table and its source ride along: a surface showing a derived strip must be able to say what it was derived under (Data Integrity Rule 1). An empty entry is an honest "cannot classify", never a filled-in guess. This classification is a characterisation output, within MVP scope; design-ready parameters stay Phase 5. Methods cited in the field docs: Robertson (2009/2010/2015) and the extended organic/peat outcome (Lengkeek & Brinkgreve 2022).

.. CG-EXPLANATION-END id=class:CptSbtProfileResponse

