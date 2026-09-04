groundmodel.infrastructure.parsers
==================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/__init__.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/__init__.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-1

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/__init__.py
   :language: python
   :lines: 1-1
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file just marks the folder as a Python *package* — a folder Python is allowed to import from. The single line of text in triple quotes is the folder's one-sentence description.

**Why it is here.** Every folder of Python code needs one of these ``__init__.py`` files, even an empty one, or the code inside cannot be imported by the rest of the program. This is the top of the parsers tree: everything that reads an outside file format — GEF, DOV, borehole, lab — lives under here.

.. CG-EXPLANATION-END id=module-header

