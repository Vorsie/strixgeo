groundmodel.application.lumping_collision
=========================================

.. CG-PAGE source=src/groundmodel/application/lumping_collision.py complete=true

*Source file:* ``src/groundmodel/application/lumping_collision.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-8

.. literalinclude:: ../../../src/groundmodel/application/lumping_collision.py
   :language: python
   :lines: 1-8
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Defines the ``LumpingCollision`` frozen dataclass — a per-borehole warning raised when manual stratigraphy lumping makes two layers resolve to the same formation top.

**Why it is here.** A formation surface needs exactly one top depth per borehole, so two tops would corrupt the TIN and break the exported geometry. The owner-specified, data-integrity-critical rule keeps only the shallowest colliding contact and drops the deeper duplicates, because the shallowest is where the formation first appears — dropping the deeper one says the formation is represented once at the depth it starts. The colliding names tuple is immutable so the frozen dataclass is truly frozen.

.. CG-EXPLANATION-END id=module-header

Class ``LumpingCollision``
--------------------------

.. CG-BLOCK id=class:LumpingCollision lines=9-50

.. literalinclude:: ../../../src/groundmodel/application/lumping_collision.py
   :language: python
   :lines: 9-50
   :lineno-match:

.. CG-EXPLANATION-START id=class:LumpingCollision

**What this does.** The dataclass itself: the borehole, the formation key and name the layers collided on, all the raw names that mapped to it, the kept shallowest top depth, and how many deeper duplicates were dropped.

**Why it is here.** It carries enough for the desktop to show the engineer exactly what was merged and what was dropped, per the resolution rule above.

.. CG-EXPLANATION-END id=class:LumpingCollision

