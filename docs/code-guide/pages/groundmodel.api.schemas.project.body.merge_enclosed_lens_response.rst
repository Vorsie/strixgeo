groundmodel.api.schemas.project.body.merge_enclosed_lens_response
=================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/body/merge_enclosed_lens_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/body/merge_enclosed_lens_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-7

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/body/merge_enclosed_lens_response.py
   :language: python
   :lines: 1-7
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring and the single Pydantic import.

**Why it is here.** A *response schema* is the shape the API returns to the desktop, kept separate from the database row so internal storage can change without breaking the web contract; new fields are additive (default to optional/null) per the API contract in ``docs/api.md``.

.. CG-EXPLANATION-END id=module-header

Class ``MergeEnclosedLensResponse``
-----------------------------------

.. CG-BLOCK id=class:MergeEnclosedLensResponse lines=8-25

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/body/merge_enclosed_lens_response.py
   :language: python
   :lines: 8-25
   :lineno-match:

.. CG-EXPLANATION-START id=class:MergeEnclosedLensResponse

**What this does.** Two counts: correlation edges created and edges skipped because they already existed.

**Why it is here.** The docstring ties this to the Fill-bands sand-merge (owner directive 2026-06-05): a lithology split on one column by a local lens is fused into one body by correlating its bracketing halves to the neighbour's continuous host. The skipped count makes a re-run idempotent (repeating it changes nothing). A *response schema* is the shape the API returns to the desktop, kept separate from the database row so internal storage can change without breaking the web contract; new fields are additive (default to optional/null) per the API contract in ``docs/api.md``.

.. CG-EXPLANATION-END id=class:MergeEnclosedLensResponse

