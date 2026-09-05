desktop.renderer.src.utils.geotechLegendTree
============================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotechLegendTree.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotechLegendTree.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-69

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechLegendTree.ts
   :language: typescript
   :lines: 1-69
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file builds the nested soil ▸ NAD class ▸ body tree that the 3-D Layers legend shows. The comment explains why a tree: a geotech model splits every litho unit into packing classes, so a flat legend degenerates into dozens of rows reading "SAND, SAND, SAND" separated only by near-adjacent shades — unreadable and useless as a visibility control. Three levels fix it (soil family, NAD class labelled by density or firmness, and individual body). It also documents the "what exists" rule: only what the current view mode actually paints gets a row — solids in solid mode, wall panels in fence mode — because a row whose eye changes nothing reads as a model the engineer failed to build. It imports the colour-override helper, the litho label helpers, and the NAD class helpers.

**Why it is here.** The reasons are the owner rulings recorded in the comment (2026-08-26, with the mockup): dozens of identical rows are noise, and a row for something the scene does not paint reads as a failure rather than as nothing. The module is pure — formations and solids in, tree out, no React, Cesium or input/output — so the presentation lives in the tree component. It also states the translate-at-the-presentation-boundary rule explicitly: the soil code stays the raw DOV token in the domain, and the label helpers are the lookup that turns it into English here. The NAD class it groups by is a Belgian-annex characterisation label (NBN EN 1997-1 ANB Tabel 2.1), used only to organise and colour the legend.

.. CG-EXPLANATION-END id=module-header

``const UNCLASSIFIED_CLASS_LABEL``
----------------------------------

.. CG-BLOCK id=const:UNCLASSIFIED_CLASS_LABEL lines=70-72

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechLegendTree.ts
   :language: typescript
   :lines: 70-72
   :lineno-match:

.. CG-EXPLANATION-START id=const:UNCLASSIFIED_CLASS_LABEL

**What this does.** The label for a geotech unit that carries no NAD class yet — the borehole-only "(geotech)" skeletons: "not yet classified".

**Why it is here.** Such a unit is real ground and gets a row on the same terms as any other — when the scene paints it — so once built the row is a prompt to go classify it; with nothing built it is an empty bin and is dropped like any other row.

.. CG-EXPLANATION-END id=const:UNCLASSIFIED_CLASS_LABEL

``const UNKNOWN_FAMILY_LABEL``
------------------------------

.. CG-BLOCK id=const:UNKNOWN_FAMILY_LABEL lines=73-75

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechLegendTree.ts
   :language: typescript
   :lines: 73-75
   :lineno-match:

.. CG-EXPLANATION-START id=const:UNKNOWN_FAMILY_LABEL

**What this does.** The family-row label used when a unit carries neither a soil code nor a class: "Unclassified".

**Why it is here.** There must be a name for the bucket that collects units with no identifying attribute at all.

.. CG-EXPLANATION-END id=const:UNKNOWN_FAMILY_LABEL

``const UNKNOWN_FAMILY_RANK``
-----------------------------

.. CG-BLOCK id=const:UNKNOWN_FAMILY_RANK lines=76-83

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechLegendTree.ts
   :language: typescript
   :lines: 76-83
   :lineno-match:

.. CG-EXPLANATION-START id=const:UNKNOWN_FAMILY_RANK

**What this does.** A sort rank, set to the largest safe integer, for a family not found in the known soil order.

**Why it is here.** Since the lookup returns -1 for an unknown family, mapping that to the largest value sorts strangers after every known family rather than before them.

.. CG-EXPLANATION-END id=const:UNKNOWN_FAMILY_RANK

``interface GeotechLegendFormationInput``
-----------------------------------------

.. CG-BLOCK id=interface:GeotechLegendFormationInput lines=84-95

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechLegendTree.ts
   :language: typescript
   :lines: 84-95
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeotechLegendFormationInput

**What this does.** Describes the formation fields the legend reads: id, name, colour, NAD class, litho soil code, admixtures, and the colour the engineer may have picked for the unit.

**Why it is here.** It is a structural subset of the full API type so the builder can be exercised in tests without constructing a whole formation response.

