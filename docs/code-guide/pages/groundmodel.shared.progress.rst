groundmodel.shared.progress
===========================

.. CG-PAGE source=src/groundmodel/shared/progress.py complete=true

*Source file:* ``src/groundmodel/shared/progress.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-58

.. literalinclude:: ../../../src/groundmodel/shared/progress.py
   :language: python
   :lines: 1-58
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Defines ``ProgressCallback``, the type of an optional function a caller can supply to be told when a long import reaches each named phase (WFS discovery, download, dedup, persist, commit, plus the CPT-only "pins" and the borehole-only phases). The docstring lists every phase name and what its counts mean. A *callback* is a function you hand to another function so it can call you back.

**Why it is here.** The docstring records that DOV imports run 30–60 seconds for large bounding boxes, so a coarse per-phase callback surfaces live progress to the UI without changing the atomic-commit contract. It is fired once per phase boundary, not once per row, on purpose. A *bounding box (bbox)* is a rectangular map area; *WFS* is the DOV web service that lists what is in that area.

.. CG-EXPLANATION-END id=module-header

Function ``async def fire_progress``
------------------------------------

.. CG-BLOCK id=function:fire_progress lines=59-84

.. literalinclude:: ../../../src/groundmodel/shared/progress.py
   :language: python
   :lines: 59-84
   :lineno-match:

.. CG-EXPLANATION-START id=function:fire_progress

**What this does.** Invokes the callback when one was supplied, awaiting it if it is asynchronous, and does nothing when it is ``None``. Any error the callback raises is silently swallowed.

**Why it is here.** The docstring records that a broken progress connection (for example a dropped browser connection) must never abort an import — the callback is a best-effort signal, not a control path, so its failures are suppressed. *async / await* is Python's way of letting a step that may have to wait (for the network) run without blocking other work.

.. CG-EXPLANATION-END id=function:fire_progress

