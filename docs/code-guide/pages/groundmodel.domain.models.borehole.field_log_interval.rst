groundmodel.domain.models.borehole.field_log_interval
=====================================================

.. CG-PAGE source=src/groundmodel/domain/models/borehole/field_log_interval.py complete=true

*Source file:* ``src/groundmodel/domain/models/borehole/field_log_interval.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-7

.. literalinclude:: ../../../src/groundmodel/domain/models/borehole/field_log_interval.py
   :language: python
   :lines: 1-7
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line, the ``dataclass`` import, and one import of ``FieldLogKind`` — the small fixed list of which property a field-log line describes (colour, moisture, or consistency).

**Why it is here.** ``FieldLogKind`` lives in the ``value_objects`` package and is imported here because each interval must say which of the three field-recorded properties it carries.

.. CG-EXPLANATION-END id=module-header

Class ``FieldLogInterval`` — header
-----------------------------------

.. CG-BLOCK id=class:FieldLogInterval lines=8-47

.. literalinclude:: ../../../src/groundmodel/domain/models/borehole/field_log_interval.py
   :language: python
   :lines: 8-47
   :lineno-match:

.. CG-EXPLANATION-START id=class:FieldLogInterval

**What this does.** Defines a ``FieldLogInterval``: one depth interval of a single field-recorded property — its top, base, the ``kind`` (colour / moisture / consistency), and the source-vocabulary ``value`` (``groenbruin`` = green-brown, ``vochtig`` = moist, ``plastisch`` = plastic). It is frozen.

**Why it is here.** These are the driller's own direct observations, written down at the hole, and the docstring keeps them clearly apart from the interpretation layers a geologist later reads off the log. It is frozen for the same reason as a drill segment: a recorded fact, not an editable value.

.. CG-EXPLANATION-END id=class:FieldLogInterval

Method ``FieldLogInterval``. ``def __post_init__``
--------------------------------------------------

.. CG-BLOCK id=method:FieldLogInterval.__post_init__ lines=48-52

.. literalinclude:: ../../../src/groundmodel/domain/models/borehole/field_log_interval.py
   :language: python
   :lines: 48-52
   :lineno-match:

.. CG-EXPLANATION-START id=method:FieldLogInterval.__post_init__

**What this does.** Runs right after the interval is built; rejects a negative top depth and an empty value, raising ``ValueError``.

**Why it is here.** Only the single-field guards live here. The base-deeper-than-top rule is left to the parser as a ``ValidationIssue`` — ``DovBoringParser`` pre-checks it and emits an ``INVALID_INTERVAL`` warning on an inverted row (CLAUDE.md Data-Integrity rule 5). Debt #15.

.. CG-EXPLANATION-END id=method:FieldLogInterval.__post_init__