.. CG-EXPLANATION-END id=interface:GeotechLegendFormationInput

``interface GeotechLegendSolidInput``
-------------------------------------

.. CG-BLOCK id=interface:GeotechLegendSolidInput lines=96-113

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechLegendTree.ts
   :language: typescript
   :lines: 96-113
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeotechLegendSolidInput

**What this does.** Describes the body-solid fields the legend reads: the body id, its formation, its ordinal, its triangle mesh (only the length matters), its display colour and whether it is flagged.

**Why it is here.** Only the mesh length matters because an empty mesh is a body the viewer never paints, so it must not earn a legend row; the rest identify and colour the leaf row.

.. CG-EXPLANATION-END id=interface:GeotechLegendSolidInput

``interface GeotechLegendPanelInput``
-------------------------------------

.. CG-BLOCK id=interface:GeotechLegendPanelInput lines=114-124

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechLegendTree.ts
   :language: typescript
   :lines: 114-124
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeotechLegendPanelInput

**What this does.** Describes the fence-panel fields the legend reads: the formation id (in camelCase) and the wall's triangle mesh (again only the length matters).

**Why it is here.** The docstring records that fence walls are built in the renderer and never crossed the snake_case API boundary, so keeping each source's own spelling lets the caller pass its arrays straight through with no remapping to get wrong.

.. CG-EXPLANATION-END id=interface:GeotechLegendPanelInput

``interface GeotechLegendBodyNode``
-----------------------------------

.. CG-BLOCK id=interface:GeotechLegendBodyNode lines=125-134

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechLegendTree.ts
   :language: typescript
   :lines: 125-134
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeotechLegendBodyNode

**What this does.** Describes a leaf row — one built body solid: its body id, its formation, its label (just "#3", or the unit name plus "#3" when the class row spans several units), its colour, and whether it is flagged.

**Why it is here.** This is the smallest thing the legend's eye can isolate — a single built body — so it carries exactly what the row needs to name and colour it.

.. CG-EXPLANATION-END id=interface:GeotechLegendBodyNode

``interface GeotechLegendClassNode``
------------------------------------

.. CG-BLOCK id=interface:GeotechLegendClassNode lines=135-152

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechLegendTree.ts
   :language: typescript
   :lines: 135-152
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeotechLegendClassNode

**What this does.** Describes a middle row — one NAD packing class within a soil family: a stable key, the class number (which may be absent), its density/firmness label, its colour, its body count, the formation ids under it, and its body leaf rows.

**Why it is here.** The label is density or firmness only so the row never repeats its family's soil word — except a class from a different soil family, which states its own full name so the composed line stays a class that really exists. The formation ids are carried so the row's eye can toggle every unit under it at once.

.. CG-EXPLANATION-END id=interface:GeotechLegendClassNode

``interface GeotechLegendFamilyNode``
-------------------------------------

.. CG-BLOCK id=interface:GeotechLegendFamilyNode lines=153-176

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechLegendTree.ts
   :language: typescript
   :lines: 153-176
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeotechLegendFamilyNode

**What this does.** Describes a top row — one soil family: a stable key (the raw soil code), a label, a colour, a body count, the formation ids under it, and its class rows.

**Why it is here.** The family is the level at which the eye hides a whole soil group, so it carries all its formation ids and its child class rows.

.. CG-EXPLANATION-END id=interface:GeotechLegendFamilyNode

``function familyLabelOf``
--------------------------

.. CG-BLOCK id=function:familyLabelOf lines=177-184

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechLegendTree.ts
   :language: typescript
   :lines: 177-184
   :lineno-match:

.. CG-EXPLANATION-START id=function:familyLabelOf

**What this does.** Returns the display family label for a unit: its soil code translated to the active language, or failing that its class's soil word, or the unknown-family label.

**Why it is here.** This is the label the user reads, so it follows the interface language toggle; the docstring stresses it must never be conflated with the English key used for sorting.

.. CG-EXPLANATION-END id=function:familyLabelOf

``function familyLabelEnOf``
----------------------------

.. CG-BLOCK id=function:familyLabelEnOf lines=185-192

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechLegendTree.ts
   :language: typescript
   :lines: 185-192
   :lineno-match:

