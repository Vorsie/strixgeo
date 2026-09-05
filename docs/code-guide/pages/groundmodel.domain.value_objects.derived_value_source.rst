groundmodel.domain.value_objects.derived_value_source
=====================================================

.. CG-PAGE source=src/groundmodel/domain/value_objects/derived_value_source.py complete=true

*Source file:* ``src/groundmodel/domain/value_objects/derived_value_source.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-5

.. literalinclude:: ../../../src/groundmodel/domain/value_objects/derived_value_source.py
   :language: python
   :lines: 1-5
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and one import: ``StrEnum`` from Python's standard library.

**Why it is here.** A *StrEnum* is an enum whose members are also plain strings, so a value both belongs to a fixed set and can be stored or compared as text without conversion — handy for a value that goes straight into a database column.

.. CG-EXPLANATION-END id=module-header

Class ``DerivedValueSource``
----------------------------

.. CG-BLOCK id=class:DerivedValueSource lines=6-29

.. literalinclude:: ../../../src/groundmodel/domain/value_objects/derived_value_source.py
   :language: python
   :lines: 6-29
   :lineno-match:

.. CG-EXPLANATION-START id=class:DerivedValueSource

**What this does.** Defines ``DerivedValueSource``, a two-member StrEnum — ``MEASURED`` and ``COMPUTED`` — that tags where a stored value came from.

**Why it is here.** This is the *provenance* flag behind CLAUDE.md Data-Integrity rule 1. When a value could have been recomputed from other stored fields, storing it risks *drift*: edit an input and the stored value silently disagrees. The flag makes the difference explicit — ``MEASURED`` means the file gave the value and it must be preserved as authoritative (it may carry instrument corrections a recomputation would lose); ``COMPUTED`` means the parser derived it and it is safe to throw away and recompute. A missing (``None``) flag means 'unknown' — a legacy row from before the column existed — and must be treated as opaque.

.. CG-EXPLANATION-END id=class:DerivedValueSource

