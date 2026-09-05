desktop.renderer.src.shell.stages.parameters.parameterBodyTree
==============================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/parameters/parameterBodyTree.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/parameters/parameterBodyTree.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-39

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/parameterBodyTree.ts
   :language: typescript
   :lines: 1-39
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the file that is the ONE authority for the Parameters body tree and imports what it needs: the formation and layer response types, the NAD class-name helper, the scope type, the body-roster entry type, and the two body-label helpers.

**Why it is here.** A tree here is the nested roster shown in the unit list; a node is one row in it. The header quotes the owner rulings this module implements: body identity comes only from the engine's resolver (this module only READS the ``body_id`` stamps, it never resolves), and the tree shape is litho unit, then litho body, then a NAD class row, then geotech body (variant B, 2026-08-27). Its single most important promise is that ``bandsForScope`` is the one band-selection authority every consumer — statistics, populations, grain-size and identification plots, the 3-D cutout body set, the row counts — routes through, so no consumer ever branches on the scope kind itself.

.. CG-EXPLANATION-END id=module-header

``interface ParameterTreeInput``
--------------------------------

.. CG-BLOCK id=interface:ParameterTreeInput lines=40-62

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/parameterBodyTree.ts
   :language: typescript
   :lines: 40-62
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ParameterTreeInput

**What this does.** Names everything the tree builder and ``bandsForScope`` read: the litho and geotech formation rows, every litho and geotech layer, both body rosters keyed by id, and an optional map from geotech body id to its manual-group number.

**Why it is here.** Gathering all inputs into one object keeps every consumer reading from the same picture. The geotech formations are included because a class row needs each geotech band's NAD class, which lives on the formation row. The group-number map only drives the "(group N)" LABEL on a leaf; the actual set of bodies a group pools is carried by the group scope itself through ``bandsForScope``, never by this label-only map.

.. CG-EXPLANATION-END id=interface:ParameterTreeInput

``interface ParameterTreeNode``
-------------------------------

.. CG-BLOCK id=interface:ParameterTreeNode lines=63-114

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/parameterBodyTree.ts
   :language: typescript
   :lines: 63-114
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ParameterTreeNode

**What this does.** Names the shape of one tree row: the scope a click selects, its display label, how many accepted bands the click pools and how many of those are CPT-anchored, its child rows, and several optional fields — an orphan count on a litho-unit row, a manual-group number on a grouped leaf, the body id a grouping checkbox toggles, and the parent label that disambiguates that checkbox.

**Why it is here.** The band count and cone count are the honesty display: a row states exactly what its click pools and how much of it has a cone behind it. The two checkbox fields exist because of an owner finding (2026-09-04) that loose sand under one litho body must be groupable with loose sand under another: a class row that collapsed its single geotech body into itself still needs a checkbox and a parent label so "loose sand under Zand #0" is told apart from "loose sand under Zand #2" — for assistive technology and for a user scrolled away from the header. The comment is careful that the checkbox id is identity only; it never re-points what the row's click pools.

.. CG-EXPLANATION-END id=interface:ParameterTreeNode

``function isAccepted``
-----------------------

.. CG-BLOCK id=function:isAccepted lines=115-119

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/parameterBodyTree.ts
   :language: typescript
   :lines: 115-119
   :lineno-match:

.. CG-EXPLANATION-START id=function:isAccepted

**What this does.** Returns whether a layer's status is ``accepted``.

**Why it is here.** It is the one place the standing rule "a pending proposal is not ground" is written, so every band filter reuses it rather than repeating the string check — only accepted layers count as real.

.. CG-EXPLANATION-END id=function:isAccepted

``function lithoLayerIndex``
----------------------------

.. CG-BLOCK id=function:lithoLayerIndex lines=120-128

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/parameterBodyTree.ts
   :language: typescript
   :lines: 120-128
   :lineno-match:

.. CG-EXPLANATION-START id=function:lithoLayerIndex