.. CG-EXPLANATION-START id=function:familyLabelEnOf

**What this does.** Returns the English, language-stable family label for a unit — the same choices as the display version but always in English.

**Why it is here.** The grouping order and the "is this class a stranger to this family" test must not move when the interface language changes, so they run on this fixed English key rather than the translated label.

.. CG-EXPLANATION-END id=function:familyLabelEnOf

``function unitLabelOf``
------------------------

.. CG-BLOCK id=function:unitLabelOf lines=193-224

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechLegendTree.ts
   :language: typescript
   :lines: 193-224
   :lineno-match:

.. CG-EXPLANATION-START id=function:unitLabelOf

**What this does.** Returns a unit's own display name — its soil code with its admixtures in the active language, or its formation name when it has no soil code.

**Why it is here.** When a class row spans several units the body leaf needs to name its unit, and this gives that name in the language the user reads.

.. CG-EXPLANATION-END id=function:unitLabelOf

``function classRowLabel``
--------------------------

.. CG-BLOCK id=function:classRowLabel lines=225-231

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechLegendTree.ts
   :language: typescript
   :lines: 225-231
   :lineno-match:

.. CG-EXPLANATION-START id=function:classRowLabel

**What this does.** Chooses the text for a class row under a given family: the bare packing phrase (like "medium dense") when the class belongs to that family's soil, but the class's own full name when it is a stranger to the family.

**Why it is here.** The docstring records the subtlety. The tree reads as a sentence — family names the soil, class names the packing — so the bare qualifier is only honest while the class belongs to its family. The two can disagree because the family word comes from the litho soil code and the qualifier from the NAD class, and the subdivide step can assign a borehole-only sub-body the nearest cone of any lithology; a sand unit carrying a firmness class would compose into "moderately firm sand", which the norm does not contain (owner ruling 2026-08-26, granular soils are described by density and cohesive soils by firmness, never the other way round). A stranger therefore states its own full class name so the line the user reads is always a class that exists, while keeping its place under the litho body it subdivides. The comparison runs English-to-English so it can never be broken by the interface language.

.. CG-EXPLANATION-END id=function:classRowLabel

``function compareClassKeys``
-----------------------------

.. CG-BLOCK id=function:compareClassKeys lines=232-274

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechLegendTree.ts
   :language: typescript
   :lines: 232-274
   :lineno-match:

.. CG-EXPLANATION-START id=function:compareClassKeys

**What this does.** Orders two class numbers ascending, with the unclassified (absent) class sorting last.

**Why it is here.** Classes read best low-to-high, and the unclassified row is the remainder so it belongs at the bottom of its family.

.. CG-EXPLANATION-END id=function:compareClassKeys

``function buildGeotechLegendTree``
-----------------------------------

.. CG-BLOCK id=function:buildGeotechLegendTree lines=275-417

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechLegendTree.ts
   :language: typescript
   :lines: 275-417
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildGeotechLegendTree

**What this does.** Groups the geotech formations and their built solids into the legend tree. It notes which formations have a fence wall (only in fence mode); indexes the non-empty solids per formation, ordinal-ascending; buckets formations by soil family and then by NAD class in one pass; then for each family builds its class rows (colour from the engineer's pick or the class ramp, body leaves named by unit when the row spans several units), keeps only the classes the current mode paints (bodies in solid mode, walls in fence mode), drops any family left with no class, picks the family swatch from its dominant class, and finally sorts families by the norm's geological soil order with strangers last.

**Why it is here.** Every step serves a documented rule. Two litho units subdivided to the same class share one class row — that merge is the whole point — and the row carries both formation ids so its eye hides both. Counts are body counts because the legend controls what the scene paints, and a class the model contains but has not built is not listed at all. The engineer's colour pick must win in the legend too or the swatch stops identifying its body, and the family swatch takes the dominant class's hue because within a family the palette is a single-hue lightness ramp. Families are ranked by the English soil word so a Dutch interface still sorts them in the norm's geological order rather than alphabetically. The tree deliberately changes shape when the view mode flips, because each mode describes what that mode draws.

.. CG-EXPLANATION-END id=function:buildGeotechLegendTree

