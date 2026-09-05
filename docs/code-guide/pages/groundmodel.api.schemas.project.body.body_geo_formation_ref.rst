groundmodel.api.schemas.project.body.body_geo_formation_ref
===========================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/body/body_geo_formation_ref.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/body/body_geo_formation_ref.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-9

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/body/body_geo_formation_ref.py
   :language: python
   :lines: 1-9
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The one-line docstring and the imports (``UUID`` and Pydantic's ``BaseModel``).

**Why it is here.** ``BaseModel`` is Pydantic's base for any schema; a *UUID* is the long unique id used as a database key throughout the project.

.. CG-EXPLANATION-END id=module-header

Class ``BodyGeoFormationRef``
-----------------------------

.. CG-BLOCK id=class:BodyGeoFormationRef lines=10-27

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/body/body_geo_formation_ref.py
   :language: python
   :lines: 10-27
   :lineno-match:

.. CG-EXPLANATION-START id=class:BodyGeoFormationRef

**What this does.** A minimal reference to one geological formation a body crosses: its id and its display name.

**Why it is here.** The docstring records why this is a list elsewhere, not a single stamp (debt #278): a body may span geological-formation boundaries, so its geological attribution is the list of every formation it crosses, shallowest first. The id resolves the formation; the name is what the desktop and exports show.

.. CG-EXPLANATION-END id=class:BodyGeoFormationRef

