groundmodel.application
=======================

.. CG-PAGE source=src/groundmodel/application/__init__.py complete=true

*Source file:* ``src/groundmodel/application/__init__.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-1

.. literalinclude:: ../../../src/groundmodel/application/__init__.py
   :language: python
   :lines: 1-1
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The whole file: a single line of documentation text (a *docstring* — a quoted note Python keeps as the description of the thing it sits at the top of) naming what this folder holds. The mere presence of this file also tells Python to treat the folder as a *package* — one named box of related code files that can be imported as a unit.

**Why it is here.** It marks ``application`` as the application layer and states its job in the docstring: *use cases* and *orchestration*. A use case is one complete unit of work the program can be asked to do — "import this CPT", "subdivide all the bodies" — written as one class. Orchestration means listing the steps and their order and handing each step to the right helper; this layer does the arranging, not the geotechnical maths (that is the domain layer) and not the database or file work (that is infrastructure). The layer rule described in the start-here page is that this layer may lean on the domain below it but nothing above it may reach past it.

.. CG-EXPLANATION-END id=module-header

