groundmodel.application.resolve_litho_instances_use_case
========================================================

.. CG-PAGE source=src/groundmodel/application/resolve_litho_instances_use_case.py complete=true

*Source file:* ``src/groundmodel/application/resolve_litho_instances_use_case.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-64

.. literalinclude:: ../../../src/groundmodel/application/resolve_litho_instances_use_case.py
   :language: python
   :lines: 1-64
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the resolve-instances file. It imports the body-partition locks, the pure resolver and its node/edge/separation types, and the many body-related database rows, and its docstring describes what the resolver does.

**Why it is here.** The docstring records the design: it loads accepted layers and approved correlation edges, runs the pure resolver, reconciles one body row per connected component, stamps each layer's body id, and stales changed surfaces — and that body identity, the formation and ordinal pair, is now the durable record of an instance, not a written instance ordinal. It is model-level only and never touches section state, so the recurring seeded-array trap structurally cannot happen here.

.. CG-EXPLANATION-END id=module-header

Class ``_BodyChange``
---------------------

.. CG-BLOCK id=class:_BodyChange lines=65-83

.. literalinclude:: ../../../src/groundmodel/application/resolve_litho_instances_use_case.py
   :language: python
   :lines: 65-83
   :lineno-match:

.. CG-EXPLANATION-START id=class:_BodyChange

**What this does.** A typed dictionary for one body whose ordinal was created or removed during reconciliation, carrying the formation id and the new ordinal.

**Why it is here.** The shape is kept stable so the outer use case can map it onto the update the section stale-cue consumes.

.. CG-EXPLANATION-END id=class:_BodyChange

Class ``OrdinalUpdate``
-----------------------

.. CG-BLOCK id=class:OrdinalUpdate lines=84-113

.. literalinclude:: ../../../src/groundmodel/application/resolve_litho_instances_use_case.py
   :language: python
   :lines: 84-113
   :lineno-match:

.. CG-EXPLANATION-START id=class:OrdinalUpdate

**What this does.** A dataclass reporting one body whose reconciliation created or removed an ordinal.

**Why it is here.** The resolver reconciles body rows rather than writing an instance ordinal, but the field names are kept unchanged because the API schema and the frontend badge consume them (a do-not-rename note).

.. CG-EXPLANATION-END id=class:OrdinalUpdate

Class ``ResolveResult``
-----------------------

.. CG-BLOCK id=class:ResolveResult lines=114-150

.. literalinclude:: ../../../src/groundmodel/application/resolve_litho_instances_use_case.py
   :language: python
   :lines: 114-150
   :lineno-match:

.. CG-EXPLANATION-START id=class:ResolveResult

**What this does.** A dataclass for the resolver's output: the list of body changes, the names displaced by lineage adoption, and two always-empty union tuples.

**Why it is here.** The union tuples are always empty since owner 2026-09-02, when a join became a group relation rather than a merge, so the resolver is passed no unions and never marks one inert; the tuples are kept empty for schema stability as a defensive backstop.

.. CG-EXPLANATION-END id=class:ResolveResult

Function ``async def _run_resolver``
------------------------------------

.. CG-BLOCK id=function:_run_resolver lines=151-682

.. literalinclude:: ../../../src/groundmodel/application/resolve_litho_instances_use_case.py
   :language: python
   :lines: 151-682
   :lineno-match:

.. CG-EXPLANATION-START id=function:_run_resolver

**What this does.** The single canonical resolver run: it takes the model's body-partition lock and every sibling geotech lock, loads accepted layers and their formations, approved correlation edges, geometry facts and separations, runs the pure resolver, reconciles body rows, adopts names and colours along lineage, deletes unnamed orphan bodies, stamps each layer's body id in one update per body, stamps each geotech body's litho parent, stales surfaces and solids, and re-stamps sibling geotech parents.

