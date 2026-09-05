groundmodel.api.schemas.project.voxel_build_request
===================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/voxel_build_request.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/voxel_build_request.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-30

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/voxel_build_request.py
   :language: python
   :lines: 1-30
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring stating that these schemas mirror the frozen domain value objects one-for-one, then imports the free-form and fixed-choice types, ``Field``, the gapless clause-input shape, the strict base class, and the three domain value-object types.

**Why it is here.** A *value object* is a small, immutable bundle of data the domain layer works with. The docstring records the clean-architecture boundary: the web layer validates the incoming JSON into these Pydantic schemas, then converts them into the domain's own value objects, because the domain must not depend on the web framework. The four schemas form one build-request vocabulary, so they are grouped in one file (the approved exception to one-class-per-file, matching the domain side).

.. CG-EXPLANATION-END id=module-header

Class ``RegionInputSchema`` — header
------------------------------------

.. CG-BLOCK id=class:RegionInputSchema lines=31-77

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/voxel_build_request.py
   :language: python
   :lines: 31-77
   :lineno-match:

.. CG-EXPLANATION-START id=class:RegionInputSchema

**What this does.** One filled region of a 2-D section partition: its formation, an optional body id, the outline as fraction/elevation points, the gap it fills, how the 2-D engine terminated it, an optional overlay tier, a tied base elevation, a tie-clip flag, and the layer ids for the body recompute.

**Why it is here.** The outline uses a gap-local horizontal fraction (0–1) paired with absolute elevation so it is independent of the gap's width. The termination kind carries the 2/1/0 gesture semantics (band / pinch / lens). The classification fields are optional so a build or bundle written before they existed still loads and builds (additive). The comment records that the layer ids exist for the body recompute — connectivity evidence must name layers, never bodies, because the recompute restamps body ids and body-labelled evidence oscillated in production (owner ruling 2026-08-12); the voxel build itself ignores them.

.. CG-EXPLANATION-END id=class:RegionInputSchema

Method ``RegionInputSchema``. ``def to_domain``
-----------------------------------------------

.. CG-BLOCK id=method:RegionInputSchema.to_domain lines=78-92

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/voxel_build_request.py
   :language: python
   :lines: 78-92
   :lineno-match:

.. CG-EXPLANATION-START id=method:RegionInputSchema.to_domain

**What this does.** Converts this region schema into the frozen domain region value object, coercing the outline points to plain float tuples.

**Why it is here.** The conversion happens at the boundary so the domain never sees a Pydantic type (the layer model). This to-domain pattern repeats on each schema below.

.. CG-EXPLANATION-END id=method:RegionInputSchema.to_domain

Class ``SectionColumnInputSchema`` — header
-------------------------------------------

.. CG-BLOCK id=class:SectionColumnInputSchema lines=93-112

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/voxel_build_request.py
   :language: python
   :lines: 93-112
   :lineno-match:

.. CG-EXPLANATION-START id=class:SectionColumnInputSchema

**What this does.** One investigation column of a section: the CPT or borehole id, its distance along the section line, and its map easting and northing.

**Why it is here.** These position the column both along the drawn section and in the real world, which the 3-D build needs to place the partition in space.

.. CG-EXPLANATION-END id=class:SectionColumnInputSchema

Method ``SectionColumnInputSchema``. ``def to_domain``
------------------------------------------------------

.. CG-BLOCK id=method:SectionColumnInputSchema.to_domain lines=113-122

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/voxel_build_request.py
   :language: python
   :lines: 113-122
   :lineno-match:

.. CG-EXPLANATION-START id=method:SectionColumnInputSchema.to_domain

**What this does.** Converts this column schema into the frozen domain column value object.

