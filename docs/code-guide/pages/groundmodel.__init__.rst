groundmodel
===========

.. CG-PAGE source=src/groundmodel/__init__.py complete=true

*Source file:* ``src/groundmodel/__init__.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-1

.. literalinclude:: ../../../src/groundmodel/__init__.py
   :language: python
   :lines: 1-1
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The single line here is the description for the top-level ``groundmodel`` package — the root folder that holds the whole Python engine. A file named ``__init__.py`` is what marks a folder as an importable *package* (a folder other code can import from); this one holds only a description and no code.

**Why it is here.** Every folder in the engine that other code imports from needs an ``__init__.py``, and the root is no exception. Keeping it empty means simply importing ``groundmodel`` does nothing but make the sub-packages reachable.

.. CG-EXPLANATION-END id=module-header

