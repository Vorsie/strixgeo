groundmodel.domain.models.job
=============================

.. CG-PAGE source=src/groundmodel/domain/models/job.py complete=true

*Source file:* ``src/groundmodel/domain/models/job.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-10

.. literalinclude:: ../../../src/groundmodel/domain/models/job.py
   :language: python
   :lines: 1-10
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and the toolbox: ``dataclass`` / ``field``, ``datetime`` (a date-and-time), ``UUID`` / ``uuid7``, and the ``JobStatus`` list of states.

**Why it is here.** A job records its lifecycle state, so it imports the ``JobStatus`` enum.

.. CG-EXPLANATION-END id=module-header

Class ``Job``
-------------

.. CG-BLOCK id=class:Job lines=11-22

.. literalinclude:: ../../../src/groundmodel/domain/models/job.py
   :language: python
   :lines: 11-22
   :lineno-match:

.. CG-EXPLANATION-START id=class:Job

**What this does.** Defines a ``Job``: a unit of background work — its ``type`` and ``payload`` (the input), its ``id`` and ``status``, an optional ``result``, a running list of ``logs``, and the created / finished timestamps.

**Why it is here.** The platform tracks heavy work — a large import, a 3-D build — as a job so its progress and outcome can be shown. Today these run inline (the synchronous queue described in CLAUDE.md's Job System), but the shape is ready for a real background worker later without changing any caller.

.. CG-EXPLANATION-END id=class:Job

