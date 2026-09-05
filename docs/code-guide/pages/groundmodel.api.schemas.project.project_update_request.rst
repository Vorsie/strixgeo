groundmodel.api.schemas.project.project_update_request
======================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/project_update_request.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/project_update_request.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-13

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/project_update_request.py
   :language: python
   :lines: 1-13
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports the shared phase/status vocabularies from the create schema and the strict base class.

**Why it is here.** It reuses the create schema's vocabularies so the two write paths cannot drift apart (the don't-repeat rule).

.. CG-EXPLANATION-END id=module-header

Class ``ProjectUpdateRequest``
------------------------------

.. CG-BLOCK id=class:ProjectUpdateRequest lines=14-37

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/project_update_request.py
   :language: python
   :lines: 14-37
   :lineno-match:

.. CG-EXPLANATION-START id=class:ProjectUpdateRequest

**What this does.** The body for a partial project update. Every field is optional; only fields present in the body are written. Tags are a full replacement, and an empty name is rejected.

**Why it is here.** PATCH applies only the present fields, so all are optional. The docstring records that tags overwrite rather than append, matching how the desktop editor always holds the complete edited tag set; and an empty name is refused because the column cannot be null and a project must stay identifiable — omit the field to keep the existing name.

.. CG-EXPLANATION-END id=class:ProjectUpdateRequest

