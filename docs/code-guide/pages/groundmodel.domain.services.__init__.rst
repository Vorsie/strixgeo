groundmodel.domain.services
===========================

.. CG-PAGE source=src/groundmodel/domain/services/__init__.py complete=true

*Source file:* ``src/groundmodel/domain/services/__init__.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-1

.. literalinclude:: ../../../src/groundmodel/domain/services/__init__.py
   :language: python
   :lines: 1-1
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A one-line docstring marking this folder as the home of the domain-service modules: the pure geotechnical calculations. An __init__.py file is what turns a folder into a Python package the rest of the code can import from.

**Why it is here.** Every folder that is a Python package carries this file. Its only job here is to name what lives in the folder, so a reader opening the package sees at once that this is the pure-knowledge layer, the soil-mechanics maths that never touches the database or the network.

.. CG-EXPLANATION-END id=module-header

