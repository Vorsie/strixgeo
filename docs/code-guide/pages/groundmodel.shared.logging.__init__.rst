groundmodel.shared.logging
==========================

.. CG-PAGE source=src/groundmodel/shared/logging/__init__.py complete=true

*Source file:* ``src/groundmodel/shared/logging/__init__.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-1

.. literalinclude:: ../../../src/groundmodel/shared/logging/__init__.py
   :language: python
   :lines: 1-1
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description for the ``shared/logging`` package — the three files that make up the engine's logging: the custom levels, the typed logger wrapper, and the factory that hands one out. Marking a folder with ``__init__.py`` is what makes it an importable package; this one holds only a description.

**Why it is here.** Keeping the package marker empty means importing the logging helpers pulls in nothing extra. These three files are the whole logging story; see CLAUDE.md "Logging".

.. CG-EXPLANATION-END id=module-header

