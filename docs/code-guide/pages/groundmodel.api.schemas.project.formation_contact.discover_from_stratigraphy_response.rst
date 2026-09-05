groundmodel.api.schemas.project.formation_contact.discover_from_stratigraphy_response
=====================================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/formation_contact/discover_from_stratigraphy_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/formation_contact/discover_from_stratigraphy_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-10

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_contact/discover_from_stratigraphy_response.py
   :language: python
   :lines: 1-10
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring and imports (the candidate item and collision item schemas).

**Why it is here.** A *response schema* is the shape the API returns to the desktop, kept separate from the database row so internal storage can change without breaking the web contract; new fields are additive (default to optional/null) per the API contract in ``docs/api.md``.

.. CG-EXPLANATION-END id=module-header

Class ``DiscoverFromStratigraphyResponse``
------------------------------------------

.. CG-BLOCK id=class:DiscoverFromStratigraphyResponse lines=11-26

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_contact/discover_from_stratigraphy_response.py
   :language: python
   :lines: 11-26
   :lineno-match:

.. CG-EXPLANATION-START id=class:DiscoverFromStratigraphyResponse

**What this does.** The candidate formation list plus any lumping collisions.

**Why it is here.** The docstring records the candidates are sorted by borehole count then name, and the collisions mirror what the write path will return so the dialog can warn before the user confirms. A *response schema* is the shape the API returns to the desktop, kept separate from the database row so internal storage can change without breaking the web contract; new fields are additive (default to optional/null) per the API contract in ``docs/api.md``.

.. CG-EXPLANATION-END id=class:DiscoverFromStratigraphyResponse

