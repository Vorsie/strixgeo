groundmodel.domain.value_objects.contact_point_3d
=================================================

.. CG-PAGE source=src/groundmodel/domain/value_objects/contact_point_3d.py complete=true

*Source file:* ``src/groundmodel/domain/value_objects/contact_point_3d.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-7

.. literalinclude:: ../../../src/groundmodel/domain/value_objects/contact_point_3d.py
   :language: python
   :lines: 1-7
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line, ``from __future__ import annotations``, and the ``dataclass`` import.

**Why it is here.** A one-class value object needs nothing more.

.. CG-EXPLANATION-END id=module-header

Class ``ContactPoint3D``
------------------------

.. CG-BLOCK id=class:ContactPoint3D lines=8-21

.. literalinclude:: ../../../src/groundmodel/domain/value_objects/contact_point_3d.py
   :language: python
   :lines: 8-21
   :lineno-match:

.. CG-EXPLANATION-START id=class:ContactPoint3D

**What this does.** Defines ``ContactPoint3D``: one source point for building a surface — a contact's ``contact_id`` plus its position as ``x_m``, ``y_m`` and ``elevation_m``.

**Why it is here.** These points are the input to the surface triangulation (the TIN — see ``tin_surface``). The ``contact_id`` is carried along as opaque label so the cache-validity checksum can include it: swapping one contact for another at the very same x/y/z would triangulate identically, but the interpretation downstream differs, and including the id lets the cache notice that change.

.. CG-EXPLANATION-END id=class:ContactPoint3D

