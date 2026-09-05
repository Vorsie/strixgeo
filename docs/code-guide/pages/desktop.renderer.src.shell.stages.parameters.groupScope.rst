desktop.renderer.src.shell.stages.parameters.groupScope
=======================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/parameters/groupScope.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/parameters/groupScope.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-34

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/groupScope.ts
   :language: typescript
   :lines: 1-34
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the file for the one pure helper that turns a selected geotech-body scope into a group scope when that body was joined into a group. It imports the group-membership lookup and the scope type.

**Why it is here.** A "scope" here is what the Parameters canvas is currently looking at — the selection the statistics, header and 3-D cutout all pool. The unit-list tree always selects a single body as its own identity. But joining (owner ruling 2026-09-02: grouping is for lumping similar bodies together so there is more data) means the statistics for that body must pool the WHOLE group. This single hinge does that translation, so the tree can stay body-shaped while the canvas pools the group — everything downstream just reads through the one band-selection authority.

.. CG-EXPLANATION-END id=module-header

``function effectiveGroupScope``
--------------------------------

.. CG-BLOCK id=function:effectiveGroupScope lines=35-48

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/groupScope.ts
   :language: typescript
   :lines: 35-48
   :lineno-match:

.. CG-EXPLANATION-START id=function:effectiveGroupScope

**What this does.** Takes a selected scope and the ``body id → group number`` map, and returns the scope the canvas should actually pool. If the selection is not a single geotech body, or that body is not in a multi-member group, it hands the scope straight back unchanged. Otherwise it returns a ``geotech-group`` scope carrying the group's number and every member body's id.

**Why it is here.** Anything that is not a grouped body is returned as the very same object (the same reference), so a cached computation keyed on the scope does not needlessly recompute. Only a genuinely grouped body is expanded, and it carries all its members' ids because the group's statistics are the union of the members' bands (grouping gives more data — the members keep their own body ids).

.. CG-EXPLANATION-END id=function:effectiveGroupScope

