groundmodel.domain.models.borehole.sample
=========================================

.. CG-PAGE source=src/groundmodel/domain/models/borehole/sample.py complete=true

*Source file:* ``src/groundmodel/domain/models/borehole/sample.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-9

.. literalinclude:: ../../../src/groundmodel/domain/models/borehole/sample.py
   :language: python
   :lines: 1-9
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and the toolbox: ``dataclass`` / ``field``, ``date``, ``UUID`` / ``uuid7``.

**Why it is here.** No project imports are needed — a sample refers to its borehole only by id.

.. CG-EXPLANATION-END id=module-header

Class ``Sample`` — header
-------------------------

.. CG-BLOCK id=class:Sample lines=10-71

.. literalinclude:: ../../../src/groundmodel/domain/models/borehole/sample.py
   :language: python
   :lines: 10-71
   :lineno-match:

.. CG-EXPLANATION-START id=class:Sample

**What this does.** Defines a ``Sample``: a piece of material taken from a borehole over a depth interval (``depth_top_m`` / ``depth_base_m``), with a free-text description and source-vocabulary fields for the sample number, type (``geroerd`` = disturbed, ``ongeroerd`` = undisturbed), composition, instrument and sampling date, plus its ``borehole_id`` foreign key and its ``id``.

**Why it is here.** A sample is the bridge between a borehole and any lab test done on its material — the docstring says so, matching the domain rule that a ``LabTest`` hangs off a ``Sample`` and not directly off a ``Borehole``. Equal top and base depths are allowed, for a spot sample that is not depth-resolved.

.. CG-EXPLANATION-END id=class:Sample

Method ``Sample``. ``def __post_init__``
----------------------------------------

.. CG-BLOCK id=method:Sample.__post_init__ lines=72-74

.. literalinclude:: ../../../src/groundmodel/domain/models/borehole/sample.py
   :language: python
   :lines: 72-74
   :lineno-match:

.. CG-EXPLANATION-START id=method:Sample.__post_init__

**What this does.** Runs right after the sample is built; rejects a negative top depth, raising ``ValueError``.

**Why it is here.** A single-field guard. The rule that the base is at least as deep as the top is left to a future sample parser as a ``ValidationIssue`` (CLAUDE.md Data-Integrity rule 5). Debt #15.

.. CG-EXPLANATION-END id=method:Sample.__post_init__

