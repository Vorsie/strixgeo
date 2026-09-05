groundmodel.domain.models.job_status
====================================

.. CG-PAGE source=src/groundmodel/domain/models/job_status.py complete=true

*Source file:* ``src/groundmodel/domain/models/job_status.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-4

.. literalinclude:: ../../../src/groundmodel/domain/models/job_status.py
   :language: python
   :lines: 1-4
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and one import: ``Enum`` from Python's standard library.

**Why it is here.** An *enum* (enumeration) is a fixed, named set of allowed values; importing ``Enum`` is all that is needed to declare one.

.. CG-EXPLANATION-END id=module-header

Class ``JobStatus``
-------------------

.. CG-BLOCK id=class:JobStatus lines=5-11

.. literalinclude:: ../../../src/groundmodel/domain/models/job_status.py
   :language: python
   :lines: 5-11
   :lineno-match:

.. CG-EXPLANATION-START id=class:JobStatus

**What this does.** Defines ``JobStatus``, an enum with exactly four members: ``PENDING``, ``RUNNING``, ``DONE`` and ``FAILED``.

**Why it is here.** A job's state can only ever be one of these four. Making it an enum means a typo like ``'RUNING'`` is impossible — a status must be one of the four names, and the language enforces it rather than trusting each caller to spell it right.

.. CG-EXPLANATION-END id=class:JobStatus

