groundmodel.infrastructure.parsers.cpt.validation.validation_level
==================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/cpt/validation/validation_level.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/cpt/validation/validation_level.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-4

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/validation/validation_level.py
   :language: python
   :lines: 1-4
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A one-line description and an import of ``StrEnum`` — an enum (a fixed named set of choices) whose members are also ordinary text strings, so each value both names a choice and prints as itself.

**Why it is here.** The next block uses it to spell out the three severities a parse finding can have, in a form that drops straight into a log line or a JSON reply as plain text.

.. CG-EXPLANATION-END id=module-header

Class ``ValidationLevel``
-------------------------

.. CG-BLOCK id=class:ValidationLevel lines=5-10

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/validation/validation_level.py
   :language: python
   :lines: 5-10
   :lineno-match:

.. CG-EXPLANATION-START id=class:ValidationLevel

**What this does.** The three severities a parse finding can carry: ``ERROR`` (the file is broken enough that the import must be refused), ``WARNING`` (usable, but the engineer needs to know something is off), and ``INFO`` (a neutral note worth recording).

**Why it is here.** The parser never throws its findings away and never silently fixes them — it labels each one with a severity and hands the whole list back. ``ERROR`` is the level that later blocks the import; the other two travel to the screen so the engineer decides what to trust. Keeping the three names in one enum stops the code drifting into ``"warn"`` in one place and ``"warning"`` in another.

.. CG-EXPLANATION-END id=class:ValidationLevel

