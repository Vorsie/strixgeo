groundmodel.domain.models
=========================

.. CG-PAGE source=src/groundmodel/domain/models/__init__.py complete=true

*Source file:* ``src/groundmodel/domain/models/__init__.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-1

.. literalinclude:: ../../../src/groundmodel/domain/models/__init__.py
   :language: python
   :lines: 1-1
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The whole file is one line of text in triple quotes — a *docstring*, a short note to whoever reads the file. There is no code.

**Why it is here.** Its only job is to mark this folder as a *package*: a named group of related Python files that can be imported together. This is the ``domain/models`` package — the home of the plain data shapes at the heart of the program (a borehole, a sample, a lab test). By the layer rule described on the Start-here page, these shapes know nothing about the database or the web; they are pure knowledge, the easiest thing to test and the least likely to break.

.. CG-EXPLANATION-END id=module-header

