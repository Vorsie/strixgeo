groundmodel.domain.models.borehole.drill_segment
================================================

.. CG-PAGE source=src/groundmodel/domain/models/borehole/drill_segment.py complete=true

*Source file:* ``src/groundmodel/domain/models/borehole/drill_segment.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-5

.. literalinclude:: ../../../src/groundmodel/domain/models/borehole/drill_segment.py
   :language: python
   :lines: 1-5
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and a single import of ``dataclass``.

**Why it is here.** This is one of the smallest domain shapes, so its toolbox is a single line.

.. CG-EXPLANATION-END id=module-header

Class ``DrillSegment`` — header
-------------------------------

.. CG-BLOCK id=class:DrillSegment lines=6-49

.. literalinclude:: ../../../src/groundmodel/domain/models/borehole/drill_segment.py
   :language: python
   :lines: 6-49
   :lineno-match:

.. CG-EXPLANATION-START id=class:DrillSegment

**What this does.** Defines a ``DrillSegment``: one depth interval of a borehole drilled with a single technique — its top and base in metres below the surface, and the source-vocabulary ``method`` token (Dutch examples with their English meaning are listed in the docstring: ``spade`` = manual spade, ``kerboor`` = core drill, and so on). The ``@dataclass(frozen=True)`` line marks it *frozen*.

**Why it is here.** A *frozen* dataclass is one whose values cannot be changed after it is created — trying to reassign a field raises an error. That fits a segment exactly: it is a fact read from a file, not something the program later edits. DOV records the drill method per interval; the borehole's overall ``drill_method`` is only a summary (``Meerdere technieken`` = multiple techniques), so this per-interval list is the ground truth.

.. CG-EXPLANATION-END id=class:DrillSegment

Method ``DrillSegment``. ``def __post_init__``
----------------------------------------------

.. CG-BLOCK id=method:DrillSegment.__post_init__ lines=50-54

.. literalinclude:: ../../../src/groundmodel/domain/models/borehole/drill_segment.py
   :language: python
   :lines: 50-54
   :lineno-match:

.. CG-EXPLANATION-START id=method:DrillSegment.__post_init__

**What this does.** Runs automatically right after a segment is built. It rejects a negative top depth and an empty method string, raising ``ValueError`` in either case.

**Why it is here.** ``__post_init__`` is the hook a dataclass calls once its fields are set — the natural place for a check. Only the *single-field* guards live here (a depth cannot be below zero; a method must have a name). The *cross-field* rule that the base must be deeper than the top is deliberately NOT checked here: the docstring cites CLAUDE.md Data-Integrity rule 5, which puts cross-field invariants in the parser's list of ``ValidationIssue`` findings, so a messy real-world file is recorded and shown to the user rather than crashing the whole import. Debt #15.

.. CG-EXPLANATION-END id=method:DrillSegment.__post_init__

