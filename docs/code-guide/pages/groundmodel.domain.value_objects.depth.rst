groundmodel.domain.value_objects.depth
======================================

.. CG-PAGE source=src/groundmodel/domain/value_objects/depth.py complete=true

*Source file:* ``src/groundmodel/domain/value_objects/depth.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-4

.. literalinclude:: ../../../src/groundmodel/domain/value_objects/depth.py
   :language: python
   :lines: 1-4
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and one import of ``dataclass``.

**Why it is here.** A one-class value object with a single self-check.

.. CG-EXPLANATION-END id=module-header

Class ``Depth`` — header
------------------------

.. CG-BLOCK id=class:Depth lines=5-9

.. literalinclude:: ../../../src/groundmodel/domain/value_objects/depth.py
   :language: python
   :lines: 5-9
   :lineno-match:

.. CG-EXPLANATION-START id=class:Depth

**What this does.** Defines ``Depth``, a frozen value object wrapping a single number — a depth in metres — as ``value_m``.

**Why it is here.** Wrapping a bare number in a named type makes a function signature say 'this argument is a depth', not 'this argument is some float', and gives one place to enforce the rule that a depth is never negative.

.. CG-EXPLANATION-END id=class:Depth

Method ``Depth``. ``def __post_init__``
---------------------------------------

.. CG-BLOCK id=method:Depth.__post_init__ lines=10-12

.. literalinclude:: ../../../src/groundmodel/domain/value_objects/depth.py
   :language: python
   :lines: 10-12
   :lineno-match:

.. CG-EXPLANATION-START id=method:Depth.__post_init__

**What this does.** Runs right after the depth is built; rejects a negative value, raising ``ValueError``.

**Why it is here.** A single-field invariant that holds for every depth in the program: below the surface is positive, so a negative depth is a bug wherever it appears.

.. CG-EXPLANATION-END id=method:Depth.__post_init__

