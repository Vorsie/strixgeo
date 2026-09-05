groundmodel.api.schemas.project.litho_body_solid_response
=========================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/litho_body_solid_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/litho_body_solid_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-10

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_body_solid_response.py
   :language: python
   :lines: 1-10
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the schema and imports ``datetime``, ``UUID``, and the Pydantic tools.

**Why it is here.** A response schema for the cached 3-D solid; same pattern.

.. CG-EXPLANATION-END id=module-header

Class ``LithoBodySolidResponse``
--------------------------------

.. CG-BLOCK id=class:LithoBodySolidResponse lines=11-85

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_body_solid_response.py
   :language: python
   :lines: 11-85
   :lineno-match:

.. CG-EXPLANATION-START id=class:LithoBodySolidResponse

**What this does.** The web shape of one cached watertight 3-D solid per (model, body): its ids, the body's ordinal within its naming group, the triangulation method, the vertex positions and triangle indices of the mesh, stale and flagged flags, an optional display colour, and timestamps. ``from_attributes`` is enabled.

**Why it is here.** The docstring records that the display colour comes from the body row, not the solid row, and is joined in by the endpoint and passed explicitly so there is NO lazy database load during serialisation — a lazy load fired inside the framework's attribute reader would fail in the async context (the project's eager-load rule). ``from_attributes`` is kept enabled for a future caller even though the hot path builds instances by hand. The vertices and triangles are empty for a flagged best-effort slab; the viewer dims stale solids.

.. CG-EXPLANATION-END id=class:LithoBodySolidResponse

