desktop.renderer.src.utils.buildVoxelRequest
============================================

.. CG-PAGE source=desktop/src/renderer/src/utils/buildVoxelRequest.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/buildVoxelRequest.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-45

.. literalinclude:: ../../../desktop/src/renderer/src/utils/buildVoxelRequest.ts
   :language: typescript
   :lines: 1-45
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment and imports for the voxel-builder request contract. The comment explains that the data shapes below describe the JSON payload — the text format the app and engine exchange data in — that the app sends to the backend voxel builder, reshaped from the same validated 2-D section partition the engineer sees on screen; and that the assembler function reuses the exact same partition and world-position passes as the fence builder.

**Why it is here.** The comments record two decisions: the field names are written in snake_case to match the Python value objects so the payload round-trips the API unchanged; and one import deliberately reaches up into the sections components for the override derivation rather than copying it, because a second copy is exactly the render-versus-build drift this file exists to prevent — the comment says to move that helper down rather than duplicate it if the layering ever matters.

.. CG-EXPLANATION-END id=module-header

``interface RegionInput``
-------------------------

.. CG-BLOCK id=interface:RegionInput lines=46-95

.. literalinclude:: ../../../desktop/src/renderer/src/utils/buildVoxelRequest.ts
   :language: typescript
   :lines: 46-95
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RegionInput

**What this does.** Describes one filled region of a section partition as it travels on the wire: the formation it belongs to, its body identity (or null), its outline as gap-local horizontal fraction and absolute elevation points, the index of the gap's left column, how the region terminated (a band tied across both columns, a one-sided pinch, or an enclosed lens), an optional overlay tier, an optional base elevation fixed by an explicit correlation, a flag for a region kept only above a sloping tie, and the ids of the layers that produced it.

