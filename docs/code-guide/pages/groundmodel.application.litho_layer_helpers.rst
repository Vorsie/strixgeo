groundmodel.application.litho_layer_helpers
===========================================

.. CG-PAGE source=src/groundmodel/application/litho_layer_helpers.py complete=true

*Source file:* ``src/groundmodel/application/litho_layer_helpers.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-16

.. literalinclude:: ../../../src/groundmodel/application/litho_layer_helpers.py
   :language: python
   :lines: 1-16
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A small shared-helpers module whose docstring says it holds the post-commit re-load loop that was copy-pasted across the bulk-create and batch-update use cases.

**Why it is here.** Extracted per the extract-on-second-copy rule; each old copy issued one query round-trip per row, and the shared version does it in one.

.. CG-EXPLANATION-END id=module-header

Function ``async def repopulate_layers_after_commit``
-----------------------------------------------------

.. CG-BLOCK id=function:repopulate_layers_after_commit lines=17-45

.. literalinclude:: ../../../src/groundmodel/application/litho_layer_helpers.py
   :language: python
   :lines: 17-45
   :lineno-match:

.. CG-EXPLANATION-START id=function:repopulate_layers_after_commit

**What this does.** Re-loads a set of just-committed layer rows in one query, or does nothing for an empty list.

**Why it is here.** Server-set timestamp columns are expired at commit, and the response serialiser would otherwise lazy-load them outside the async context and raise a MissingGreenlet error; one populate-existing query refreshes every row at once instead of one refresh per row.

.. CG-EXPLANATION-END id=function:repopulate_layers_after_commit

