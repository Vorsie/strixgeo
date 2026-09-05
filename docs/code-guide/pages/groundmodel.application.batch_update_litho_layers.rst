groundmodel.application.batch_update_litho_layers
=================================================

.. CG-PAGE source=src/groundmodel/application/batch_update_litho_layers.py complete=true

*Source file:* ``src/groundmodel/application/batch_update_litho_layers.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-27

.. literalinclude:: ../../../src/groundmodel/application/batch_update_litho_layers.py
   :language: python
   :lines: 1-27
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the batch-update file. It imports the post-commit re-load helper, the layer row and repository, and its docstring says it patches many layers atomically, all-or-nothing.

**Why it is here.** It mirrors the contact-side batch update so the frontend swap preserves the all-or-nothing contract the section editor's multi-drag and cross-column move gestures rely on.

.. CG-EXPLANATION-END id=module-header

Class ``BatchUpdateError``
--------------------------

.. CG-BLOCK id=class:BatchUpdateError lines=28-31

.. literalinclude:: ../../../src/groundmodel/application/batch_update_litho_layers.py
   :language: python
   :lines: 28-31
   :lineno-match:

.. CG-EXPLANATION-START id=class:BatchUpdateError

**What this does.** An error type raised when the batch references unknown layer ids.

**Why it is here.** The router turns it into a 422 (well-formed request, not acceptable).

.. CG-EXPLANATION-END id=class:BatchUpdateError

Class ``BatchUpdateResult``
---------------------------

.. CG-BLOCK id=class:BatchUpdateResult lines=32-39

.. literalinclude:: ../../../src/groundmodel/application/batch_update_litho_layers.py
   :language: python
   :lines: 32-39
   :lineno-match:

.. CG-EXPLANATION-START id=class:BatchUpdateResult

**What this does.** A dataclass carrying the updated count and the updated rows.

**Why it is here.** A plain result the router serialises.

.. CG-EXPLANATION-END id=class:BatchUpdateResult

Class ``BatchUpdateLithoLayers`` — header
-----------------------------------------

.. CG-BLOCK id=class:BatchUpdateLithoLayers lines=40-42

.. literalinclude:: ../../../src/groundmodel/application/batch_update_litho_layers.py
   :language: python
   :lines: 40-42
   :lineno-match:

.. CG-EXPLANATION-START id=class:BatchUpdateLithoLayers

**What this does.** The use case that applies per-row patches to many layers in one transaction.

**Why it is here.** One transaction keeps the multi-row edit atomic.

.. CG-EXPLANATION-END id=class:BatchUpdateLithoLayers

Method ``BatchUpdateLithoLayers``. ``def __init__``
---------------------------------------------------

.. CG-BLOCK id=method:BatchUpdateLithoLayers.__init__ lines=43-48

.. literalinclude:: ../../../src/groundmodel/application/batch_update_litho_layers.py
   :language: python
   :lines: 43-48
   :lineno-match:

.. CG-EXPLANATION-START id=method:BatchUpdateLithoLayers.__init__

**What this does.** Stores the session and builds the litho-layer repository.

**Why it is here.** The repository is the write gateway sharing the session.

.. CG-EXPLANATION-END id=method:BatchUpdateLithoLayers.__init__

Method ``BatchUpdateLithoLayers``. ``async def execute``
--------------------------------------------------------

.. CG-BLOCK id=method:BatchUpdateLithoLayers.execute lines=49-101

.. literalinclude:: ../../../src/groundmodel/application/batch_update_litho_layers.py
   :language: python
   :lines: 49-101
   :lineno-match:

.. CG-EXPLANATION-START id=method:BatchUpdateLithoLayers.execute

**What this does.** Loads every referenced layer, rejects the whole batch if any id is missing, applies each patch in memory, stales the 3-D solids, commits, and re-loads the rows in one query.

**Why it is here.** The all-or-nothing existence check before any mutation is the contract the section editor relies on: one unknown id rejects the batch with no side effects (an IDOR guard, audit #2, when a model scope is given). The single re-load avoids per-row lazy loads of the server-set update timestamp outside the async context.

.. CG-EXPLANATION-END id=method:BatchUpdateLithoLayers.execute

