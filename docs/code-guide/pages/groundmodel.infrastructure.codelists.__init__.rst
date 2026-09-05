groundmodel.infrastructure.codelists
====================================

.. CG-PAGE source=src/groundmodel/infrastructure/codelists/__init__.py complete=true

*Source file:* ``src/groundmodel/infrastructure/codelists/__init__.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-7

.. literalinclude:: ../../../src/groundmodel/infrastructure/codelists/__init__.py
   :language: python
   :lines: 1-7
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Marks the codelists folder as a package and, in its docstring, says what it is: the store of the authoritative DOV code tables, with a future lookup resolver planned to live here.

**Why it is here.** A *codelist* is a fixed table that maps a short code to a human name. Today this folder is mostly the source data files that drive translation of DOV's Dutch vocabulary; the docstring records that a live SPARQL-plus-disk-cache resolver will be added here later.

.. CG-EXPLANATION-END id=module-header