**What this does.** Builds a lookup from litho-layer id to the layer, over the litho model's layers.

**Why it is here.** A geotech band finds its covering litho band by id (through the parent link), and doing that against a plain list would be a scan every time; the index turns each lookup into one fast read.

.. CG-EXPLANATION-END id=function:lithoLayerIndex

``function nadClassIndex``
--------------------------

.. CG-BLOCK id=function:nadClassIndex lines=129-144

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/parameterBodyTree.ts
   :language: typescript
   :lines: 129-144
   :lineno-match:

.. CG-EXPLANATION-START id=function:nadClassIndex

**What this does.** Builds a lookup from geotech formation id to that formation's NAD class (which may be null).

**Why it is here.** A geotech band carries its formation id, and the NAD class lives on the formation row; this index is how a band's class is found without rescanning the formations each time.

.. CG-EXPLANATION-END id=function:nadClassIndex

``function lithoBodyOfGeotechBand``
-----------------------------------

.. CG-BLOCK id=function:lithoBodyOfGeotechBand lines=145-180

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/parameterBodyTree.ts
   :language: typescript
   :lines: 145-180
   :lineno-match:

.. CG-EXPLANATION-START id=function:lithoBodyOfGeotechBand

**What this does.** Returns the litho BODY a geotech band belongs to, by following the band's parent-litho-layer link to the covering litho band and reading that layer's ``body_id``. Returns ``null`` for an orphan band with no covering litho band, or one whose covering band the resolver has not stamped yet.

**Why it is here.** The litho body is derived LIVE through the parent link rather than stored on the geotech band, so it never goes stale when the litho resolver re-mints body ids on a recompute. This is the mechanism that lets a geotech band render under its correct litho body in the tree.

.. CG-EXPLANATION-END id=function:lithoBodyOfGeotechBand

``function bandsForScope``
--------------------------

.. CG-BLOCK id=function:bandsForScope lines=181-225

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/parameterBodyTree.ts
   :language: typescript
   :lines: 181-225
   :lineno-match:

.. CG-EXPLANATION-START id=function:bandsForScope

**What this does.** The single band-selection authority: given any scope in the five-kind union and the tree input, it returns the accepted bands that scope's click pools. A litho-unit scope returns the unit's accepted litho bands; a litho-body scope returns the body's bands (matched on ``body_id``, not formation); a geotech-body scope returns that body's geotech bands; a geotech-group scope returns the union of every member body's bands; a geotech-unit scope returns the formation row's bands; and a geotech-class scope returns the geotech bands of that class whose litho parent belongs to the named litho body.

**Why it is here.** The docstring calls this the SINGLE authority so statistics, populations, plots, the cutout and the counts all agree by construction — none of them re-implements band selection. A litho body is matched on its body id, never a formation filter, because a body can span twin formation rows and a formation filter would hide half its bands. The group case pools every member (grouping gives more data, owner 2026-09-02) since members keep their own body ids. Population filters — canonical section membership, hidden or removed tests — stay with the consumers; this answers only "which bands are this node's ground".

.. CG-EXPLANATION-END id=function:bandsForScope

``function scopeKey``
---------------------

.. CG-BLOCK id=function:scopeKey lines=226-243

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/parameterBodyTree.ts
   :language: typescript
   :lines: 226-243
   :lineno-match:

.. CG-EXPLANATION-START id=function:scopeKey

**What this does.** Turns any scope into a stable string that uniquely identifies it, with a distinct pattern per kind (for a group, the sorted member ids are folded in).

**Why it is here.** The React key, the expand-set membership and the selection-equality test all share this one string, so two scopes are treated as "the same node" exactly when their keys match — one definition of node identity, reused everywhere.

.. CG-EXPLANATION-END id=function:scopeKey

``function countBands``
-----------------------

.. CG-BLOCK id=function:countBands lines=244-285

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/parameterBodyTree.ts
   :language: typescript
   :lines: 244-285
   :lineno-match:

