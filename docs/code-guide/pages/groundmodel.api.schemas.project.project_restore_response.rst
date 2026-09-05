groundmodel.api.schemas.project.project_restore_response
========================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/project_restore_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/project_restore_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-7

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/project_restore_response.py
   :language: python
   :lines: 1-7
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports the plain project-response schema to extend it.

**Why it is here.** It builds on the existing project shape rather than repeating its fields.

.. CG-EXPLANATION-END id=module-header

Class ``ProjectRestoreResponse``
--------------------------------

.. CG-BLOCK id=class:ProjectRestoreResponse lines=8-25

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/project_restore_response.py
   :language: python
   :lines: 8-25
   :lineno-match:

.. CG-EXPLANATION-START id=class:ProjectRestoreResponse

**What this does.** A restored project's full metadata plus two counts: how many depth-series rows and how many child rows the restore's size caps had to drop. Both default to zero.

**Why it is here.** Restore silently truncates over-large arrays to stay within safety caps; before this schema those drops left only a log line. Carrying the counts back lets the desktop tell the engineer "N rows were too large and were capped". It subclasses the plain response (rather than adding the fields to it) on purpose, so a restore-only field never leaks into the ``.gmproj`` file or the project list, which reuse the plain shape.

.. CG-EXPLANATION-END id=class:ProjectRestoreResponse

