desktop.renderer.src.utils.geotechStatistic
===========================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotechStatistic.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotechStatistic.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-15

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechStatistic.ts
   :language: typescript
   :lines: 1-15
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file holds the vocabulary of the four statistics the NAD classifier can use to read a band's representative cone resistance (qc), shared by the toolbar selector and the subdivide press that carries the choice. The comment records the owner rulings that made the statistic a per-geotech-model choice and then made it choosable before that model exists, which is why the token now travels from the toolbar into the subdivide request rather than living inside one menu.

**Why it is here.** The reasons are the owner rulings recorded in the comment (debt #227, and 2026-08-15: choosing the statistic before the first subdivide is friction he did not want). The four tokens are deliberately exactly the backend's own set and the values its database constraint allows, so a fifth token here would be rejected as a 422 there. Which statistic represents a band's qc is a characterisation choice that feeds the NAD packing classification (a Belgian-annex characterisation output, NBN EN 1997-1 ANB Tabel 2.1); the value itself is computed in the engine, not here.

.. CG-EXPLANATION-END id=module-header

``type GeotechStatistic``
-------------------------

.. CG-BLOCK id=type:GeotechStatistic lines=16-23

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechStatistic.ts
   :language: typescript
   :lines: 16-23
   :lineno-match:

.. CG-EXPLANATION-START id=type:GeotechStatistic

**What this does.** Names the type that can only be one of the four statistic tokens: median, arithmetic, harmonic or geometric.

**Why it is here.** A *type* fixes the allowed set so a stray token is caught before the app runs, and these four are the only values the backend accepts.

.. CG-EXPLANATION-END id=type:GeotechStatistic

``const GEOTECH_STATISTICS``
----------------------------

.. CG-BLOCK id=const:GEOTECH_STATISTICS lines=24-31

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechStatistic.ts
   :language: typescript
   :lines: 24-31
   :lineno-match:

.. CG-EXPLANATION-START id=const:GEOTECH_STATISTICS

**What this does.** The four statistics in menu order, with median first.

**Why it is here.** Median leads because it is the backend's default — the one a model is created under when the engineer expresses no preference — so the menu opens on the value a model already has.

.. CG-EXPLANATION-END id=const:GEOTECH_STATISTICS

``const DEFAULT_GEOTECH_STATISTIC``
-----------------------------------

.. CG-BLOCK id=const:DEFAULT_GEOTECH_STATISTIC lines=32-32

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechStatistic.ts
   :language: typescript
   :lines: 32-32
   :lineno-match:

.. CG-EXPLANATION-START id=const:DEFAULT_GEOTECH_STATISTIC

**What this does.** The statistic a model with no explicit choice classifies with: median.

**Why it is here.** It mirrors the backend default so the desktop and the engine agree on what an unchosen model uses.

.. CG-EXPLANATION-END id=const:DEFAULT_GEOTECH_STATISTIC

