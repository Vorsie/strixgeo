desktop.renderer.src.shell.stages.parameters.UnitDistributionPanels
===================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/parameters/UnitDistributionPanels.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/parameters/UnitDistributionPanels.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-38

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitDistributionPanels.tsx
   :language: tsx
   :lines: 1-38
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the per-unit distribution panel — a box plot plus a strip of the raw sample dots for qc, fs and Rf over one unit. The long comment records four design choices, and the imports pull in React's ``memo`` and ``useState``, the empty-state component, the translator and the child ``ChannelRow``. A box plot is a small chart that marks a distribution's quartiles and its range.

**Why it is here.** The comment states the reasoning. A raincloud's half-violin is a kernel density estimate whose bandwidth silently invents or hides a mode depending on how it is set, so on a panel whose whole point is to make no interpretive claim, a plain box plus the measurements themselves is the honest form. The panels read wide, not tall, because a distribution has no depth axis — it is a spread along one measurement axis — and three of them stack into the 420 px inspector. Each channel is its own chart because qc, fs and Rf have different units and ranges, so one shared axis would be the dual-axis mistake. The row was split into its own file when the second-dogfeed rulings pushed this past the 500-line gate (debt #201).

.. CG-EXPLANATION-END id=module-header

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=39-96

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitDistributionPanels.tsx
   :language: tsx
   :lines: 39-96
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** Declares the panel's inputs: the computed statistics, the already-resolved unit label, an optional count of CPTs that contributed no series, an optional one-line population note, the scope's total accepted band count, a flag for whether a single body is scoped, and an optional group-provenance list with its heading.

**Why it is here.** Most fields exist to keep a partial answer from reading as the whole unit. The pending count and the 'X of Y bands' line say when the pool is smaller than the scope owns (audit F7); the body-scoped flag makes the empty state blame the body, not the unit; and the provenance list shows which source litho bodies a grouped scope's members came from (debt #278, owner 2026-09-02).

.. CG-EXPLANATION-END id=interface:Props

``function UnitDistributionPanels``
-----------------------------------

.. CG-BLOCK id=function:UnitDistributionPanels lines=97-231

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitDistributionPanels.tsx
   :language: tsx
   :lines: 97-231
   :lineno-match:

.. CG-EXPLANATION-START id=function:UnitDistributionPanels

**What this does.** Draws the panel: a heading with the unit label and a fit-axes toggle button (offered only when there are samples), a band-count line that reads 'X of Y' when the pool covers fewer bands than the scope, the population note, the optional provenance bullets, then either an empty state or one ``ChannelRow`` per channel, and finally the characterisation-liability line. It remembers one boolean in state — whether the axes are fitted to the data.

**Why it is here.** The fit toggle is the S1 ruling (owner 2026-08-27): one button for the whole section, plain state, no persistence, and reverting restores the exact fixed axes; its label names the mode the press switches TO, and it appears only when there is something to scale (the no-affordance rule). The empty-state wording forks on whether a body is scoped because under a body scope the unit may hold plenty of cone bands while the scoped body has none (audit F7). The closing line states that every number above describes measurements that were taken and none of them is a design-ready parameter — the liability boundary made explicit.

.. CG-EXPLANATION-END id=function:UnitDistributionPanels

``default default``
-------------------

.. CG-BLOCK id=default:default lines=232-232

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitDistributionPanels.tsx
   :language: tsx
   :lines: 232-232
   :lineno-match:

.. CG-EXPLANATION-START id=default:default

**What this does.** Exports the panel wrapped in React's ``memo``.

**Why it is here.** ``memo`` caches the rendered output so the panel redraws only when its props actually change, not on every parent redraw.

.. CG-EXPLANATION-END id=default:default

