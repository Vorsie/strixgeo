groundmodel.api.schemas.project.formation_contact.formation_surface_response
============================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/formation_contact/formation_surface_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/formation_contact/formation_surface_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-10

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_contact/formation_surface_response.py
   :language: python
   :lines: 1-10
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring and imports (``datetime``, ``UUID``, Pydantic ``BaseModel`` and ``ConfigDict``).

**Why it is here.** A *response schema* is the shape the API returns to the desktop, kept separate from the database row so internal storage can change without breaking the web contract; new fields are additive (default to optional/null) per the API contract in ``docs/api.md``.

.. CG-EXPLANATION-END id=module-header

Class ``FormationSurfaceResponse``
----------------------------------

.. CG-BLOCK id=class:FormationSurfaceResponse lines=11-40

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_contact/formation_surface_response.py
   :language: python
   :lines: 11-40
   :lineno-match:

.. CG-EXPLANATION-START id=class:FormationSurfaceResponse

**What this does.** A cached surface (a triangulated mesh) per formation: id, model, formation, the method, the vertex and triangle lists, the source-contact count, an ``is_stale`` flag, and timestamps. Reads off the row via ``from_attributes``.

**Why it is here.** The docstring records that the section consumer fetches these to draw slice-of-surface polylines instead of connect-the-dots, that the bundle carries them so a re-open skips the recompute, and that ``is_stale`` drives the on-click-build pivot — a stale surface renders faded and dashed until the engineer clicks Build. The vertices are typed as plain lists because JSON serialises tuples as arrays anyway. A *response schema* is the shape the API returns to the desktop, kept separate from the database row so internal storage can change without breaking the web contract; new fields are additive (default to optional/null) per the API contract in ``docs/api.md``.

.. CG-EXPLANATION-END id=class:FormationSurfaceResponse

