groundmodel.domain.value_objects.tin_surface
============================================

.. CG-PAGE source=src/groundmodel/domain/value_objects/tin_surface.py complete=true

*Source file:* ``src/groundmodel/domain/value_objects/tin_surface.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-7

.. literalinclude:: ../../../src/groundmodel/domain/value_objects/tin_surface.py
   :language: python
   :lines: 1-7
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line, ``from __future__ import annotations``, and the ``dataclass`` import.

**Why it is here.** A one-class value object for a mesh needs nothing more.

.. CG-EXPLANATION-END id=module-header

Class ``TinSurface``
--------------------

.. CG-BLOCK id=class:TinSurface lines=8-23

.. literalinclude:: ../../../src/groundmodel/domain/value_objects/tin_surface.py
   :language: python
   :lines: 8-23
   :lineno-match:

.. CG-EXPLANATION-START id=class:TinSurface

**What this does.** Defines ``TinSurface``, a frozen value object holding an interpolated surface as a mesh: a list of ``vertices`` as ``(x, y, elevation)`` triples and a list of ``triangles`` as vertex-index triples.

**Why it is here.** A *TIN* (triangulated irregular network) is the standard way to represent a bumpy surface from scattered survey points: connect the points into non-overlapping triangles and the surface is the set of flat triangular facets between them. The docstring pins the empty-input contract: fewer than three valid points yields the points as vertices but no triangles, and a slice against such a surface simply returns nothing — a graceful, defined result rather than a crash.

.. CG-EXPLANATION-END id=class:TinSurface

