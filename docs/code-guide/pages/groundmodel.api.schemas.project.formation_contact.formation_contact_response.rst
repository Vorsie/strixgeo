groundmodel.api.schemas.project.formation_contact.formation_contact_response
============================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/formation_contact/formation_contact_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/formation_contact/formation_contact_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-10

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_contact/formation_contact_response.py
   :language: python
   :lines: 1-10
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring and imports (``datetime``, ``UUID``, Pydantic ``BaseModel`` and ``ConfigDict``).

**Why it is here.** A *response schema* is the shape the API returns to the desktop, kept separate from the database row so internal storage can change without breaking the web contract; new fields are additive (default to optional/null) per the API contract in ``docs/api.md``.

.. CG-EXPLANATION-END id=module-header

Class ``FormationContactResponse``
----------------------------------

.. CG-BLOCK id=class:FormationContactResponse lines=11-38

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_contact/formation_contact_response.py
   :language: python
   :lines: 11-38
   :lineno-match:

.. CG-EXPLANATION-START id=class:FormationContactResponse

**What this does.** The contact returned to the desktop: id, model, formation, the borehole/CPT anchor, the synthetic pinch-out coordinates (set only on synthetic contacts), the top depth, source and confidence, observation links, the litho↔geo coupling link, notes, and timestamps. Reads off the row via ``from_attributes``.

**Why it is here.** The comments record the synthetic fields carry a pinch-out tip's absolute position (there the depth is a sentinel), and the coupling link points a litho contact at the geological contact it is the same physical surface as (debt #162), null when not coupled. A *response schema* is the shape the API returns to the desktop, kept separate from the database row so internal storage can change without breaking the web contract; new fields are additive (default to optional/null) per the API contract in ``docs/api.md``.

.. CG-EXPLANATION-END id=class:FormationContactResponse

