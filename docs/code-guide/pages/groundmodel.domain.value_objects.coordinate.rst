groundmodel.domain.value_objects.coordinate
===========================================

.. CG-PAGE source=src/groundmodel/domain/value_objects/coordinate.py complete=true

*Source file:* ``src/groundmodel/domain/value_objects/coordinate.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-4

.. literalinclude:: ../../../src/groundmodel/domain/value_objects/coordinate.py
   :language: python
   :lines: 1-4
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and one import of ``dataclass``.

**Why it is here.** The smallest toolbox for a one-class value object.

.. CG-EXPLANATION-END id=module-header

Class ``Coordinate``
--------------------

.. CG-BLOCK id=class:Coordinate lines=5-10

.. literalinclude:: ../../../src/groundmodel/domain/value_objects/coordinate.py
   :language: python
   :lines: 5-10
   :lineno-match:

.. CG-EXPLANATION-START id=class:Coordinate

**What this does.** Defines ``Coordinate``, a frozen 2-D point: ``x`` and ``y`` plus an ``epsg`` code, defaulting to 4326 (WGS84, plain latitude/longitude).

**Why it is here.** An x/y pair means nothing without the coordinate system it is measured in, so the *EPSG* code (a published number naming a coordinate reference system) travels with the numbers. The 4326 default is the safe universal fallback when nothing more specific is known.

.. CG-EXPLANATION-END id=class:Coordinate

