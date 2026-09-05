groundmodel.domain.value_objects.field_log_kind
===============================================

.. CG-PAGE source=src/groundmodel/domain/value_objects/field_log_kind.py complete=true

*Source file:* ``src/groundmodel/domain/value_objects/field_log_kind.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-5

.. literalinclude:: ../../../src/groundmodel/domain/value_objects/field_log_kind.py
   :language: python
   :lines: 1-5
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and one import of ``StrEnum``.

**Why it is here.** The kind is stored as text, so a string-valued enum fits.

.. CG-EXPLANATION-END id=module-header

Class ``FieldLogKind``
----------------------

.. CG-BLOCK id=class:FieldLogKind lines=6-25

.. literalinclude:: ../../../src/groundmodel/domain/value_objects/field_log_kind.py
   :language: python
   :lines: 6-25
   :lineno-match:

.. CG-EXPLANATION-START id=class:FieldLogKind

**What this does.** Defines ``FieldLogKind``, a StrEnum with three members — ``COLOR``, ``MOISTURE`` and ``CONSISTENCY`` — naming which property a field-log interval describes.

**Why it is here.** These are the three direct observations a driller records at the hole (colour such as ``groenbruin`` = green-brown, moisture such as ``vochtig`` = moist, consistency such as ``plastisch`` = plastic). Fixing the *kind* as an enum keeps the three streams cleanly separated, while the observed *value* itself stays a free string because the source vocabulary is open.

.. CG-EXPLANATION-END id=class:FieldLogKind

