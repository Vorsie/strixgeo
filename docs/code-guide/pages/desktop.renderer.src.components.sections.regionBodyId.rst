desktop.renderer.src.components.sections.regionBodyId
=====================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/regionBodyId.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/regionBodyId.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-36

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/regionBodyId.ts
   :language: typescript
   :lines: 1-36
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A pure helper that finds the one resolver BODY behind a computed fill region, used by the fill's jump to unit statistics. A body is a resolver connected component, a group of drilled layers all linked to each other directly or through a chain of approved correlations. The comment explains why it resolves through the region's own layers, not through the region's ``bodyId`` label.

**Why it is here.** A region's ``bodyId`` field is the label the body recompute rewrites (it oscillated when fed back on itself), and on the geotech axis the hierarchical fill can label a face from the litho frame instead, so the label is unreliable as identity. The drilled ``litho_layer`` rows whose ground produced the paint are the label-independent identity, so the jump resolves through the layers' own ``body_id``, the same authority the statistics pool filters on. Owner body-scope ruling 2026-08-27.

.. CG-EXPLANATION-END id=module-header

``function resolveRegionBodyId``
--------------------------------

.. CG-BLOCK id=function:resolveRegionBodyId lines=37-50

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/regionBodyId.ts
   :language: typescript
   :lines: 37-50
   :lineno-match:

.. CG-EXPLANATION-START id=function:resolveRegionBodyId

**What this does.** Given a region's layer ids and a layer-to-body lookup, returns the single body those layers all agree on, or nothing. Exactly one distinct stamped body among the layers wins; several distinct bodies, or no stamped body at all, or no layers, all give nothing.

**Why it is here.** Task ruling, verbatim: a region whose layers span several bodies (which should not happen for one mass) or none reports null and stays formation-level. Layers the resolver has not stamped yet count as silence, not disagreement, so they never veto the one real body that is present.

.. CG-EXPLANATION-END id=function:resolveRegionBodyId

