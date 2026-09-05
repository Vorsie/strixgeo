desktop.renderer.src.shell.stages.shared.makeVoxelRequestBuilder
================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/shared/makeVoxelRequestBuilder.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/shared/makeVoxelRequestBuilder.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-30

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/shared/makeVoxelRequestBuilder.ts
   :language: typescript
   :lines: 1-30
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and pulls in its tools. It is a factory (a function that builds another function) for the request that presses 'Build' send to the engine to build the 3-D voxel model — the model built as a stack of little cubes. The built request is shared by the Lithology and Geotechnical screens. It imports the section-input assembler, the API client, the voxel-request builder and its error type, the exclude-investigations helper, a freedraw flag, the segmenter-preferences reader, the logger, and the per-section edge fetch.

**Why it is here.** The comment records that the roughly-45-line callback bodies were byte-for-byte identical between the two screens except for the model id, the layer rows and the log label, so they were extracted here. It is asynchronous because correlation edges are section-scoped and must be fetched fresh at the moment Build is pressed — Solid view, the default, keeps no cache of them. It resolves to nothing when there is nothing to build, which the Build handler turns into a 'nothing to build' message; but it THROWS a build-inputs error when an input it needs failed to load, so that a model is never built from a partial set of correlations or boundaries (an audit finding from 2026-08-02). The model is (re)built only when the engineer presses Build, never silently on every edit.

.. CG-EXPLANATION-END id=module-header

``function sectionLabel``
-------------------------

.. CG-BLOCK id=function:sectionLabel lines=31-35

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/shared/makeVoxelRequestBuilder.ts
   :language: typescript
   :lines: 31-35
   :lineno-match:

.. CG-EXPLANATION-START id=function:sectionLabel

**What this does.** A tiny helper that turns a section id into its human-readable name, falling back to the id itself when no name is found.

**Why it is here.** So that a message the engineer reads names the cross-section, not a raw internal id.

.. CG-EXPLANATION-END id=function:sectionLabel

``interface VoxelRequestBuilderParams``
---------------------------------------

.. CG-BLOCK id=interface:VoxelRequestBuilderParams lines=36-75

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/shared/makeVoxelRequestBuilder.ts
   :language: typescript
   :lines: 36-75
   :lineno-match:

.. CG-EXPLANATION-START id=interface:VoxelRequestBuilderParams

**What this does.** Describes the snapshot of inputs the builder closes over (an 'interface' names the exact shape; a closure is a function that remembers the values from where it was made). The fields are: the project id, the model id, the visible sections, the investigations, the model's layer rows, the project's view-state bag (where the voxel-spacing preferences live), a log label, an optional litho frame (a frame model id plus its layer rows), and an optional geotech packing-class map.

**Why it is here.** The litho frame is set on the geotech screen only (owner 2026-08-18, 'densities on top of lithos'), so that the built model is the hierarchical fill the geotech axis actually renders; without it the build uses the model's own whole-section partition, which is what the litho screen wants. The packing-class map is the 'one mass one body' identity (owner 2026-08-21) and is omitted on litho builds.

.. CG-EXPLANATION-END id=interface:VoxelRequestBuilderParams

``type VoxelRequestBuilder``
----------------------------

.. CG-BLOCK id=type:VoxelRequestBuilder lines=76-106

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/shared/makeVoxelRequestBuilder.ts
   :language: typescript
   :lines: 76-106
   :lineno-match:

.. CG-EXPLANATION-START id=type:VoxelRequestBuilder

**What this does.** Names the type of the function this file hands back: a function that takes an optional set of investigation ids to exclude and returns, later, either a build request or nothing. A 'type' is just a written note of what kind of value is expected.

**Why it is here.** The optional exclude-set is the 'Build without these tests' feature (owner ruling 2026-08-26: building without them should reproduce the model that was there before those tests were added). Passing no set is today's ordinary build, unchanged.

.. CG-EXPLANATION-END id=type:VoxelRequestBuilder

``function makeVoxelRequestBuilder``
------------------------------------

.. CG-BLOCK id=function:makeVoxelRequestBuilder lines=107-282

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/shared/makeVoxelRequestBuilder.ts
   :language: typescript
   :lines: 107-282
   :lineno-match:

.. CG-EXPLANATION-START id=function:makeVoxelRequestBuilder

**What this does.** The factory. It captures the inputs and returns the async Build callback. That callback: returns nothing if there is no project, model or sections; logs any excluded tests; fetches each section's approved edges fresh and throws a build-inputs error (naming the sections) if any section's fetch failed; applies the exclusions per model; assembles the section inputs; loads every body's hand-drawn boundary — but only when freedraw editing is on, otherwise an empty map, and throws if a boundary load fails; optionally assembles the litho frame the same way (throwing on a frame-edge failure and applying the same exclusion); reads the voxel spacing preferences and the section names; and hands everything to the pure request builder.

**Why it is here.** Every throw guards the same thing: a model must never be built from a partial input set, because a fragmented model is indistinguishable from a correct one in the viewer and in every downstream export — before this guard the build would run on missing edges and persist the broken model behind a green 'Built N bodies' message (audit 2026-08-02). Boundaries are fetched only when freedraw editing is on because in that mode the 2-D fill withholds stored shapes, so the build must withhold them too, keeping the 3-D model and the 2-D view in step in both flag states. The exclusions are applied before assembly, per model, so an excluded test leaves behind no column, no layer and no dangling tie. The build honours the model's included ('honoured') boreholes, which pin the labelling.

.. CG-EXPLANATION-END id=function:makeVoxelRequestBuilder

