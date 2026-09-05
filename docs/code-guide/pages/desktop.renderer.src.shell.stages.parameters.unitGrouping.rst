desktop.renderer.src.shell.stages.parameters.unitGrouping
=========================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/parameters/unitGrouping.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/parameters/unitGrouping.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-24

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/unitGrouping.ts
   :language: typescript
   :lines: 1-24
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the file of pure helpers behind the Parameters-pane "Group" / "Ungroup" gesture and imports the union types and the shared "first layer stamped to a body" helper the section canvas uses.

**Why it is here.** The comment records the owner finding (2026-09-03) that grouping should be possible in the Parameters right-hand pane too. The gesture reuses the SAME body-union client the section-canvas Join uses, so this file owns only the label-independent glue around it, kept pure so the React hook stays thin and the pane stays under the 500-line cap (debt #201). The one non-obvious modelling call: a group requires the members be ONE mass, which the canvas Join expresses as "same packing class" — and since each NAD class 1–31 belongs to exactly one soil family (from ``nadClasses.ts``, e.g. classes 13–20 are all SILT), "same NAD class" already implies "same soil", so the guard keys on the class alone and the engine's own cross-class refusal stays the final authority.

.. CG-EXPLANATION-END id=module-header

``type GroupGuardStatus``
-------------------------

.. CG-BLOCK id=type:GroupGuardStatus lines=25-51

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/unitGrouping.ts
   :language: typescript
   :lines: 25-51
   :lineno-match:

.. CG-EXPLANATION-START id=type:GroupGuardStatus

**What this does.** A type with three possible values describing whether a ticked selection may be grouped: ``ok`` (two or more bodies, all one class), ``need-two`` (fewer than two ticked), or ``cross-class`` (the ticked bodies span more than one class).

**Why it is here.** A named three-way status lets the bar say precisely why the Group button is disabled — the two failure reasons carry different hints — rather than a bare enabled/disabled flag that leaves the engineer guessing.

.. CG-EXPLANATION-END id=type:GroupGuardStatus

``function bodyNadClassMap``
----------------------------

.. CG-BLOCK id=function:bodyNadClassMap lines=52-91

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/unitGrouping.ts
   :language: typescript
   :lines: 52-91
   :lineno-match:

.. CG-EXPLANATION-START id=function:bodyNadClassMap

**What this does.** Builds a map from geotech body id to its NAD class, by first mapping each geotech formation to its class, then walking the accepted geotech layers and recording the first class seen for each stamped body.

**Why it is here.** A geotech body is class-homogeneous by construction — the engine's resolver splits by class — so the first accepted band's class stands for the whole body. Pending (not-yet-accepted) bands are never a class source. This map feeds the same-class group guard.

.. CG-EXPLANATION-END id=function:bodyNadClassMap

``function anchorLayersForBodies``
----------------------------------

.. CG-BLOCK id=function:anchorLayersForBodies lines=92-131

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/unitGrouping.ts
   :language: typescript
   :lines: 92-131
   :lineno-match:

.. CG-EXPLANATION-START id=function:anchorLayersForBodies

**What this does.** For each requested body, finds its anchor — the body's first accepted stamped layer id — by walking the accepted geotech layers once and handing each body to the shared "first layer stamped to a body" helper. Bodies with no accepted stamped band are omitted.

**Why it is here.** The anchor is the same label-independent identity currency the section-canvas Join uses, so a body always joins through the same anchor whichever surface fires the verb — the pane and the canvas can never disagree about which layer represents a body. A body with no stamped band is left out rather than given an invented anchor.

.. CG-EXPLANATION-END id=function:anchorLayersForBodies

``function groupUnionPairs``
----------------------------

.. CG-BLOCK id=function:groupUnionPairs lines=132-167

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/unitGrouping.ts
   :language: typescript
   :lines: 132-167
   :lineno-match:

.. CG-EXPLANATION-START id=function:groupUnionPairs

**What this does.** Turns a set of bodies into the anchor pairs needed to link them into one group: it collects each body's anchor, drops those without one, and if two or more remain it returns a "star" of pairs from the first anchor to every other. Fewer than two anchored bodies yields no pairs.

**Why it is here.** A union is a PAIR of anchors, but "these N bodies are one group" is a connected set. A star from one head anchor — head-to-each-other — produces one connected component in N minus one requests, the cheapest way to join N things without recording every pairwise link. Bodies without a resolved anchor simply drop out.

.. CG-EXPLANATION-END id=function:groupUnionPairs

``function groupGuardStatus``
-----------------------------

.. CG-BLOCK id=function:groupGuardStatus lines=168-199

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/unitGrouping.ts
   :language: typescript
   :lines: 168-199
   :lineno-match:

.. CG-EXPLANATION-START id=function:groupGuardStatus

**What this does.** Decides whether a ticked selection may be grouped: fewer than two bodies is ``need-two``; two or more spanning more than one KNOWN class is ``cross-class``; otherwise ``ok``. A body whose class is not yet known does not count against the guard.

**Why it is here.** A body whose class is unknown (a roster still loading) never blocks the group — it matches the canvas rule that a missing class lets the engine's write guard decide. This is safe because a label difference always implies a class difference, so an unknown class can never hide a real cross-class that the engine would then wrongly accept.

.. CG-EXPLANATION-END id=function:groupGuardStatus

``function unionIdsAnchoringBody``
----------------------------------

.. CG-BLOCK id=function:unionIdsAnchoringBody lines=200-231

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/unitGrouping.ts
   :language: typescript
   :lines: 200-231
   :lineno-match:

.. CG-EXPLANATION-START id=function:unionIdsAnchoringBody

**What this does.** Given a body and the model's unions, returns every union id that references that body on either anchor side, de-duplicated.

**Why it is here.** Removing a body from its group means lifting every union that touches it; the remaining members stay connected through their other unions. This reuses the same delete path as the canvas "Un-join from {label}" verb, so Ungroup in the pane behaves exactly like un-joining on the section canvas.

.. CG-EXPLANATION-END id=function:unionIdsAnchoringBody

``function selectedNadClasses``
-------------------------------

.. CG-BLOCK id=function:selectedNadClasses lines=232-242

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/unitGrouping.ts
   :language: typescript
   :lines: 232-242
   :lineno-match:

.. CG-EXPLANATION-START id=function:selectedNadClasses

**What this does.** Returns the distinct KNOWN NAD class numbers in a ticked selection, sorted ascending.

**Why it is here.** It feeds the cross-class refusal hint so the bar names the offending classes in words rather than a bare "same packing class"; the pane maps these numbers to names at the presentation boundary. A body whose class is unknown contributes nothing — the same bodies the guard itself skips — so the named hint and the guard never disagree about what is selected.

.. CG-EXPLANATION-END id=function:selectedNadClasses

