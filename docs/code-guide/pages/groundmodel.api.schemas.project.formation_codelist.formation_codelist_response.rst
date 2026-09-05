groundmodel.api.schemas.project.formation_codelist.formation_codelist_response
==============================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/formation_codelist/formation_codelist_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/formation_codelist/formation_codelist_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-9

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_codelist/formation_codelist_response.py
   :language: python
   :lines: 1-9
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring and imports (Pydantic ``BaseModel`` and the NAD-class option schema).

**Why it is here.** A *response schema* is the shape the API returns to the desktop, kept separate from the database row so internal storage can change without breaking the web contract; new fields are additive (default to optional/null) per the API contract in ``docs/api.md``.

.. CG-EXPLANATION-END id=module-header

Class ``FormationCodelistResponse``
-----------------------------------

.. CG-BLOCK id=class:FormationCodelistResponse lines=10-34

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_codelist/formation_codelist_response.py
   :language: python
   :lines: 10-34
   :lineno-match:

.. CG-EXPLANATION-START id=class:FormationCodelistResponse

**What this does.** A kind-aware suggestion set for the formation-name autocomplete: the requested kind, a list of lithology tokens, a token→English-label map, a list of admixtures, and a list of NAD classes — which of these are filled depends on the kind.

**Why it is here.** The docstring records that the backend stays permissive (the create endpoint accepts any name) and this only drives the editor's suggestions. The label map lets the editor show "ZAND (Sand)" without its own lookup table, holding translate-at-the-presentation-boundary while the domain still stores the raw token. NAD classes here are the Belgian packing classes (NBN EN 1997-1 ANB Tabel 2.1). A *response schema* is the shape the API returns to the desktop, kept separate from the database row so internal storage can change without breaking the web contract; new fields are additive (default to optional/null) per the API contract in ``docs/api.md``.

.. CG-EXPLANATION-END id=class:FormationCodelistResponse

