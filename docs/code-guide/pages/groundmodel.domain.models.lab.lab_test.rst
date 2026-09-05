groundmodel.domain.models.lab.lab_test
======================================

.. CG-PAGE source=src/groundmodel/domain/models/lab/lab_test.py complete=true

*Source file:* ``src/groundmodel/domain/models/lab/lab_test.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-8

.. literalinclude:: ../../../src/groundmodel/domain/models/lab/lab_test.py
   :language: python
   :lines: 1-8
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and the toolbox: ``ABC`` (from the ``abc`` module), ``dataclass`` / ``field``, ``UUID`` / ``uuid7``.

**Why it is here.** ``ABC`` marks the class below as an *abstract base class* — a shared parent that is never created on its own, only inherited from.

.. CG-EXPLANATION-END id=module-header

Class ``LabTest``
-----------------

.. CG-BLOCK id=class:LabTest lines=9-13

.. literalinclude:: ../../../src/groundmodel/domain/models/lab/lab_test.py
   :language: python
   :lines: 9-13
   :lineno-match:

.. CG-EXPLANATION-START id=class:LabTest

**What this does.** Defines ``LabTest``, the abstract parent of every lab-test shape. It holds only the two things every lab test has in common: the ``sample_id`` foreign key to the sample it was performed on, and its own ``id``.

**Why it is here.** Every specific test (grain size, Atterberg, water content, ...) inherits these two fields instead of repeating them. It is *abstract* because a bare 'lab test' with no measurement means nothing — you always have a specific kind. The domain rule that a lab test belongs to a ``Sample``, not to a borehole, is encoded right here in that single shared field.

.. CG-EXPLANATION-END id=class:LabTest

