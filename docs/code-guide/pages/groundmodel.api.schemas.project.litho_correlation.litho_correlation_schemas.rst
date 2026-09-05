groundmodel.api.schemas.project.litho_correlation.litho_correlation_schemas
===========================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/litho_correlation/litho_correlation_schemas.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/litho_correlation/litho_correlation_schemas.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-22

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_correlation/litho_correlation_schemas.py
   :language: python
   :lines: 1-22
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring noting the file now holds only the admixture-propagation schemas (the formation-level correlation schemas were removed with their router), then imports of ``UUID``, ``BaseModel``, an admixture item schema, a formation response schema, and the strict base.

**Why it is here.** The docstring records that the removed schemas went with the formation-level router in a documented cleanup (#133 Phase 3) — history a reader would otherwise wonder about.

.. CG-EXPLANATION-END id=module-header

Class ``PropagateAdmixturesRequest``
------------------------------------

.. CG-BLOCK id=class:PropagateAdmixturesRequest lines=23-40

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_correlation/litho_correlation_schemas.py
   :language: python
   :lines: 23-40
   :lineno-match:

.. CG-EXPLANATION-START id=class:PropagateAdmixturesRequest

**What this does.** The body to propagate admixtures across a correlated body: any formation in the target body and the new admixture list to write (an empty list clears them).

**Why it is here.** The docstring records that a breadth-first search finds every other formation in the same connected component and applies the admixtures to all — the whole correlated body moves together. It uses the strict base. Admixtures are raw upstream tokens; translation stays in the desktop (translate at the presentation boundary).

.. CG-EXPLANATION-END id=class:PropagateAdmixturesRequest

Class ``PropagateAdmixturesResponse``
-------------------------------------

.. CG-BLOCK id=class:PropagateAdmixturesResponse lines=41-57

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_correlation/litho_correlation_schemas.py
   :language: python
   :lines: 41-57
   :lineno-match:

.. CG-EXPLANATION-START id=class:PropagateAdmixturesResponse

**What this does.** The result: every formation that was updated (the full connected component, each refreshed from the database after commit) and the component size.

**Why it is here.** The refreshed formations let the caller replace its local cache entries directly. The docstring notes the size normally equals the list length, differing only in a defensive should-not-happen case.

.. CG-EXPLANATION-END id=class:PropagateAdmixturesResponse

