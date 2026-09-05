groundmodel.domain.models.lab.atterberg_limits
==============================================

.. CG-PAGE source=src/groundmodel/domain/models/lab/atterberg_limits.py complete=true

*Source file:* ``src/groundmodel/domain/models/lab/atterberg_limits.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-8

.. literalinclude:: ../../../src/groundmodel/domain/models/lab/atterberg_limits.py
   :language: python
   :lines: 1-8
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and the toolbox: ``dataclass``, ``date``, and the ``LabTest`` parent.

**Why it is here.** ``LabTest`` is imported because ``AtterbergLimits`` is one specific kind of lab test and inherits the shared ``sample_id`` and ``id`` from it.

.. CG-EXPLANATION-END id=module-header

Class ``AtterbergLimits`` — header
----------------------------------

.. CG-BLOCK id=class:AtterbergLimits lines=9-61

.. literalinclude:: ../../../src/groundmodel/domain/models/lab/atterberg_limits.py
   :language: python
   :lines: 9-61
   :lineno-match:

.. CG-EXPLANATION-START id=class:AtterbergLimits

**What this does.** Defines ``AtterbergLimits`` (inheriting ``LabTest``): the two measured consistency limits of a fine soil — liquid limit and plastic limit, each a water-content percentage — plus a ``non_plastic`` flag, the method, and the test date.

**Why it is here.** The two limits are stored separately rather than pre-combined into the plasticity index, because design work needs liquid limit and plastic limit in their own right (the Casagrande chart, plasticity classification) and folding them into one number would throw information away. A soil that cannot be rolled into a thread is *non-plastic*: it sets the flag and usually leaves the plastic limit empty. The generous 0–1000 % validation band rejects only clearly non-physical readings, since extreme clays really can read very high.

.. CG-EXPLANATION-END id=class:AtterbergLimits

Method ``AtterbergLimits``. ``def __post_init__``
-------------------------------------------------

.. CG-BLOCK id=method:AtterbergLimits.__post_init__ lines=62-71

.. literalinclude:: ../../../src/groundmodel/domain/models/lab/atterberg_limits.py
   :language: python
   :lines: 62-71
   :lineno-match:

.. CG-EXPLANATION-START id=method:AtterbergLimits.__post_init__

**What this does.** Checks that each limit, when present, lies within 0–1000 %, raising ``ValueError`` otherwise.

**Why it is here.** These are single-field range checks, so they belong in the dataclass. The band is deliberately wide (typical soils stay under ~120 %, but quick clays and bentonites can exceed that) — the guard exists to catch a garbage number, not to police geotechnics.

.. CG-EXPLANATION-END id=method:AtterbergLimits.__post_init__

Method ``AtterbergLimits``. ``def plasticity_index_pct``
--------------------------------------------------------

.. CG-BLOCK id=method:AtterbergLimits.plasticity_index_pct lines=72-103

.. literalinclude:: ../../../src/groundmodel/domain/models/lab/atterberg_limits.py
   :language: python
   :lines: 72-103
   :lineno-match:

.. CG-EXPLANATION-START id=method:AtterbergLimits.plasticity_index_pct

**What this does.** A *property* that computes the plasticity index (liquid limit minus plastic limit) on demand. It returns nothing when the soil is flagged non-plastic or when either limit is missing; otherwise it returns the plain difference, even when that is zero or negative.

**Why it is here.** A *property* is a method dressed up to be read like a stored field (``sample.plasticity_index_pct``), but it is recomputed every time and never saved. This is CLAUDE.md Data-Integrity rule 1 in action: a value we derive from other stored values is computed on read, so it can never drift out of step with the liquid and plastic limits it comes from after an edit. The docstring lists the consequences — it is absent from ``__init__``, from the field list, from serialization, and from the database columns, which store measured values only. Returning a zero or negative difference as-measured lets a caller tell 'barely plastic' apart from 'declared non-plastic'.

.. CG-EXPLANATION-END id=method:AtterbergLimits.plasticity_index_pct

