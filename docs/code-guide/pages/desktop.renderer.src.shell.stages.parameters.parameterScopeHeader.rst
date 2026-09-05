desktop.renderer.src.shell.stages.parameters.parameterScopeHeader
=================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/parameters/parameterScopeHeader.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/parameters/parameterScopeHeader.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-27

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/parameterScopeHeader.ts
   :language: typescript
   :lines: 1-27
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the file that builds the one-line header a scoped Parameters view shows — the breadcrumb path from the litho unit down to the scoped node, plus the honest "pooled across N bodies" note on aggregate views — and imports the layer type, the NAD label helpers, the language and translate helpers, the scope type, the band authority and index helpers from the tree module, the body-label helpers, and the crossed-formation label helper.

**Why it is here.** It is split out of ``parameterBodyTree.ts`` to keep that module under the 500-line god-component cap (debt #201): the tree owns the STRUCTURE and the band authority, this file owns the one-line PATH a node reads. The dependency runs one way — this file imports the tree, never the reverse — so there is no import cycle.

.. CG-EXPLANATION-END id=module-header

``const PATH_SEP``
------------------

.. CG-BLOCK id=const:PATH_SEP lines=28-30

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/parameterScopeHeader.ts
   :language: typescript
   :lines: 28-30
   :lineno-match:

.. CG-EXPLANATION-START id=const:PATH_SEP

**What this does.** Holds the separator drawn between breadcrumb steps — a spaced angle bracket.

**Why it is here.** Defining the path separator once keeps every breadcrumb consistent and makes it a single place to change the styling.

.. CG-EXPLANATION-END id=const:PATH_SEP

``const GEO_SEP``
-----------------

.. CG-BLOCK id=const:GEO_SEP lines=31-37

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/parameterScopeHeader.ts
   :language: typescript
   :lines: 31-37
   :lineno-match:

.. CG-EXPLANATION-START id=const:GEO_SEP

**What this does.** Holds the middot separator drawn before a body's geological context.

**Why it is here.** The comment ties it to matching the body context menu's header, which reads like "… · Holoceen + Pleistoceen" — using the same middot keeps the Parameters header and the section menu visually in step.

.. CG-EXPLANATION-END id=const:GEO_SEP

``function geoContextSuffix``
-----------------------------

.. CG-BLOCK id=function:geoContextSuffix lines=38-71

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/parameterScopeHeader.ts
   :language: typescript
   :lines: 38-71
   :lineno-match:

.. CG-EXPLANATION-START id=function:geoContextSuffix

**What this does.** Returns the "· <crossed formations>" suffix a body path ends with — the geological formations the body crosses — or an empty string when the roster carries none.

**Why it is here.** The crossed-formation list (debt #278) tells the engineer which geological units a body spans; when the roster does not carry any (an old cached response, or a body it does not know) the suffix is simply empty rather than a dangling separator.

.. CG-EXPLANATION-END id=function:geoContextSuffix

``function geotechGeoContextSuffix``
------------------------------------

.. CG-BLOCK id=function:geotechGeoContextSuffix lines=72-83

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/parameterScopeHeader.ts
   :language: typescript
   :lines: 72-83
   :lineno-match:

.. CG-EXPLANATION-START id=function:geotechGeoContextSuffix

**What this does.** Returns a geotech body's crossed-formation suffix: its OWN list if it has one, otherwise its litho parent body's list.

**Why it is here.** The docstring explains the engine now derives a geotech body's own crossed-formation list correctly by walking the parent chain from geological to litho to geotech, so the own list is normally populated and wins. The litho-parent fallback is the degraded path — for a geotech body whose own list is genuinely empty (no geological model at its investigations) while its wider litho parent still resolves one. Because a geotech body sits inside its litho parent, inheriting the parent's list makes the same body read the same context on both arrival paths.

.. CG-EXPLANATION-END id=function:geotechGeoContextSuffix

``function homeUnitOfLithoBody``
--------------------------------

.. CG-BLOCK id=function:homeUnitOfLithoBody lines=84-90

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/parameterScopeHeader.ts
   :language: typescript
   :lines: 84-90
   :lineno-match:

.. CG-EXPLANATION-START id=function:homeUnitOfLithoBody

**What this does.** Returns the litho unit a litho body homes to: the roster's home formation if known, otherwise the formation of one of the body's layers.

**Why it is here.** The breadcrumb needs the body's home unit to name the top of the path; the two-step fall-through means a body whose roster row is missing still resolves a unit from its own layers rather than showing nothing.

.. CG-EXPLANATION-END id=function:homeUnitOfLithoBody

``function lithoUnitName``
--------------------------

.. CG-BLOCK id=function:lithoUnitName lines=91-113

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/parameterScopeHeader.ts
   :language: typescript
   :lines: 91-113
   :lineno-match:

.. CG-EXPLANATION-START id=function:lithoUnitName

**What this does.** Returns a litho unit's display name for a given id, or a dash when the id is null or unknown.

**Why it is here.** The breadcrumb needs a printable unit name and must never show a blank or a raw id, so the dash is the safe fallback when the formation is not found.

.. CG-EXPLANATION-END id=function:lithoUnitName

``function distinctBodyCount``
------------------------------

.. CG-BLOCK id=function:distinctBodyCount lines=114-127

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/parameterScopeHeader.ts
   :language: typescript
   :lines: 114-127
   :lineno-match:

.. CG-EXPLANATION-START id=function:distinctBodyCount

**What this does.** Counts the distinct resolver bodies actually contributing to the pooled statistics, ignoring borehole-anchored bands and any band whose cone is not in the pooling population.

**Why it is here.** The docstring records the live case that produced the rule: a header once read "16 bodies" where only 9 truly contributed. A borehole band has no cone to summarise, and a band whose cone is hidden, removed or on no section contributes no samples — so both are excluded. The same population filter drives the statistics numbers, so the count has to read it too or the header and the numbers on screen would disagree.

.. CG-EXPLANATION-END id=function:distinctBodyCount

``function pooledSuffix``
-------------------------

.. CG-BLOCK id=function:pooledSuffix lines=128-144

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/parameterScopeHeader.ts
   :language: typescript
   :lines: 128-144
   :lineno-match:

.. CG-EXPLANATION-START id=function:pooledSuffix

**What this does.** Returns the "— pooled across N bodies" suffix when more than one body contributes, and an empty string for one or none.

**Why it is here.** On an aggregate view (a whole unit, a class), the header must say honestly that it is pooling several bodies' evidence; when only one or none contributes there is nothing to pool and the suffix is dropped.

.. CG-EXPLANATION-END id=function:pooledSuffix

``function geotechBodyPath``
----------------------------

.. CG-BLOCK id=function:geotechBodyPath lines=145-179

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/parameterScopeHeader.ts
   :language: typescript
   :lines: 145-179
   :lineno-match:

.. CG-EXPLANATION-START id=function:geotechBodyPath

**What this does.** Resolves a geotech body's litho path — its litho unit, its litho body and its NAD class — from one of the body's accepted bands. Returns null when the body has no accepted band.

**Why it is here.** A leaf header reads the full breadcrumb like "SILT › #3 › SF #1", which needs the body's place in the litho hierarchy; this recovers it live from a band. A body with no accepted band should not appear in the tree at all, so returning null lets the caller fall back to the bare body label.

.. CG-EXPLANATION-END id=function:geotechBodyPath

``function groupProvenanceLithoBodies``
---------------------------------------

.. CG-BLOCK id=function:groupProvenanceLithoBodies lines=180-227

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/parameterScopeHeader.ts
   :language: typescript
   :lines: 180-227
   :lineno-match:

.. CG-EXPLANATION-START id=function:groupProvenanceLithoBodies

**What this does.** Returns one litho-body label per group member, in member order, resolving each member's covering litho body the same way the tree does — and de-duplicating members that share one litho parent, appending "×N" when several members sit under the same litho body.

**Why it is here.** The group header lists which litho bodies the group draws from (owner: the bullets are "which litho bodies"). Several members can share one litho parent, so listing it once with a count reads correctly, whereas repeating the same label verbatim would look like a render bug (ux review 2026-09-02). An orphan member with no covering litho band keeps its own geotech-body label, distinct per body, never merged.

.. CG-EXPLANATION-END id=function:groupProvenanceLithoBodies

``function groupGeoContextSuffix``
----------------------------------

.. CG-BLOCK id=function:groupGeoContextSuffix lines=228-255

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/parameterScopeHeader.ts
   :language: typescript
   :lines: 228-255
   :lineno-match:

.. CG-EXPLANATION-START id=function:groupGeoContextSuffix

**What this does.** Returns the "· <formations>" suffix for a whole group — the deduplicated union of every member's crossed geological formations, shallowest first — each member reading its own list, falling back to its litho parent's, exactly as the single-body helper does. Empty when no member carries any.

**Why it is here.** The members of a group may cross different geological formations, so the group's geological context is their union rather than any one member's list; deduplicating keeps a formation two members share from appearing twice.

.. CG-EXPLANATION-END id=function:groupGeoContextSuffix

``function groupNadClass``
--------------------------

.. CG-BLOCK id=function:groupNadClass lines=256-283

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/parameterScopeHeader.ts
   :language: typescript
   :lines: 256-283
   :lineno-match:

.. CG-EXPLANATION-START id=function:groupNadClass

**What this does.** Returns the single NAD class a group carries, read from the first member that resolves one.

**Why it is here.** Because same-soil and same-class is the Join guard, every member of a legal group shares one class, so any member's class is THE class — the first that resolves one is enough.

.. CG-EXPLANATION-END id=function:groupNadClass

``function scopeHeaderLabel``
-----------------------------

.. CG-BLOCK id=function:scopeHeaderLabel lines=284-356

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/parameterScopeHeader.ts
   :language: typescript
   :lines: 284-356
   :lineno-match:

.. CG-EXPLANATION-START id=function:scopeHeaderLabel

**What this does.** The one public entry: given any scope, the tree input and the pooling population, it returns the header line. A litho unit reads "<unit> — whole litho unit, all packing classes" plus the pooled note; a litho body and a geotech class read the breadcrumb path with the litho body's geological context; a geotech body reads the full path down to the leaf with the body's own (or inherited) geological context; a group reads a group title with its member count, shared class and combined context; and a geotech unit reads the formation name with the pooled note.

**Why it is here.** Each kind gets the header its view needs. The litho-unit wording spells out that the pool spans the whole unit and every packing class (naming requirement R1). The geotech-class header still shows the litho body's geological context because a jump lands there when a body could not be resolved, so it must show the context the resolved body would have. The group case shows a group TITLE — number, member count and shared class — in place of a deep breadcrumb, with the per-member litho-body provenance rendered separately; the comment flags that the exact "Group N — N bodies" wording is not yet owner-ruled. The geotech-unit case is the jump-only fallback with no litho path, named exactly as it was before this tree existed.

.. CG-EXPLANATION-END id=function:scopeHeaderLabel

