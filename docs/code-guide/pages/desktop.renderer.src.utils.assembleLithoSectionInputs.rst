desktop.renderer.src.utils.assembleLithoSectionInputs
=====================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/assembleLithoSectionInputs.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/assembleLithoSectionInputs.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-14

.. literalinclude:: ../../../desktop/src/renderer/src/utils/assembleLithoSectionInputs.ts
   :language: typescript
   :lines: 1-14
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment explains what this file assembles — one fence-section input per section, built from the shell-bus data — and then imports one projection helper and two data-shape types. The assembled result is the reshape of accepted litho layers, projected columns, and approved correlation edges into the section-partition contract.

**Why it is here.** The comment records that this was pulled out of the lithology canvas so the exact same assembly feeds both the fence-mode 3D walls and the voxel "Build model" payload; keeping it in one place stops those two build paths from drifting apart, which is the "extract on the second copy" maintenance rule.

.. CG-EXPLANATION-END id=module-header

``interface InvestigationLocation``
-----------------------------------

.. CG-BLOCK id=interface:InvestigationLocation lines=15-26

.. literalinclude:: ../../../desktop/src/renderer/src/utils/assembleLithoSectionInputs.ts
   :language: typescript
   :lines: 15-26
   :lineno-match:

.. CG-EXPLANATION-START id=interface:InvestigationLocation

**What this does.** Describes the minimal shape of an investigation (a CPT or borehole) needed to place its column on a section: an id, an easting and northing in the project coordinate system in metres, and a collar elevation in metres (or null when unknown).

**Why it is here.** The field comments record that the coordinates are in the project CRS and are in metres — distances only make sense in metres when the coordinates are in a projected metric coordinate reference system — and that elevation can legitimately be null when it has not been surveyed.

.. CG-EXPLANATION-END id=interface:InvestigationLocation

``interface LithoLayerLike``
----------------------------

.. CG-BLOCK id=interface:LithoLayerLike lines=27-46

.. literalinclude:: ../../../desktop/src/renderer/src/utils/assembleLithoSectionInputs.ts
   :language: typescript
   :lines: 27-46
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LithoLayerLike

**What this does.** Describes the minimal shape of one litho layer: its id, the source CPT id or borehole id (one is set, the other null), the formation it belongs to, its resolver-assigned body identity (or null), its top and base depths below the collar in metres, and its acceptance status.

**Why it is here.** The field comments record the load-bearing detail: only layers whose status is ``'accepted'`` fill the partition, so the shape carries the status explicitly rather than assuming every layer counts.

.. CG-EXPLANATION-END id=interface:LithoLayerLike

``interface SectionLike``
-------------------------

.. CG-BLOCK id=interface:SectionLike lines=47-78

.. literalinclude:: ../../../desktop/src/renderer/src/utils/assembleLithoSectionInputs.ts
   :language: typescript
   :lines: 47-78
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SectionLike

**What this does.** Describes the minimal shape of a section: its id, an optional name, its start and end coordinates, the half-width of the projection corridor in metres, and the lists of investigation ids the engineer has excluded from it.

**Why it is here.** The comments record that the name is not used for geometry — it exists only so a build-cancelled message can tell the engineer which cross-section failed to load (audit 2026-08-02) — and that the corridor half-width and the exclusion lists are what decide which investigations project onto the section.

.. CG-EXPLANATION-END id=interface:SectionLike

``interface ApprovedEdge``
--------------------------

.. CG-BLOCK id=interface:ApprovedEdge lines=79-112

.. literalinclude:: ../../../desktop/src/renderer/src/utils/assembleLithoSectionInputs.ts
   :language: typescript
   :lines: 79-112
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ApprovedEdge

**What this does.** Describes one approved correlation edge on a section: the two layer ids it joins, plus which contact of each layer — its top or its base — the edge ties, each defaulting to the top when omitted.

**Why it is here.** The long comment records why the sides are load-bearing and must never be dropped: the partition engine keys off them, and a base-to-base bottom tie is what lets the deepest unit form a full band. Until 2026-07-30 this shape carried only the two ids, so every base tie was silently turned into a duplicate top tie and a clay band vanished from three whole gaps of Cross-section 1 even though the section view drew it correctly — the type-checker could not object because the side fields are optional.

.. CG-EXPLANATION-END id=interface:ApprovedEdge

``function assembleLithoSectionInputs``
---------------------------------------

.. CG-BLOCK id=function:assembleLithoSectionInputs lines=113-182

.. literalinclude:: ../../../desktop/src/renderer/src/utils/assembleLithoSectionInputs.ts
   :language: typescript
   :lines: 113-182
   :lineno-match:

.. CG-EXPLANATION-START id=function:assembleLithoSectionInputs

**What this does.** Builds one fence-section input per visible section. It first reduces the investigations to their id and location, then turns the litho layers into layer inputs — skipping any layer that has neither a CPT nor a borehole anchor, and marking which are accepted. Then, for each section, it collects the excluded ids, projects the investigations onto the section line to get along-section positions and surface elevations, carries the approved edges (keeping their top/base sides), and returns the section geometry, its projected columns, the shared layer list, and its edges.

**Why it is here.** The docstring records that sections are independent — each is projected and assembled on its own — and that a layer with no investigation anchor cannot be placed on a column so it is skipped. The inline comment on the edges repeats the 2026-07-30 lesson: the sides must be carried, because dropping them turned every base-to-base tie into a duplicate top tie and left the deepest unit unable to band.

.. CG-EXPLANATION-END id=function:assembleLithoSectionInputs

