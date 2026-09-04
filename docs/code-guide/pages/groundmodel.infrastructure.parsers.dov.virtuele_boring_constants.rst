groundmodel.infrastructure.parsers.dov.virtuele_boring_constants
================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/dov/virtuele_boring_constants.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/dov/virtuele_boring_constants.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-60

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/virtuele_boring_constants.py
   :language: python
   :lines: 1-60
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Holds the fixed values for the Virtuele Boring service: its base web address, the two endpoint paths, the default model code, the expected coordinate system, the timeouts, and the parallel-request ceiling.

**Why it is here.** These live in a dedicated constants file per the project convention, each with a comment recording what was verified live — for example that a single-point query on the profile endpoint fails and only the point-pick endpoint returns a usable stack, and that the service expects Belgian Lambert 72, so out-of-area coordinates are gated at the application layer rather than trusting the service to refuse them.

.. CG-EXPLANATION-END id=module-header

