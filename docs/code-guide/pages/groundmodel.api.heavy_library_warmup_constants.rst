groundmodel.api.heavy_library_warmup_constants
==============================================

.. CG-PAGE source=src/groundmodel/api/heavy_library_warmup_constants.py complete=true

*Source file:* ``src/groundmodel/api/heavy_library_warmup_constants.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-20

.. literalinclude:: ../../../src/groundmodel/api/heavy_library_warmup_constants.py
   :language: python
   :lines: 1-20
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Defines two values for the warm-up: ``WARMUP_SKIP_ENV`` (the
name of the environment switch that turns the warm-up off) and
``WARMUP_THREAD_NAME`` (the name given to the background thread).

**Why it is here.** Kept beside — not inside — the class that uses them, per the
project's constants convention, so both the warm-up module and its tests can
import them by name. The thread is named so it is recognisable in a thread dump
if anyone ever inspects the running process.

.. CG-EXPLANATION-END id=module-header

