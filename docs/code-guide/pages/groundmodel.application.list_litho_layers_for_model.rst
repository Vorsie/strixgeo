groundmodel.application.list_litho_layers_for_model
===================================================

.. CG-PAGE source=src/groundmodel/application/list_litho_layers_for_model.py complete=true

*Source file:* ``src/groundmodel/application/list_litho_layers_for_model.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-27

.. literalinclude:: ../../../src/groundmodel/application/list_litho_layers_for_model.py
   :language: python
   :lines: 1-27
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the list-layers file. It imports the layer row and its repository, and its docstring says it lists a model's layers with optional filters, sorted shallow-to-deep.

**Why it is here.** Rows are returned sorted by top depth so the renderer draws them top-to-bottom without re-sorting; the project-scope check lives in the router, so this layer trusts the call and just queries.

.. CG-EXPLANATION-END id=module-header

Class ``ListLithoLayersForModel`` — header
------------------------------------------

.. CG-BLOCK id=class:ListLithoLayersForModel lines=28-36

.. literalinclude:: ../../../src/groundmodel/application/list_litho_layers_for_model.py
   :language: python
   :lines: 28-36
   :lineno-match:

.. CG-EXPLANATION-START id=class:ListLithoLayersForModel

**What this does.** The read-only use case that lists a lithostratigraphic model's layers.

**Why it is here.** A geological model carries no litho layers, so calling this against one returns an empty list rather than raising, keeping the router's response shape predictable when the wrong model id is passed.

.. CG-EXPLANATION-END id=class:ListLithoLayersForModel

Method ``ListLithoLayersForModel``. ``def __init__``
----------------------------------------------------

.. CG-BLOCK id=method:ListLithoLayersForModel.__init__ lines=37-42

.. literalinclude:: ../../../src/groundmodel/application/list_litho_layers_for_model.py
   :language: python
   :lines: 37-42
   :lineno-match:

.. CG-EXPLANATION-START id=method:ListLithoLayersForModel.__init__

**What this does.** Stores the session and builds the litho-layer repository.

**Why it is here.** The repository is the query gateway; it shares the session.

.. CG-EXPLANATION-END id=method:ListLithoLayersForModel.__init__

Method ``ListLithoLayersForModel``. ``async def execute``
---------------------------------------------------------

.. CG-BLOCK id=method:ListLithoLayersForModel.execute lines=43-79

.. literalinclude:: ../../../src/groundmodel/application/list_litho_layers_for_model.py
   :language: python
   :lines: 43-79
   :lineno-match:

.. CG-EXPLANATION-START id=method:ListLithoLayersForModel.execute

**What this does.** Lists a model's layers with the optional anchor, formation and status filters, forwarding to the repository.

**Why it is here.** A thin pass-through so the read path has one place for future cross-cutting concerns; the repository returns the rows already sorted.

.. CG-EXPLANATION-END id=method:ListLithoLayersForModel.execute

