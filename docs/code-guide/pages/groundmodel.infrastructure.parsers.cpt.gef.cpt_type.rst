groundmodel.infrastructure.parsers.cpt.gef.cpt_type
===================================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/cpt/gef/cpt_type.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/cpt/gef/cpt_type.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-4

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/cpt_type.py
   :language: python
   :lines: 1-4
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A one-line description, then it pulls in ``Enum`` from Python's standard library. An *enum* (short for enumeration) is a fixed, named set of allowed values — like a drop-down list with a handful of choices and nothing else permitted.

**Why it is here.** The next block needs ``Enum`` to spell out the small, closed list of CPT kinds this platform recognises.

.. CG-EXPLANATION-END id=module-header

Class ``CPTType``
-----------------

.. CG-BLOCK id=class:CPTType lines=5-11

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/cpt_type.py
   :language: python
   :lines: 5-11
   :lineno-match:

.. CG-EXPLANATION-START id=class:CPTType

**What this does.** Lists the four kinds of CPT this platform tells apart, by which sensors the cone carried. ``CPTU`` is a piezocone (measures tip resistance qc, sleeve friction fs, and pore water pressure u2). ``CPTE`` is an electric cone (qc and fs, but no pore pressure). ``CPTM`` is a mechanical cone (qc only). ``UNKNOWN`` is the honest fallback when the file does not say enough to decide.

**Why it is here.** Which validation checks apply, and which columns are required, depend on the cone type — a piezocone must carry u2, a mechanical cone need not. Naming the four kinds once, in one place, means the rest of the code compares against ``CPTType.CPTU`` and can never invent a fifth spelling.

.. CG-EXPLANATION-END id=class:CPTType

