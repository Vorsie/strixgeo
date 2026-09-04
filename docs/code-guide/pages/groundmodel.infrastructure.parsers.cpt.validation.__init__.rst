groundmodel.infrastructure.parsers.cpt.validation
=================================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/cpt/validation/__init__.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/cpt/validation/__init__.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-5

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/validation/__init__.py
   :language: python
   :lines: 1-5
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Marks the validation sub-folder as a package and re-exports its two names: the severity level and the single-issue type.

**Why it is here.** These two types are shared by every CPT parser, so they live in their own little package that any parser can import without reaching into another parser's folder.

.. CG-EXPLANATION-END id=module-header

