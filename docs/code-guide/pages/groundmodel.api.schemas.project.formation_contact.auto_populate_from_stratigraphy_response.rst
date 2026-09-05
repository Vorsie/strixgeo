groundmodel.api.schemas.project.formation_contact.auto_populate_from_stratigraphy_response
==========================================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/formation_contact/auto_populate_from_stratigraphy_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/formation_contact/auto_populate_from_stratigraphy_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-14

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_contact/auto_populate_from_stratigraphy_response.py
   :language: python
   :lines: 1-14
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring, imports, the cross-section response schema, the mode enum, and the lumping-collision item.

**Why it is here.** It imports the cross-section response because it can echo an updated section row (below).

.. CG-EXPLANATION-END id=module-header

Class ``AutoPopulateFromStratigraphyResponse``
----------------------------------------------

.. CG-BLOCK id=class:AutoPopulateFromStratigraphyResponse lines=15-72

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_contact/auto_populate_from_stratigraphy_response.py
   :language: python
   :lines: 15-72
   :lineno-match:

.. CG-EXPLANATION-START id=class:AutoPopulateFromStratigraphyResponse

**What this does.** The result: lists of created contact and formation ids, deleted-formation ids and names, the echoed mode, several skip counts (already-seeded, unmatched, no-stratigraphy, not-in-model), any lumping collisions, and the optional updated section row.

**Why it is here.** The long docstring records what each count means and why the deletions carry NAMES not just ids (the toast must say which units were removed); deletions are populated only in overwrite mode; the collisions mirror the discover preview so there are no surprises on confirm; and the echoed mode lets the client assert the run it asked for is the run it got. A *response schema* is the shape the API returns to the desktop, kept separate from the database row so internal storage can change without breaking the web contract; new fields are additive (default to optional/null) per the API contract in ``docs/api.md``.

.. CG-EXPLANATION-END id=class:AutoPopulateFromStratigraphyResponse

