groundmodel.application.bulk_create_litho_layers
================================================

.. CG-PAGE source=src/groundmodel/application/bulk_create_litho_layers.py complete=true

*Source file:* ``src/groundmodel/application/bulk_create_litho_layers.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-34

.. literalinclude:: ../../../src/groundmodel/application/bulk_create_litho_layers.py
   :language: python
   :lines: 1-34
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the bulk-create file. It imports the body-partition locks, the post-commit re-load helper, the scope guard, and the layer row, and its docstring describes the intended caller.

**Why it is here.** The intended caller is the suggest flow: the segmenter produces a list of pending layers and this use case persists them all in one round-trip. There is no find-or-create — the suggest flow always inserts fresh — so a caller wanting idempotency clears the model first.

.. CG-EXPLANATION-END id=module-header

Class ``LithoLayerCreateRequest``
---------------------------------

.. CG-BLOCK id=class:LithoLayerCreateRequest lines=35-52

.. literalinclude:: ../../../src/groundmodel/application/bulk_create_litho_layers.py
   :language: python
   :lines: 35-52
   :lineno-match:

.. CG-EXPLANATION-START id=class:LithoLayerCreateRequest

**What this does.** A dataclass carrying one layer's fields for the bulk create, with sensible defaults for status, source and confidence.

**Why it is here.** A plain per-layer payload so the caller lists what to insert without touching the ORM directly.

.. CG-EXPLANATION-END id=class:LithoLayerCreateRequest

Class ``BulkCreateLithoLayers`` — header
----------------------------------------

.. CG-BLOCK id=class:BulkCreateLithoLayers lines=53-55

.. literalinclude:: ../../../src/groundmodel/application/bulk_create_litho_layers.py
   :language: python
   :lines: 53-55
   :lineno-match:

.. CG-EXPLANATION-START id=class:BulkCreateLithoLayers

**What this does.** The use case that inserts many layer rows and commits.

**Why it is here.** One transaction for the whole column saves N inserts plus N flushes for a typical 20-layer column.

.. CG-EXPLANATION-END id=class:BulkCreateLithoLayers

Method ``BulkCreateLithoLayers``. ``def __init__``
--------------------------------------------------

.. CG-BLOCK id=method:BulkCreateLithoLayers.__init__ lines=56-60

.. literalinclude:: ../../../src/groundmodel/application/bulk_create_litho_layers.py
   :language: python
   :lines: 56-60
   :lineno-match:

.. CG-EXPLANATION-START id=method:BulkCreateLithoLayers.__init__

**What this does.** Stores the session.

**Why it is here.** The caller owns the session; this use case writes through it.

.. CG-EXPLANATION-END id=method:BulkCreateLithoLayers.__init__

Method ``BulkCreateLithoLayers``. ``async def execute``
-------------------------------------------------------

.. CG-BLOCK id=method:BulkCreateLithoLayers.execute lines=61-166

.. literalinclude:: ../../../src/groundmodel/application/bulk_create_litho_layers.py
   :language: python
   :lines: 61-166
   :lineno-match:

.. CG-EXPLANATION-START id=method:BulkCreateLithoLayers.execute

**What this does.** Optionally scope-guards every formation id against the project, takes the body-partition locks, inserts every layer, commits, and re-loads the rows in one query.

**Why it is here.** The scope guard, run before any write, refuses a cross-project formation id rather than silently accepting it (debt #211-a), deduplicating the ids so shared formations are checked once. The locks are taken after the guard and before the first insert, litho then geotech child, so the inserts serialise with a background recompute rather than deadlocking. The re-load exists so the response serialiser does not lazy-load the server-set timestamps outside the async context.

.. CG-EXPLANATION-END id=method:BulkCreateLithoLayers.execute

