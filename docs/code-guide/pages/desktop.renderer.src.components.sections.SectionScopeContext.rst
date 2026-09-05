desktop.renderer.src.components.sections.SectionScopeContext
============================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/SectionScopeContext.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/SectionScopeContext.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-39

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/SectionScopeContext.tsx
   :language: tsx
   :lines: 1-39
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the file that defines the section-scope context — a shared bundle of read-only per-section data slices that the canvas derives once and the panel and its overlays read directly instead of receiving as long prop chains. A context is React's way to hand data down a tree without threading it through every layer. It imports React's context tools and the many data types the slices hold.

**Why it is here.** The docstring records the decisions: it replaces 26 of the panel's 69 threaded props (owner decision 13 July 2026), while the viewport transforms deliberately stay ordinary props; the provider value is intentionally not memoised because nothing under it is memoised, so a fresh object per render changes no behaviour and removes the stale-dependency failure mode; and the default is the all-absent scope so tests that mount without a provider get exactly the prop-omitted behaviour.

.. CG-EXPLANATION-END id=module-header

``interface SectionScope``
--------------------------

.. CG-BLOCK id=interface:SectionScope lines=40-290

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/SectionScopeContext.tsx
   :language: tsx
   :lines: 40-290
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SectionScope

**What this does.** The large named shape of every read-only data slice a section can provide: the vertical datum code, the CPT and borehole lists, the formation contacts and formation vocabulary, which model axis is active, whether the geotech model is built yet, the active litho model id, focusable and reference contacts and surfaces, excluded borehole ids, the undo-stack hook, snap tolerances, the built 3-D model solids and how to cut them, the litho and geotech correlation edges, crossing pinch-outs, detected bodies and their boundaries, accepted litho layers, the geotech model and its borehole preview, and the DOV virtual-boring overlay picker state.

**Why it is here.** Each field's comment records why it exists and how it differs from a neighbour — most load-bearing being that on the geotech axis the litho edges frame the partition and the geotech edges only drive the overlay ribbons (mixing them once pinched every litho band to a lens), and that the axis mode switches which picker dialog and which gestures are available.

.. CG-EXPLANATION-END id=interface:SectionScope

``const EMPTY_SECTION_SCOPE``
-----------------------------

.. CG-BLOCK id=const:EMPTY_SECTION_SCOPE lines=291-292

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/SectionScopeContext.tsx
   :language: tsx
   :lines: 291-292
   :lineno-match:

.. CG-EXPLANATION-START id=const:EMPTY_SECTION_SCOPE

**What this does.** The all-absent scope — an empty object standing for every optional slice being unset.

**Why it is here.** The comment: it mirrors the old optional-prop defaults, so code reading the scope outside a provider behaves exactly as if every prop had been omitted.

.. CG-EXPLANATION-END id=const:EMPTY_SECTION_SCOPE

``const SectionScopeContext``
-----------------------------

.. CG-BLOCK id=const:SectionScopeContext lines=293-303

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/SectionScopeContext.tsx
   :language: tsx
   :lines: 293-303
   :lineno-match:

.. CG-EXPLANATION-START id=const:SectionScopeContext

**What this does.** Creates the actual context object, seeded with the all-absent scope as its default.

**Why it is here.** This is the channel the canvas fills and the panel and overlays read; the default keeps test mounts safe.

.. CG-EXPLANATION-END id=const:SectionScopeContext

``function useSectionScope``
----------------------------

.. CG-BLOCK id=function:useSectionScope lines=304-306

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/SectionScopeContext.tsx
   :language: tsx
   :lines: 304-306
   :lineno-match:

.. CG-EXPLANATION-START id=function:useSectionScope

**What this does.** A one-line hook that returns the nearest provider's scope, or the all-absent default when there is no provider.

**Why it is here.** It is the single, tidy way any overlay reads the section slices, so callers never touch the raw context object.

.. CG-EXPLANATION-END id=function:useSectionScope

