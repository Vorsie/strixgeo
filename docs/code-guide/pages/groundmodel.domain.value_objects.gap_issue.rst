groundmodel.domain.value_objects.gap_issue
==========================================

.. CG-PAGE source=src/groundmodel/domain/value_objects/gap_issue.py complete=true

*Source file:* ``src/groundmodel/domain/value_objects/gap_issue.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-25

.. literalinclude:: ../../../src/groundmodel/domain/value_objects/gap_issue.py
   :language: python
   :lines: 1-25
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A module docstring plus ``from __future__ import annotations`` and imports of ``dataclass`` and ``UUID``. The docstring explains that a ``GapIssue`` is one problem flagged by the geology no-gaps validator, and why it lives in the domain layer.

**Why it is here.** The docstring records a debt-#36 decision: this result type carries domain meaning (contacts, depths, the rule that a contact below the hole's total depth is a mistake), so it belongs in the pure domain and not in an infrastructure file. That keeps API schemas and future consumers able to use it without dragging in a database dependency.

.. CG-EXPLANATION-END id=module-header

Class ``GapIssue``
------------------

.. CG-BLOCK id=class:GapIssue lines=26-61

.. literalinclude:: ../../../src/groundmodel/domain/value_objects/gap_issue.py
   :language: python
   :lines: 26-61
   :lineno-match:

.. CG-EXPLANATION-START id=class:GapIssue

**What this does.** Defines ``GapIssue``, a frozen value object describing one validation problem: a ``kind`` string (``missing_surface_contact``, ``duplicate_depth``, ``contact_below_test``, ``no_contacts``, or ``formation_crossing``), a human-readable ``detail``, an optional ``depth_m``, and tuples of the ``contact_ids`` and ``formation_ids`` the problem points at.

**Why it is here.** The validator returns a list of these; an empty list means the model's stratigraphy is clean. Using open strings for ``kind`` — with the instruction that a caller should treat an unknown kind as a warning rather than crash — lets new problem types be added later without breaking older readers. The id tuples let the section editor highlight exactly the rows at fault.

.. CG-EXPLANATION-END id=class:GapIssue

