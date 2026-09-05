groundmodel.api.schemas.project.formation_contact.rebuild_surfaces_response
===========================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/formation_contact/rebuild_surfaces_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/formation_contact/rebuild_surfaces_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-7

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_contact/rebuild_surfaces_response.py
   :language: python
   :lines: 1-7
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring and the single Pydantic import.

**Why it is here.** A *response schema* is the shape the API returns to the desktop, kept separate from the database row so internal storage can change without breaking the web contract; new fields are additive (default to optional/null) per the API contract in ``docs/api.md``.

.. CG-EXPLANATION-END id=module-header

Class ``RebuildSurfacesResponse``
---------------------------------

.. CG-BLOCK id=class:RebuildSurfacesResponse lines=8-25

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_contact/rebuild_surfaces_response.py
   :language: python
   :lines: 8-25
   :lineno-match:

.. CG-EXPLANATION-START id=class:RebuildSurfacesResponse

**What this does.** Three counts from a surface rebuild: formations considered, formations actually rebuilt, and formations whose display order the auto-age sort updated.

**Why it is here.** The docstring records that "considered" is every formation with a contact, "rebuilt" is the subset whose recomputed checksum changed (so the cache write fired), and the reorder count is defaulted so an older client still parses the response. A *response schema* is the shape the API returns to the desktop, kept separate from the database row so internal storage can change without breaking the web contract; new fields are additive (default to optional/null) per the API contract in ``docs/api.md``.

.. CG-EXPLANATION-END id=class:RebuildSurfacesResponse

