groundmodel.api.schemas.project.project_duplicate_request
=========================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/project_duplicate_request.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/project_duplicate_request.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-9

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/project_duplicate_request.py
   :language: python
   :lines: 1-9
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports ``Field`` and the strict base class.

**Why it is here.** Minimal imports for a one-field request schema.

.. CG-EXPLANATION-END id=module-header

Class ``ProjectDuplicateRequest``
---------------------------------

.. CG-BLOCK id=class:ProjectDuplicateRequest lines=10-19

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/project_duplicate_request.py
   :language: python
   :lines: 10-19
   :lineno-match:

.. CG-EXPLANATION-START id=class:ProjectDuplicateRequest

**What this does.** The body for duplicating a project ("Save As"): a single optional new name.

**Why it is here.** The desktop usually derives the name from the chosen file path, but leaving it optional lets a future bulk-duplicate flow omit it and let the backend default to "Copy of <source name>", per the docstring.

.. CG-EXPLANATION-END id=class:ProjectDuplicateRequest

