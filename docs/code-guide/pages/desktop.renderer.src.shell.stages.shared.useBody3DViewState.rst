desktop.renderer.src.shell.stages.shared.useBody3DViewState
===========================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/shared/useBody3DViewState.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/shared/useBody3DViewState.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-76

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/shared/useBody3DViewState.ts
   :language: typescript
   :lines: 1-76
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and pulls in its tools. This file is a custom hook — a reusable 'use...' function that packages stateful logic so several screens share it — holding the 3-D body-view plumbing common to the Geology, Lithology and Geotechnical screens. It owns the Solid/Fence view mode plus wireframe plus fence-loading flag; the split-viewport state and its handlers, plus publishing the toolbar's reset handle; the ground-surface terrain fetch; the lazy per-section approved-edge fetch used by Fence mode; the memoised investigation lists; and the fence-panel memos. It imports the 3-D library, the React hook functions, the API client, the shell context, the split-viewport rules, the footprint-ring helpers, the fence builders, the section-input assembler, the edge fetch, and the body-id resolver.

**Why it is here.** The comment records the extraction: the Geotechnical screen was a roughly-350-line word-for-word copy of the Lithology screen and the Geology screen carried a third copy of the split-state and ground-surface blocks, so the byte-identical blocks were pulled in here. The one thing deliberately left in each screen is the voxel-build handle lifecycle (debt #276), because clearing it on unmount must be guarded against a newer screen that has already reclaimed it, and only the writer can compare that identity. The Geology screen uses only the split and ground-surface parts (it passes fence-off and omits layers). Every hook here is called unconditionally so the call order is always the same whichever screen mounts it — the React rule that hooks must run in a stable order.

.. CG-EXPLANATION-END id=module-header

``const EMPTY_SURFACES_MAP``
----------------------------

.. CG-BLOCK id=const:EMPTY_SURFACES_MAP lines=77-79

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/shared/useBody3DViewState.ts
   :language: typescript
   :lines: 77-79
   :lineno-match:

.. CG-EXPLANATION-START id=const:EMPTY_SURFACES_MAP

**What this does.** A frozen, empty surfaces map that is always handed to the shared 3-D viewer on the litho and geotech panes, so no terrain (TIN) sheets ever draw there. A TIN is the triangulated surface the viewer draws for a terrain sheet.

**Why it is here.** The viewer's Surfaces legend toggle and its draw loop are both switched on only when the map has vertices, so an empty map switches both off without changing the shared viewer at all. It is defined at the top level so its identity is stable across redraws; the geology pane passes its own real surfaces map and is unaffected.

.. CG-EXPLANATION-END id=const:EMPTY_SURFACES_MAP

``const NO_LAYERS``
-------------------

.. CG-BLOCK id=const:NO_LAYERS lines=80-82

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/shared/useBody3DViewState.ts
   :language: typescript
   :lines: 80-82
   :lineno-match:

.. CG-EXPLANATION-START id=const:NO_LAYERS

**What this does.** A stable, empty layer list used by screens that never build a fence (the Geology screen).

**Why it is here.** So the hook has one fixed, identity-stable value to fall back to when no layers are supplied, rather than making a fresh empty list each redraw.

.. CG-EXPLANATION-END id=const:NO_LAYERS

``const NO_SOLIDS``
-------------------

.. CG-BLOCK id=const:NO_SOLIDS lines=83-85

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/shared/useBody3DViewState.ts
   :language: typescript
   :lines: 83-85
   :lineno-match:

.. CG-EXPLANATION-START id=const:NO_SOLIDS

**What this does.** A stable, empty list of body solids used by screens that draw terrain sheets rather than body solids (the Geology screen).

**Why it is here.** Same reason as the empty layer list: one fixed, identity-stable fallback value instead of a new empty list on every redraw.

.. CG-EXPLANATION-END id=const:NO_SOLIDS

``interface UseBody3DViewStateOptions``
---------------------------------------

.. CG-BLOCK id=interface:UseBody3DViewStateOptions lines=86-139

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/shared/useBody3DViewState.ts
   :language: typescript
   :lines: 86-139
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseBody3DViewStateOptions

**What this does.** Describes the hook's inputs (an 'interface' names the exact shape). The fields are: the active model id; an optional litho frame (a frame model id plus its layer rows); the model's layer rows (omitted on Geology); the built body solids (used only to place the footprint ring); the shared reset-split handle the toolbar uses; a fence-active gate; a footprint-active gate; and an optional geotech packing-class map.

**Why it is here.** The litho frame is set on the geotech screen only ('densities on top of lithos', owner 2026-08-18). The fence-active and footprint-active gates default to on (the Lithology case); Geology passes them off, which leaves the fence and footprint machinery inert — a footprint is the boundary hull of a voxel build, which only the litho and geotech models ever have, so requesting one on Geology would only add a wasted round trip and two 'never built' server log lines.

.. CG-EXPLANATION-END id=interface:UseBody3DViewStateOptions

``interface Body3DViewState``
-----------------------------

.. CG-BLOCK id=interface:Body3DViewState lines=140-190

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/shared/useBody3DViewState.ts
   :language: typescript
   :lines: 140-190
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Body3DViewState

**What this does.** Describes what the hook hands back: the project id; the Solid/Fence view mode and its setter; wireframe and its setter; the fence-loading flag; the split mode, plane and line and the three split verbs (store-a-drawn-cut, exit, enter-compare); the model footprint ring; the ground-surface terrain; the investigations and their (x, y) positions; and the fence panels.

**Why it is here.** It returns exactly the view state and derived values the three screens need, so all three can share this one implementation. The view-mode and split state are marked session-only — they are not saved into the project bundle.

.. CG-EXPLANATION-END id=interface:Body3DViewState

``function useBody3DViewState``
-------------------------------

.. CG-BLOCK id=function:useBody3DViewState lines=191-541

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/shared/useBody3DViewState.ts
   :language: typescript
   :lines: 191-541
   :lineno-match:

.. CG-EXPLANATION-START id=function:useBody3DViewState

**What this does.** The hook body. It reads the shell context (the project, the visible CPTs and boreholes, the visible sections, the toast dispatcher) and derives the project id. It owns the view-mode, wireframe and fence-loading state; owns the split-viewport state as one value with the three transition helpers, and publishes the exit handler to the toolbar's reset handle on every redraw. It fires a fire-and-forget ground-surface terrain fetch keyed on the model id, and a footprint-polygon fetch keyed on the model id. It lazily fetches the per-section approved edges whenever Fence mode is active, warning by toast when a section's edges fail to load. It memoises the investigations and their positions, assembles the fence section inputs and the litho frame's inputs, builds the fence panels only in Fence mode (collapsing each section's per-gap panels to one panel per connected body), and computes the footprint ring at the top of whatever the pane renders. A hook function like useEffect runs work after each redraw and can clean up before the next; useMemo caches a computed value so it is not rebuilt every redraw.

**Why it is here.** The split state is one value so a stale cut plane left behind by a mode change is impossible to represent. The terrain and footprint fetches are keyed on the stable id strings alone, so a server refresh that returns a new model object with the same id does not needlessly re-fire them; the known limit is that a rebuild in the same session leaves a slightly stale footprint ring until the next model switch. The footprint is fetched, never recomputed here, so the ring the engineer sees is the build's own boundary and there is only one source of truth for the hull. A failed edge fetch resolves to zero edges, which is indistinguishable from 'this section genuinely has no correlations', so where the build path can refuse outright a view cannot — it warns instead, naming the sections (audit 2026-08-02). All the hooks run unconditionally so the call order stays stable across the three screens.

.. CG-EXPLANATION-END id=function:useBody3DViewState