**Why it is here.** The lock is taken first and held to the caller's commit so the read and the rewrite are one serialised unit; without it two concurrent resolves produced unique-violation, foreign-key and deadlock failures. The sibling geotech locks are taken up front because deleting a litho body fires a set-null cascade that hidden-writes the geotech rows, and taking that lock late caused an ABBA deadlock. Facts union like ties because they record observed adjacency a tie cannot state; separations are cannot-link constraints only the engineer writes; a join is a group relation and is deliberately NOT fed as a must-link (owner 2026-09-02). Lineage adoption implements oldest-name-wins (owner 2026-08-12) so a rename follows the body, not the recycled row. Solids are staled except on a body-identity-only resolve, where the voxel geometry is unchanged (owner 2026-09-01).

.. CG-EXPLANATION-END id=function:_run_resolver

Class ``_RunResolverLogger`` — header
-------------------------------------

.. CG-BLOCK id=class:_RunResolverLogger lines=683-685

.. literalinclude:: ../../../src/groundmodel/application/resolve_litho_instances_use_case.py
   :language: python
   :lines: 683-685
   :lineno-match:

.. CG-EXPLANATION-START id=class:_RunResolverLogger

**What this does.** A tiny logger class for the module-level resolver helper.

**Why it is here.** The free function is not a class, so it borrows a logger instance to keep its lines named after this module, matching the project logging convention.

.. CG-EXPLANATION-END id=class:_RunResolverLogger

Method ``_RunResolverLogger``. ``def __init__``
-----------------------------------------------

.. CG-BLOCK id=method:_RunResolverLogger.__init__ lines=686-690

.. literalinclude:: ../../../src/groundmodel/application/resolve_litho_instances_use_case.py
   :language: python
   :lines: 686-690
   :lineno-match:

.. CG-EXPLANATION-START id=method:_RunResolverLogger.__init__

**What this does.** Sets up the module-named logger.

**Why it is here.** Same convention: log lines read as coming from this module.

.. CG-EXPLANATION-END id=method:_RunResolverLogger.__init__

Class ``ResolveLithoInstances`` — header
----------------------------------------

.. CG-BLOCK id=class:ResolveLithoInstances lines=691-703

.. literalinclude:: ../../../src/groundmodel/application/resolve_litho_instances_use_case.py
   :language: python
   :lines: 691-703
   :lineno-match:

.. CG-EXPLANATION-START id=class:ResolveLithoInstances

**What this does.** The use case wrapper that re-runs the resolver for one model and commits.

**Why it is here.** It is the single canonical copy; other litho verbs delegate to it through the shared free function, so the resolution logic exists in one place.

.. CG-EXPLANATION-END id=class:ResolveLithoInstances

Method ``ResolveLithoInstances``. ``def __init__``
--------------------------------------------------

.. CG-BLOCK id=method:ResolveLithoInstances.__init__ lines=704-708

.. literalinclude:: ../../../src/groundmodel/application/resolve_litho_instances_use_case.py
   :language: python
   :lines: 704-708
   :lineno-match:

.. CG-EXPLANATION-START id=method:ResolveLithoInstances.__init__

**What this does.** Stores the session.

**Why it is here.** The caller owns the session; this use case runs the resolver on it.

.. CG-EXPLANATION-END id=method:ResolveLithoInstances.__init__

Method ``ResolveLithoInstances``. ``async def execute``
-------------------------------------------------------

.. CG-BLOCK id=method:ResolveLithoInstances.execute lines=709-797

.. literalinclude:: ../../../src/groundmodel/application/resolve_litho_instances_use_case.py
   :language: python
   :lines: 709-797
   :lineno-match:

.. CG-EXPLANATION-START id=method:ResolveLithoInstances.execute

**What this does.** Runs the resolver on the model, commits or flushes depending on who owns the transaction, maps the raw changes into ordinal updates, and reports displaced names.

**Why it is here.** The commit switch lets a caller inside a bigger litho operation land everything in one transaction. Displaced-name counts are logged always-on while the names themselves stay at debug, because a unit name can echo a site and the log on disk is unredacted. It is model-level only, so the seeded-array trap cannot recur.

.. CG-EXPLANATION-END id=method:ResolveLithoInstances.execute

