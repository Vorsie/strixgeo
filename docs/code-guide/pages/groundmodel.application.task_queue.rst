groundmodel.application.task_queue
==================================

.. CG-PAGE source=src/groundmodel/application/task_queue.py complete=true

*Source file:* ``src/groundmodel/application/task_queue.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-9

.. literalinclude:: ../../../src/groundmodel/application/task_queue.py
   :language: python
   :lines: 1-9
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports the job domain object and the shared logger for the abstract queue below.

**Why it is here.** A tiny header for the queue interface.

.. CG-EXPLANATION-END id=module-header

Class ``TaskQueue`` — header
----------------------------

.. CG-BLOCK id=class:TaskQueue lines=10-12

.. literalinclude:: ../../../src/groundmodel/application/task_queue.py
   :language: python
   :lines: 10-12
   :lineno-match:

.. CG-EXPLANATION-START id=class:TaskQueue

**What this does.** An abstract base class for a task queue — a place jobs are submitted and their status is asked for. Being abstract means it names methods but does not implement them; a concrete class must.

**Why it is here.** This is the queue-ready-not-queue-first rule in CLAUDE.md: the interface is defined from day one so a real broker (a background job service) can be dropped in later, but nothing is built until load justifies it. A job is one unit of background work.

.. CG-EXPLANATION-END id=class:TaskQueue

Method ``TaskQueue``. ``async def enqueue``
-------------------------------------------

.. CG-BLOCK id=method:TaskQueue.enqueue lines=13-17

.. literalinclude:: ../../../src/groundmodel/application/task_queue.py
   :language: python
   :lines: 13-17
   :lineno-match:

.. CG-EXPLANATION-START id=method:TaskQueue.enqueue

**What this does.** The abstract method to submit a job for execution.

**Why it is here.** Names the submit half of the contract every concrete queue must provide.

.. CG-EXPLANATION-END id=method:TaskQueue.enqueue

Method ``TaskQueue``. ``async def get_status``
----------------------------------------------

.. CG-BLOCK id=method:TaskQueue.get_status lines=18-21

.. literalinclude:: ../../../src/groundmodel/application/task_queue.py
   :language: python
   :lines: 18-21
   :lineno-match:

.. CG-EXPLANATION-START id=method:TaskQueue.get_status

**What this does.** The abstract method to return the current state of a job by its id.

**Why it is here.** Names the query half of the contract.

.. CG-EXPLANATION-END id=method:TaskQueue.get_status

