desktop.renderer.src.utils.geotechHandEdits
===========================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotechHandEdits.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotechHandEdits.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-39

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHandEdits.ts
   :language: typescript
   :lines: 1-39
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file answers two questions the "Subdivide CPTs" confirmation needs: how many packing bands did the engineer place by hand, and which of them is this press about to destroy? The comment explains that the verb is destructive — it deletes the geotech data it rebuilds and re-derives every band from the CPT data, so any split or merge the engineer made by hand there disappears on the next run — so the dialog must be able to name how many are at stake before he commits. Since 2026-08-15 the verb is section-scoped, so "at stake" is narrowed to the press's own columns first. It imports the layer-row type.

**Why it is here.** This is the platform's irreversible-action rule in service: an overwrite that destroys hand-placed work needs a confirmation that names what is at stake, not a bare warning. The comment records why the source field is the right test: the automated subdivide and divide passes stamp every layer they write as "segmenter", and the split/merge commits are the only writers that stamp "manual" on a geotech model, while the remaining allowed source values are borehole-log provenance written only by the litho accept flow and are distinct values besides — so the manual test can neither miss a hand edit nor inflate the count.

.. CG-EXPLANATION-END id=module-header

``function countGeotechHandEdits``
----------------------------------

.. CG-BLOCK id=function:countGeotechHandEdits lines=40-73

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHandEdits.ts
   :language: typescript
   :lines: 40-73
   :lineno-match:

.. CG-EXPLANATION-START id=function:countGeotechHandEdits

**What this does.** Counts how many of a geotech model's layer rows were placed by hand, by tallying the rows whose source is "manual".

**Why it is here.** The docstring notes this counts bands, not gestures — a split leaves two hand-placed bands, a merge leaves one — because it is the bands that will be destroyed and rebuilt, so bands are the honest figure to quote in the dialog.

.. CG-EXPLANATION-END id=function:countGeotechHandEdits

``function geotechBandsInScope``
--------------------------------

.. CG-BLOCK id=function:geotechBandsInScope lines=74-83

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHandEdits.ts
   :language: typescript
   :lines: 74-83
   :lineno-match:

.. CG-EXPLANATION-START id=function:geotechBandsInScope

**What this does.** Narrows a geotech model's bands to the ones a scoped subdivide will rebuild: given the set of investigation ids the press will touch, it keeps only the bands whose anchor investigation (its CPT or borehole) is in that set. Passing nothing means the whole-model press, where every band is in scope.

**Why it is here.** The docstring records the dogfeed bug that forced it (2026-08-15): a whole-model warning fired on a section that had no subdivision yet and quoted a number belonging to a different section. A band is in scope exactly when its anchor investigation is a member of the section being subdivided — deliberately the same membership rule the verb itself uses — so the warning measures precisely what the press will rebuild. An empty result means the press destroys nothing and the caller must not raise a confirmation at all, which is the reversible-vs-irreversible rule again: no destruction, no dialog.

.. CG-EXPLANATION-END id=function:geotechBandsInScope