.. CG-EXPLANATION-START id=function:countBands

**What this does.** Given a set of bands, returns the total count and how many of them are CPT-anchored (have a cone id).

**Why it is here.** These are the two honesty numbers a row shows — "N bands · M with cone" — so a borehole-heavy node reads truthfully about how much cone evidence actually sits behind it, rather than implying every band has a cone.

.. CG-EXPLANATION-END id=function:countBands

``function collapseSingleLeafChild``
------------------------------------

.. CG-BLOCK id=function:collapseSingleLeafChild lines=286-302

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/parameterBodyTree.ts
   :language: typescript
   :lines: 286-302
   :lineno-match:

.. CG-EXPLANATION-START id=function:collapseSingleLeafChild

**What this does.** Collapses a lone LEAF child into its parent — returning no children when there is exactly one child and that child is itself a leaf — otherwise leaves the children as they are.

**Why it is here.** A level with exactly one leaf child renders no expander and no separate child row; the parent's own click already pools the same ground. The collapse fires ONLY when the single child is a leaf, so a single INTERNAL child still renders — absorbing it would hide its own children (the sub-split bodies the owner wants reachable). The docstring records that this is deliberately NOT applied at the class level under a litho body: an owner ruling (2026-09-02) found that folding a body's lone packing class dropped the pakkingsdichtheid label and left the body un-openable, so the builder keeps that class node and this helper now runs only at the geotech-body and litho-unit levels, where nothing labelled is lost.

.. CG-EXPLANATION-END id=function:collapseSingleLeafChild

``function lithoBodyIdsForUnit``
--------------------------------

.. CG-BLOCK id=function:lithoBodyIdsForUnit lines=303-335

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/parameterBodyTree.ts
   :language: typescript
   :lines: 303-335
   :lineno-match:

.. CG-EXPLANATION-START id=function:lithoBodyIdsForUnit

**What this does.** Returns the distinct litho body ids that belong under one litho unit, ordered by their roster ordinal, by walking the accepted litho layers and keeping each body whose HOME formation (from the roster, else the layer's own formation) is this unit.

**Why it is here.** A body renders under its HOME formation from the roster; a body the roster does not know falls back to its layer's own formation. Ordering by ordinal makes the tree read the way the 3-D legend numbers bodies, so the roster and the model agree on the numbering the engineer sees.

.. CG-EXPLANATION-END id=function:lithoBodyIdsForUnit

``function buildParameterTree``
-------------------------------

.. CG-BLOCK id=function:buildParameterTree lines=336-485

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/parameterBodyTree.ts
   :language: typescript
   :lines: 336-485
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildParameterTree

**What this does.** Builds the whole four-level tree. It indexes the litho layers and each formation's class, then buckets every accepted geotech band under its litho parent body once — counting the orphans (no covering litho band) against their source unit instead of inventing a home. For each litho unit in stratigraphic order it builds its litho-body rows; under each body it folds bands by NAD class into class rows and, under each class row, the geotech-body leaves ordered by ordinal. Every node's counts come from ``bandsForScope``. It applies the single-leaf collapse at the geotech-body and litho-unit levels, keeps the class row even when a body has only one class, and attaches the group number, checkbox id and parent label where grouping needs them.

**Why it is here.** Bucketing bands by litho parent once turns the per-body build into lookups rather than repeated rescans. Twin geotech formation rows of the same class fold into ONE class row because class rows key on the class number. A grouped sole body is deliberately kept as a selectable leaf rather than collapsed, so its "(group N)" tag shows and selecting it pools the group. When a class row DID collapse its one geotech body into itself, the row carries that body's id (so a checkbox appears and it can be grouped across litho parents) and the parent's label (so the checkbox's accessible name stays unambiguous). Units are sorted by ``display_order`` — stratigraphic order, oldest first — so the tree reads top-down like the section.

.. CG-EXPLANATION-END id=function:buildParameterTree

