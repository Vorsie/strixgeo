groundmodel.shared.constants.model_kind
=======================================

.. CG-PAGE source=src/groundmodel/shared/constants/model_kind.py complete=true

*Source file:* ``src/groundmodel/shared/constants/model_kind.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-50

.. literalinclude:: ../../../src/groundmodel/shared/constants/model_kind.py
   :language: python
   :lines: 1-50
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Declares the ``GeologicalModel.kind`` *discriminator* (the field that says which kind a model row is) — the three allowed kinds ``geological``, ``lithostratigraphic`` and ``geotechnical`` — plus two rules over them: ``REQUIRED_PARENT_KIND`` (which kind each model must be built on top of: geological has none, litho needs a geological parent, geotech needs a litho parent) and ``NON_STRATIGRAPHIC_KINDS`` (the kinds whose surfaces may cross each other without it being an error).

**Why it is here.** The docstring records the three-level modelling hierarchy (CLAUDE.md; ``project_litho_geotech_three_level_model``): the three levels are sibling rows told apart by ``kind``, not three separate schemas, so the whole contact → build → TIN → section → export → bundle pipeline is reused at every level. The parent-kind rule is the creation invariant the endpoint enforces; interfingering sand and clay is real geology, so the crossing validator skips the non-stratigraphic kinds. It lives in ``shared`` so the API layer can use it without importing the domain layer (debt #54).

.. CG-EXPLANATION-END id=module-header

