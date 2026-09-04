groundmodel.infrastructure.parsers.cpt.dov
==========================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/cpt/dov/__init__.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/cpt/dov/__init__.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-13

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/dov/__init__.py
   :language: python
   :lines: 1-13
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Marks the CPT DOV sub-folder as a package. The docstring also notes why this empty-ish file is kept rather than left out.

**Why it is here.** DOV (Databank Ondergrond Vlaanderen) is the public Flemish subsurface database this platform pulls CPTs from over the internet. Having a real ``__init__.py`` here (rather than relying on Python's folder-without-a-file trick) keeps the build tools, the type checker, and the test runner happy — the docstring records exactly that reasoning.

.. CG-EXPLANATION-END id=module-header

