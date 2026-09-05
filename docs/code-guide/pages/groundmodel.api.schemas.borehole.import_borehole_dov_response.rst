groundmodel.api.schemas.borehole.import_borehole_dov_response
=============================================================

.. CG-PAGE source=src/groundmodel/api/schemas/borehole/import_borehole_dov_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/borehole/import_borehole_dov_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-7

.. literalinclude:: ../../../src/groundmodel/api/schemas/borehole/import_borehole_dov_response.py
   :language: python
   :lines: 1-7
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A one-line docstring and imports of ``UUID`` and ``BaseModel``.

**Why it is here.** The response-schema pattern; a plain summary shape, no row-reading needed.

.. CG-EXPLANATION-END id=module-header

Class ``ImportBoreholeDovResponse``
-----------------------------------

.. CG-BLOCK id=class:ImportBoreholeDovResponse lines=8-41

.. literalinclude:: ../../../src/groundmodel/api/schemas/borehole/import_borehole_dov_response.py
   :language: python
   :lines: 8-41
   :lineno-match:

.. CG-EXPLANATION-START id=class:ImportBoreholeDovResponse

**What this does.** The summary of a completed DOV borehole import: imported / duplicate / failed counts, then many attached-versus-failed pairs for interpretations, samples, and each lab family, plus the list of imported ids. Most count fields carry a default of 0.

**Why it is here.** It mirrors the CPT import response but renames the id list to ``borehole_ids`` so the desktop routes ids to the right detail endpoint without inspecting the request type. The defaults of 0 make the many later count fields *additive*: an older caller that ignores them, or one building the response by hand, keeps working (the additive-only API rule in ``docs/api.md``). The docstring records that ``interpretations_wfs_gaps`` counts rows DOV advertised but did not deliver, so the panel does not misread them as "DOV holds nothing here" (audit 2026-08-02).

.. CG-EXPLANATION-END id=class:ImportBoreholeDovResponse

