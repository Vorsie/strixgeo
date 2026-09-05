groundmodel.shared
==================

.. CG-PAGE source=src/groundmodel/shared/__init__.py complete=true

*Source file:* ``src/groundmodel/shared/__init__.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-1

.. literalinclude:: ../../../src/groundmodel/shared/__init__.py
   :language: python
   :lines: 1-1
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description for the ``shared`` package. Marking a folder with an ``__init__.py`` file is what turns it into an importable package; this file is otherwise empty, so importing the package runs no code.

**Why it is here.** ``shared/`` is the small corner every layer is allowed to use — the logging helpers, the settings, the exception list and a few constant tables. Keeping its marker empty means importing anything from ``shared`` costs nothing and pulls in no surprises. See CLAUDE.md "Architecture" (the shared corner).

.. CG-EXPLANATION-END id=module-header

