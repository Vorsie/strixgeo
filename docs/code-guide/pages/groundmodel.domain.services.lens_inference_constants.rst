groundmodel.domain.services.lens_inference_constants
====================================================

.. CG-PAGE source=src/groundmodel/domain/services/lens_inference_constants.py complete=true

*Source file:* ``src/groundmodel/domain/services/lens_inference_constants.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-38

.. literalinclude:: ../../../src/groundmodel/domain/services/lens_inference_constants.py
   :language: python
   :lines: 1-38
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Holds every tuning number and text token the lens-inference
engine uses, so the engine module itself carries no bare literals. It sets the
depth-overlap ratio to zero, defines the three source tokens (``'inferred'``,
``'manual'``, ``'observed'``), marks only ``'inferred'`` as engine-owned, and
names the two investigation kinds (``'borehole'`` and ``'cpt'``).

**Why it is here.** The project convention keeps module-level constants in a
``*_constants.py`` file beside the code that uses them, so a value change touches
one place and a test can override it without patching the engine. The comments
record the reasoning behind each value: the zero overlap ratio is deliberately
permissive — a thin clay drape that just nicks the body's depth band still counts
as "a different lithology present there" — and the source tokens mirror the
database's CHECK constraint, so the engine and the schema can never disagree on
which values are allowed. The engine-owned set (a ``frozenset``, an unchangeable
collection with no duplicates) is the guard that stops the engine ever rewriting
a mark the engineer made by hand.

.. CG-EXPLANATION-END id=module-header

