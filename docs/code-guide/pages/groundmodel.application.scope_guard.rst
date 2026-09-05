groundmodel.application.scope_guard
===================================

.. CG-PAGE source=src/groundmodel/application/scope_guard.py complete=true

*Source file:* ``src/groundmodel/application/scope_guard.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-28

.. literalinclude:: ../../../src/groundmodel/application/scope_guard.py
   :language: python
   :lines: 1-28
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A small module whose docstring explains it centralises the load-and-check-project step that was hand-rolled at more than twenty-five sites.

**Why it is here.** That check is the cross-project data-leak boundary, so a future tightening (also rejecting archived rows, say) must touch every copy and one miss leaks another project's rows; this is the single source of truth for it (issue #166). It is a pure async helper — no logger, no web framework — raising a plain error the router maps to a not-found or unacceptable status.

.. CG-EXPLANATION-END id=module-header

Function ``async def load_scoped_or_raise``
-------------------------------------------

.. CG-BLOCK id=function:load_scoped_or_raise lines=29-73

.. literalinclude:: ../../../src/groundmodel/application/scope_guard.py
   :language: python
   :lines: 29-73
   :lineno-match:

.. CG-EXPLANATION-START id=function:load_scoped_or_raise

**What this does.** Loads a row by its primary key and asserts it belongs to the given project, returning it or raising when it does not exist or is in another project.

**Why it is here.** Both the missing and wrong-project cases raise the identical message so a caller (or an attacker) cannot tell them apart, which is the point of a project-scope guard (debt #4). The project-id attribute name is a parameter so the one helper serves rows that name it differently.

.. CG-EXPLANATION-END id=function:load_scoped_or_raise

