groundmodel.infrastructure.parsers.dov
======================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/dov/__init__.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/dov/__init__.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-8

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/__init__.py
   :language: python
   :lines: 1-8
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Marks the shared-DOV folder as a package, with a one-paragraph note of what belongs in it.

**Why it is here.** Everything under this folder is shared by every kind of DOV import — CPTs, boreholes, samples, lab observations: the web endpoint, the coordinate translator, the retry logic, the XML helpers. The per-kind pieces live in their own folders and lean on these.

.. CG-EXPLANATION-END id=module-header

