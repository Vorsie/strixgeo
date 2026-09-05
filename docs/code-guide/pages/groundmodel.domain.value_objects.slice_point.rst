groundmodel.domain.value_objects.slice_point
============================================

.. CG-PAGE source=src/groundmodel/domain/value_objects/slice_point.py complete=true

*Source file:* ``src/groundmodel/domain/value_objects/slice_point.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-7

.. literalinclude:: ../../../src/groundmodel/domain/value_objects/slice_point.py
   :language: python
   :lines: 1-7
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line, ``from __future__ import annotations``, and the ``dataclass`` import.

**Why it is here.** The smallest toolbox for a two-field value object.

.. CG-EXPLANATION-END id=module-header

Class ``SlicePoint``
--------------------

.. CG-BLOCK id=class:SlicePoint lines=8-13

.. literalinclude:: ../../../src/groundmodel/domain/value_objects/slice_point.py
   :language: python
   :lines: 8-13
   :lineno-match:

.. CG-EXPLANATION-START id=class:SlicePoint

**What this does.** Defines ``SlicePoint``, a frozen value object holding one point on a section-slice polyline: ``along_m`` (distance measured along the section line) and ``elevation_m``.

**Why it is here.** When a surface is sliced by a section line the result is a list of these — one point per triangle edge the line crosses. It is the natural output shape for a slice query.

.. CG-EXPLANATION-END id=class:SlicePoint

