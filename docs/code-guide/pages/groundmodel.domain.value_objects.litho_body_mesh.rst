groundmodel.domain.value_objects.litho_body_mesh
================================================

.. CG-PAGE source=src/groundmodel/domain/value_objects/litho_body_mesh.py complete=true

*Source file:* ``src/groundmodel/domain/value_objects/litho_body_mesh.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-7

.. literalinclude:: ../../../src/groundmodel/domain/value_objects/litho_body_mesh.py
   :language: python
   :lines: 1-7
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line, ``from __future__ import annotations``, and the ``dataclass`` import.

**Why it is here.** A one-class value object for a 3-D mesh needs nothing more.

.. CG-EXPLANATION-END id=module-header

Class ``LithoBodyMesh``
-----------------------

.. CG-BLOCK id=class:LithoBodyMesh lines=8-34

.. literalinclude:: ../../../src/groundmodel/domain/value_objects/litho_body_mesh.py
   :language: python
   :lines: 8-34
   :lineno-match:

.. CG-EXPLANATION-START id=class:LithoBodyMesh

**What this does.** Defines ``LithoBodyMesh``, a frozen value object holding one lithological body's closed 3-D triangle mesh: the ``body_id`` and ``formation_id`` it represents (the formation drives its colour), a list of ``vertices`` as ``(x, y, elevation)`` triples, a list of ``triangles`` as vertex-index triples, and an ``is_flagged`` boolean.

**Why it is here.** This is the 3-D shape one body contributes to the model, in real project coordinates and vertical datum. ``is_flagged`` is set ``True`` when a body had too little lateral spread to triangulate into a real solid (fewer than three non-collinear control points); rather than draw nothing, it is rendered as small vertical cylinders at its investigations and marked as under-constrained in the UI, so the mesh is never empty.

.. CG-EXPLANATION-END id=class:LithoBodyMesh

