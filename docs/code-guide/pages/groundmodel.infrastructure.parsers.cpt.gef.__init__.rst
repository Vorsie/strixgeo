groundmodel.infrastructure.parsers.cpt.gef
==========================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/cpt/gef/__init__.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/cpt/gef/__init__.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-7

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/__init__.py
   :language: python
   :lines: 1-7
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Marks the GEF sub-folder as a package and re-exports its four public names: the CPT-type label, the parsed header, the parse result, and the parser.

**Why it is here.** GEF is the Dutch/Belgian text file format a CPT is delivered in (a ``.gef`` file is plain text: a header of ``#`` lines then a block of numbers). Grouping the four names here lets a caller import them from one place without caring which file each sits in.

.. CG-EXPLANATION-END id=module-header