**Why it is here.** The field comments record why the classification travels rather than just the geometry (debt #256): a band, an onlap and a lens can have identical outlines, so without the kind the builder would pinch all three alike and kill them at the midline; the explicit tied base is sent because an engineer's correlation is absolute and the shallow-depth cap must not chop it flat (owner directive 2026-07-08); and the layer ids are label-independent evidence the body recompute reads server-side. Optional fields are omitted rather than sent as null so the payload keeps one shape.

.. CG-EXPLANATION-END id=interface:RegionInput

``interface SectionColumnInput``
--------------------------------

.. CG-BLOCK id=interface:SectionColumnInput lines=96-107

.. literalinclude:: ../../../desktop/src/renderer/src/utils/buildVoxelRequest.ts
   :language: typescript
   :lines: 96-107
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SectionColumnInput

**What this does.** Describes one investigation column of a section on the wire: the CPT or borehole id, its distance along the section line in metres, and its easting and northing in metres.

**Why it is here.** The comments record that the world coordinates are in the project's coordinate reference system (a projected metric CRS such as Belgian Lambert 72, where distances are genuinely metres), so the backend can place the column in space without re-projecting.

.. CG-EXPLANATION-END id=interface:SectionColumnInput

``interface SectionPartitionInput``
-----------------------------------

.. CG-BLOCK id=interface:SectionPartitionInput lines=108-123

.. literalinclude:: ../../../desktop/src/renderer/src/utils/buildVoxelRequest.ts
   :language: typescript
   :lines: 108-123
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SectionPartitionInput

**What this does.** Describes one section's full 2-D partition on the wire: the easting and northing of its start and end points, its ordered investigation columns, and its filled regions.

**Why it is here.** This is the per-section unit the payload is a list of; each region references the column pair it fills, so the backend can rebuild the same partition the engineer saw.

.. CG-EXPLANATION-END id=interface:SectionPartitionInput

``interface VoxelBuildRequest``
-------------------------------

.. CG-BLOCK id=interface:VoxelBuildRequest lines=124-190

.. literalinclude:: ../../../desktop/src/renderer/src/utils/buildVoxelRequest.ts
   :language: typescript
   :lines: 124-190
   :lineno-match:

.. CG-EXPLANATION-START id=interface:VoxelBuildRequest

**What this does.** Describes the whole payload sent to the voxel builder: the per-section partitions, a single cubic grid spacing, optional separate horizontal and vertical spacings, and the renderer's half of the gapless-gate diagnostic.

**Why it is here.** The field comments record the reasons: the single grid spacing is kept for backwards compatibility so a legacy payload still builds, while the explicit horizontal and vertical spacings let a fine vertical over a coarse horizontal catch thin layers without exploding the voxel count; and the gapless-gate half is diagnostic freight only — it is deliberately never read by the build's cache checksum, so it can never bust a cached build, and it is always emitted (reporting "not-evaluated" rather than being omitted) so "not measured" is never confused with "not asked".

.. CG-EXPLANATION-END id=interface:VoxelBuildRequest

``function deriveSectionApexOverrides``
---------------------------------------

.. CG-BLOCK id=function:deriveSectionApexOverrides lines=191-234

.. literalinclude:: ../../../desktop/src/renderer/src/utils/buildVoxelRequest.ts
   :language: typescript
   :lines: 191-234
   :lineno-match:

.. CG-EXPLANATION-START id=function:deriveSectionApexOverrides

**What this does.** Works out one section's hand-drawn apex and contact overrides without any reference to the screen. It turns the along-metres into gap extents, uses an identity transform for the along-to-fraction step, optionally runs a no-override base fill first to spot persisted lens bodies, then builds the overrides from the stored boundary nodes with both live-drag states left empty.

**Why it is here.** The docstring records why it is screen-free: the stored boundary nodes already carry along-metres and elevation, and the overlay's screen transforms are only needed during a live drag, so the identity transform reproduces the overlay's fractions exactly. It is exported and kept as the single copy because the render-versus-build agreement gate must derive the build's overrides the very same way the real builder does — a second hand-copy is precisely the drift that gate exists to catch.

.. CG-EXPLANATION-END id=function:deriveSectionApexOverrides

``interface SectionPartitionFrame``
-----------------------------------

.. CG-BLOCK id=interface:SectionPartitionFrame lines=235-275

.. literalinclude:: ../../../desktop/src/renderer/src/utils/buildVoxelRequest.ts
   :language: typescript
   :lines: 235-275
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SectionPartitionFrame

**What this does.** Describes one section's fully-derived partition frame: everything an engine call needs minus the call itself — the raw fence input, the assembled columns, the payload columns with world positions, the along-metres per column, and the screen-free overrides.

**Why it is here.** The comment records that it was extracted (2026-08-12) because the body-identity recompute is the second consumer of the exact same canonical-columns, along-metres, and screen-free-overrides prefix — only the engine call differs (a plain fill versus an identity fill), so the shared prefix lives in one place.

.. CG-EXPLANATION-END id=interface:SectionPartitionFrame

``function assembleSectionPartitionFrames``
-------------------------------------------

.. CG-BLOCK id=function:assembleSectionPartitionFrames lines=276-359

.. literalinclude:: ../../../desktop/src/renderer/src/utils/buildVoxelRequest.ts
   :language: typescript
   :lines: 276-359
   :lineno-match:

.. CG-EXPLANATION-START id=function:assembleSectionPartitionFrames

**What this does.** Builds one partition frame per fillable section. It first assembles every section together and reconciles the canonical per-test world positions, then, for each section, stamps each column's world position, records the true along-metres per column, and derives the section's screen-free overrides. It throws if an assembled column somehow lacks a world position.

**Why it is here.** The docstring and comments record the decisions: the first pass is shared with the fence builder so crossings agree between the two; passing the real along-metres lets the substrate pass slice each gap at the true column spacing so the 3D model inherits the 2-D overlay's geometry; the hand-drawn overrides must reach the build because until 2026-07-30 they did not, and a basal clay that banded across all 23 gaps on screen was wedged at four of them in the built model; and the loud throw on a missing world position beats emitting a not-a-number that would silently arrive at the backend as a baffling null far from its cause.

.. CG-EXPLANATION-END id=function:assembleSectionPartitionFrames

``function toRegionInputs``
---------------------------

.. CG-BLOCK id=function:toRegionInputs lines=360-422

.. literalinclude:: ../../../desktop/src/renderer/src/utils/buildVoxelRequest.ts
   :language: typescript
   :lines: 360-422
   :lineno-match:

.. CG-EXPLANATION-START id=function:toRegionInputs

**What this does.** Turns the engine's regions into the wire region shape: it copies the formation and body id, converts each outline point to a fraction-and-elevation pair and the gap index and kind, and attaches the optional fields (overlay tier, tied base, tie-clipped flag, layer ids) only when the engine set them.

**Why it is here.** The docstring records that it carries the engine's classification, not just its geometry (debt #256), because a band, an onlap and an enclosed lens are three different terminations with identical outlines that the builder cannot re-derive from the polygon alone; the optional fields are omitted rather than sent as null so the payload keeps a single shape.

.. CG-EXPLANATION-END id=function:toRegionInputs

``function buildVoxelRequest``
------------------------------

.. CG-BLOCK id=function:buildVoxelRequest lines=423-570

.. literalinclude:: ../../../desktop/src/renderer/src/utils/buildVoxelRequest.ts
   :language: typescript
   :lines: 423-570
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildVoxelRequest

**What this does.** Assembles the whole voxel-build payload. For each fillable section it computes the engine regions — the hierarchical geotech fill when a litho frame is supplied, otherwise the active litho fill with the section's edges and hand-drawn overrides — reshapes them into a section partition, records the section for the gapless gate, and logs a per-section summary of columns, regions, edges and overrides. Then it assembles the gapless-gate half over every litho-frame section and returns the sections plus the three spacing fields and the gate diagnostic.

**Why it is here.** The docstring and comments record the core promise and its history: this is the partition-payload sibling of the fence builder, reusing the same world-position reconciliation so a tie column and a cross-section column for the same test agree, and the backend labeller sees exactly the regions the engineer sees — a promise that was false until 2026-07-30 when the overrides were not passed. The per-section logging was added the same day after a correlated basal clay was absent from the built model despite byte-identical inputs, so any payload that disagrees with a bench run of the same engine is visible from inside the app; and the gapless gate deliberately refuses to guess why a section is missing rather than mis-attributing it to a consented exclusion.

.. CG-EXPLANATION-END id=function:buildVoxelRequest