**Why it is here.** Same boundary-conversion pattern as the region (see the region's to-domain block).

.. CG-EXPLANATION-END id=method:SectionColumnInputSchema.to_domain

Class ``SectionPartitionInputSchema`` — header
----------------------------------------------

.. CG-BLOCK id=class:SectionPartitionInputSchema lines=123-142

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/voxel_build_request.py
   :language: python
   :lines: 123-142
   :lineno-match:

.. CG-EXPLANATION-START id=class:SectionPartitionInputSchema

**What this does.** One section's full 2-D partition: the section line's two endpoints, its ordered investigation columns, and its filled regions.

**Why it is here.** This is the whole drawn partition of one section — the columns say where the investigations sit and the regions say what fills the gaps between them. The same shape is reused by the body-recompute and the closed-geometry exports (the don't-repeat rule).

.. CG-EXPLANATION-END id=class:SectionPartitionInputSchema

Method ``SectionPartitionInputSchema``. ``def to_domain``
---------------------------------------------------------

.. CG-BLOCK id=method:SectionPartitionInputSchema.to_domain lines=143-154

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/voxel_build_request.py
   :language: python
   :lines: 143-154
   :lineno-match:

.. CG-EXPLANATION-START id=method:SectionPartitionInputSchema.to_domain

**What this does.** Converts this partition schema, and every column and region inside it, into the frozen domain partition value object.

**Why it is here.** Same boundary-conversion pattern, applied recursively to the nested columns and regions.

.. CG-EXPLANATION-END id=method:SectionPartitionInputSchema.to_domain

Class ``VoxelBuildRequest`` — header
------------------------------------

.. CG-BLOCK id=class:VoxelBuildRequest lines=155-218

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/voxel_build_request.py
   :language: python
   :lines: 155-218
   :lineno-match:

.. CG-EXPLANATION-START id=class:VoxelBuildRequest

**What this does.** The full payload for a 3-D voxel build: one partition per section, a cubic/fallback grid spacing, optional separate horizontal and vertical spacings, and the renderer's clauses 1–4 of the gapless gate.

**Why it is here.** The docstring stresses that the payload IS the source of truth — the backend never re-derives the partition; it labels a 3-D grid from it and extracts watertight body meshes. Separate vertical spacing lets a fine Z catch thin layers over a coarse map-plane grid without exploding the voxel count; both are optional and fall back to the cubic spacing so a legacy payload still builds (additive). The comment records that the gapless clauses are deliberately kept OUT of the labelling cache key, because the gate's findings change only what is REPORTED about the model, never what the model IS, so a changed finding must not needlessly rebuild the grid.

.. CG-EXPLANATION-END id=class:VoxelBuildRequest

Method ``VoxelBuildRequest``. ``def effective_horizontal_spacing_m``
--------------------------------------------------------------------

.. CG-BLOCK id=method:VoxelBuildRequest.effective_horizontal_spacing_m lines=219-238

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/voxel_build_request.py
   :language: python
   :lines: 219-238
   :lineno-match:

.. CG-EXPLANATION-START id=method:VoxelBuildRequest.effective_horizontal_spacing_m

**What this does.** Returns the map-plane spacing to build with: the explicit horizontal spacing when set, otherwise the cubic fallback.

**Why it is here.** Each axis resolves independently, so the cubic value is used only where no explicit override was given — this is the precedence the docstring spells out.

.. CG-EXPLANATION-END id=method:VoxelBuildRequest.effective_horizontal_spacing_m

Method ``VoxelBuildRequest``. ``def effective_vertical_spacing_m``
------------------------------------------------------------------

.. CG-BLOCK id=method:VoxelBuildRequest.effective_vertical_spacing_m lines=239-256

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/voxel_build_request.py
   :language: python
   :lines: 239-256
   :lineno-match:

.. CG-EXPLANATION-START id=method:VoxelBuildRequest.effective_vertical_spacing_m

**What this does.** Returns the elevation spacing to build with: the explicit vertical spacing when set, otherwise the cubic fallback.

**Why it is here.** Same independent-axis precedence as the horizontal spacing.

.. CG-EXPLANATION-END id=method:VoxelBuildRequest.effective_vertical_spacing_m

Method ``VoxelBuildRequest``. ``def to_domain_sections``
--------------------------------------------------------

.. CG-BLOCK id=method:VoxelBuildRequest.to_domain_sections lines=257-266

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/voxel_build_request.py
   :language: python
   :lines: 257-266
   :lineno-match:

.. CG-EXPLANATION-START id=method:VoxelBuildRequest.to_domain_sections

**What this does.** Converts every section in the payload into its frozen domain value object.

**Why it is here.** Hands the use case the domain-layer sections it consumes, keeping the web types at the boundary (the layer model).

.. CG-EXPLANATION-END id=method:VoxelBuildRequest.to_domain_sections

Method ``VoxelBuildRequest``. ``def to_gapless_2d_dicts``
---------------------------------------------------------

.. CG-BLOCK id=method:VoxelBuildRequest.to_gapless_2d_dicts lines=267-285

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/voxel_build_request.py
   :language: python
   :lines: 267-285
   :lineno-match:

.. CG-EXPLANATION-START id=method:VoxelBuildRequest.to_gapless_2d_dicts

**What this does.** Converts the gapless clauses to plain dictionaries for the application layer, returning nothing when the field was never sent.

**Why it is here.** The assembler that re-stamps these clauses lives in the application layer, which must not import the web (Pydantic) schemas — so the boundary crossing to plain dicts happens here, on the schema side. It preserves "never sent" as distinct from "sent an empty list" in case the use case ever needs to tell them apart.

.. CG-EXPLANATION-END id=method:VoxelBuildRequest.to_gapless_2d_dicts

