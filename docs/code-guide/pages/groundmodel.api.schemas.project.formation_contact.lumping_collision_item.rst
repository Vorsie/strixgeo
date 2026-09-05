groundmodel.api.schemas.project.formation_contact.lumping_collision_item
========================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/formation_contact/lumping_collision_item.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/formation_contact/lumping_collision_item.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-9

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_contact/lumping_collision_item.py
   :language: python
   :lines: 1-9
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring and imports (``UUID``, Pydantic ``BaseModel``).

**Why it is here.** A *response schema* is the shape the API returns to the desktop, kept separate from the database row so internal storage can change without breaking the web contract; new fields are additive (default to optional/null) per the API contract in ``docs/api.md``.

.. CG-EXPLANATION-END id=module-header

Class ``LumpingCollisionItem``
------------------------------

.. CG-BLOCK id=class:LumpingCollisionItem lines=10-41

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_contact/lumping_collision_item.py
   :language: python
   :lines: 10-41
   :lineno-match:

.. CG-EXPLANATION-START id=class:LumpingCollisionItem

**What this does.** One lumping collision: the borehole, the target key and name it collided on, the raw names that mapped to it, the kept top depth, and how many deeper duplicates were dropped.

**Why it is here.** The docstring records this is the API projection of an application-layer collision, shown as an amber warning so the engineer understands which layers were merged and which contact was kept before committing. A *response schema* is the shape the API returns to the desktop, kept separate from the database row so internal storage can change without breaking the web contract; new fields are additive (default to optional/null) per the API contract in ``docs/api.md``.

.. CG-EXPLANATION-END id=class:LumpingCollisionItem

