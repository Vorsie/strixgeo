desktop.renderer.src.components.borelog.components.MTawAxis
===========================================================

.. CG-PAGE source=desktop/src/renderer/src/components/borelog/components/MTawAxis.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/borelog/components/MTawAxis.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-19

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/components/MTawAxis.tsx
   :language: tsx
   :lines: 1-19
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's imports and its documentation comment. It imports the datum-shortening helper, the axis-width constant, and three utilities — ``formatMtaw``, ``roundTo`` and ``usePxPerM``. The comment says this draws the absolute-level (Z) axis on the left edge of the log: a vertical guide line with tick marks at the surface, at every whole metre, and at the bottom; labels are signed absolute levels in the row's vertical datum; and a header chip above the axis names the datum (MTAW, NAP or plain M) so the numbers are never ambiguous.

**Why it is here.** This is the *depth axis* introduced on the ``desktop.renderer.src.components.borelog.components.AdmixtureChips`` page — the visible face of the shared mTAW-to-pixel rail every track is drawn against. The datum chip switches with the row's stored reference system so the axis never labels the numbers with a datum the row does not have. The comment notes the surface and bottom ticks are de-duplicated against the whole-metre ticks so a level does not print twice when it happens to fall on a whole metre.

.. CG-EXPLANATION-END id=module-header

``function MTawAxis``
---------------------

.. CG-BLOCK id=function:MTawAxis lines=20-91

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/components/MTawAxis.tsx
   :language: tsx
   :lines: 20-91
   :lineno-match:

.. CG-EXPLANATION-START id=function:MTawAxis

**What this does.** The axis component. It reads the shared pixels-per-metre scale, works out the bottom elevation from the surface level minus the drilled depth, and builds the set of tick levels: the surface, each whole metre in between, and the bottom. It draws the vertical guide line, the datum name chip at the top, and — for each tick, ordered from high to low — a short tick mark and its absolute level printed in a fixed-width font.

**Why it is here.** ``usePxPerM`` gives the same scale as every track, so each elevation label sits at exactly the height the tracks draw that depth — this is what makes all the tracks read against one rail. Elevations are drawn from the surface level down using the row's real surface elevation, honouring the project rule that a surveyed collar level is trusted as given (and that zero metres is a real level, never a stand-in for missing). All the axis colours come from theme variables so the axis stays legible in dark mode.

.. CG-EXPLANATION-END id=function:MTawAxis

