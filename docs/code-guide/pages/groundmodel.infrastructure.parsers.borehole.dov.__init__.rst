groundmodel.infrastructure.parsers.borehole.dov
===============================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/borehole/dov/__init__.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/borehole/dov/__init__.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-11

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/__init__.py
   :language: python
   :lines: 1-11
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Marks the borehole DOV sub-folder as a package and names the two parsers inside it.

**Why it is here.** One parser reads a borehole's own XML (its header, drill segments, and the driller's field notes) and another reads the separate interpretation XMLs (the layer readings a specialist added). The docstring points the reader at both.

.. CG-EXPLANATION-END id=module-header

