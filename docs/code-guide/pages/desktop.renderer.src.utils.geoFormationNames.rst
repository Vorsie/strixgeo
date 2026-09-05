desktop.renderer.src.utils.geoFormationNames
============================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geoFormationNames.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geoFormationNames.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-40

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geoFormationNames.ts
   :language: typescript
   :lines: 1-40
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file builds a lookup from each geotech unit to the names of the geological formations that unit's bodies cross. The comment explains why: a single body may span geological-formation boundaries, so its geological attribution is a list, not one majority stamp (owner ruling 2026-08-31); the bodies response carries that list per body, shallowest formation first, but the units pane works one level up at the unit a class row stands for, and one unit is made of several bodies. So the per-body lists are folded onto the unit once here rather than re-scanned per row.

**Why it is here.** The reason is recorded in the comment. The units pane needs to list the crossed formations (debt #278), and folding the bodies' lists into a per-unit map once — the same shape as the sibling ``sourceLithoNames`` builder — lets the roster memoise it and hand it to the pure tree builder, rather than recomputing per row. It also notes that a wrong result here is quiet rather than loud (a missing entry just drops one subtitle), which is why the safety net is a unit test rather than an on-screen check.

.. CG-EXPLANATION-END id=module-header

``function buildGeoFormationNamesByUnit``
-----------------------------------------

.. CG-BLOCK id=function:buildGeoFormationNamesByUnit lines=41-58

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geoFormationNames.ts
   :language: typescript
   :lines: 41-58
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildGeoFormationNamesByUnit

**What this does.** Walks every body in the model. For each body it reads its list of crossed geological formations; if that list is missing or empty it skips the body. Otherwise it finds (or starts) the name list for that body's geotech unit and appends each crossed formation's name that is not already there. The result is a map from geotech unit id to the de-duplicated list of formation names it crosses.

**Why it is here.** Several bodies share one unit, so their lists are unioned; keeping only the first appearance of each name preserves both each body's shallowest-first order and the order the bodies come in. A body that crosses nothing — or whose response predates the field — contributes nothing, so a unit with no crossing simply has no entry rather than an empty one, which is what lets the caller tell "no crossings" apart from "crossings not loaded".

.. CG-EXPLANATION-END id=function:buildGeoFormationNamesByUnit

