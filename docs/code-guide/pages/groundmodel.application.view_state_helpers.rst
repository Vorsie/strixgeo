groundmodel.application.view_state_helpers
==========================================

.. CG-PAGE source=src/groundmodel/application/view_state_helpers.py complete=true

*Source file:* ``src/groundmodel/application/view_state_helpers.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-21

.. literalinclude:: ../../../src/groundmodel/application/view_state_helpers.py
   :language: python
   :lines: 1-21
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A shared-readers module whose docstring says it holds the guarded float-knob reader that every builder copy-pasted.

**Why it is here.** The project row carries a free-form settings bag whose sections hold numeric tuning knobs, and every reader repeated the same guarded parse (fall back when absent, non-numeric, or not positive); the parse and the project load live here once (debt #224).

.. CG-EXPLANATION-END id=module-header

Function ``async def load_project_view_state``
----------------------------------------------

.. CG-BLOCK id=function:load_project_view_state lines=22-44

.. literalinclude:: ../../../src/groundmodel/application/view_state_helpers.py
   :language: python
   :lines: 22-44
   :lineno-match:

.. CG-EXPLANATION-START id=function:load_project_view_state

**What this does.** Loads a project's free-form view-state settings bag, or nothing when the project is missing.

**Why it is here.** One place to fetch the settings bag the knob readers work over.

.. CG-EXPLANATION-END id=function:load_project_view_state

Function ``def read_view_state_float``
--------------------------------------

.. CG-BLOCK id=function:read_view_state_float lines=45-78

.. literalinclude:: ../../../src/groundmodel/application/view_state_helpers.py
   :language: python
   :lines: 45-78
   :lineno-match:

.. CG-EXPLANATION-START id=function:read_view_state_float

**What this does.** Reads a positive float knob from a named section and key of the settings bag, falling back to a default on any absent, non-numeric or non-positive value.

**Why it is here.** The exact guard every reader in the family applied, kept in one place so a change to the guard changes one function; callers keep their own defaults and names.

.. CG-EXPLANATION-END id=function:read_view_state_float

