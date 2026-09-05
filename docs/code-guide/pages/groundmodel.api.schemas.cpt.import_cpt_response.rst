groundmodel.api.schemas.cpt.import_cpt_response
===============================================

.. CG-PAGE source=src/groundmodel/api/schemas/cpt/import_cpt_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/cpt/import_cpt_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-9

.. literalinclude:: ../../../src/groundmodel/api/schemas/cpt/import_cpt_response.py
   :language: python
   :lines: 1-9
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A one-line docstring and imports of ``UUID``, ``BaseModel``, and the validation-issue schema.

**Why it is here.** The response-schema pattern; it composes the list of parse findings.

.. CG-EXPLANATION-END id=module-header

Class ``ImportCptResponse``
---------------------------

.. CG-BLOCK id=class:ImportCptResponse lines=10-40

.. literalinclude:: ../../../src/groundmodel/api/schemas/cpt/import_cpt_response.py
   :language: python
   :lines: 10-40
   :lineno-match:

.. CG-EXPLANATION-START id=class:ImportCptResponse

**What this does.** The reply to a file import: the CPT id, an error flag, the list of validation findings, a ``refreshed`` flag, and the display name. The last two default to empty.

**Why it is here.** The docstring records that the CPT is stored even when the error flag is set (the caller decides whether to surface it) and that ``refreshed`` is true when an existing row was updated in place rather than a new one created — the consented-refresh contract, where the endpoint answers ``200`` for a refresh and ``201`` for a new CPT (``docs/api.md``). The two new fields default to empty so an older client and any hand-built caller keep working (additive-only).

.. CG-EXPLANATION-END id=class:ImportCptResponse

