desktop.renderer.src.utils.geotechHierarchicalFill.constructive.bandContinuation
================================================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/bandContinuation.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/bandContinuation.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-58

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/bandContinuation.ts
   :language: typescript
   :lines: 1-58
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the module the docstring calls THE BRIDGE. Its job: when a band's own immediate neighbour column measured nothing at the band's own elevations — it is blind there because the ground is below that test's drilled depth — carry the band across that blind column into every gap between it and the far column that genuinely reads the ground, splicing the band in with its own true horizontal position. A gap is the space between two neighbouring columns. The file imports the carry type, the shared reads-the-ground test, the run types and the outward-walk helper it needs.

**Why it is here.** This encodes owner ruling 2026-08-25, 'if there is a column then it goes 0.45 to column B and doesn't paint right of that column'. The docstring records the ghost-wedge defect it fixes: this module used to ask a family-scoped question while its sibling ``facingHasData`` asked a section-wide one, so a column carrying another family's soil at the band's levels answered blind here and has-data there — and the band closed twice, once in its own gap and again in the gap beyond. Routing both through one shared predicate makes that double-close unrepresentable.

.. CG-EXPLANATION-END id=module-header

``const CONTACT_EPS``
---------------------

.. CG-BLOCK id=const:CONTACT_EPS lines=59-61

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/bandContinuation.ts
   :language: typescript
   :lines: 59-61
   :lineno-match:

.. CG-EXPLANATION-START id=const:CONTACT_EPS

**What this does.** A constant — a fixed named value — set to 1e-6, the elevation tolerance in metres within which a tie's endpoint counts as landing exactly on a given contact.

**Why it is here.** Floating-point arithmetic never lands two separately computed elevations on the identical number, so a tiny tolerance is what lets the code decide a tie endpoint and a contact are the same point. Contacts are stored on the millimetre grid, so a micrometre is far below anything real.

.. CG-EXPLANATION-END id=const:CONTACT_EPS

``interface ContinuationSplice``
--------------------------------

.. CG-BLOCK id=interface:ContinuationSplice lines=62-122

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/bandContinuation.ts
   :language: typescript
   :lines: 62-122
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ContinuationSplice

**What this does.** Declares the shape of one carry instruction: the band being carried, a list ``gaps`` of the gap indices the band must be spliced into (made visible in), a second list ``taperGaps`` of the gaps whose drawn shape must slope rather than run flat, and a ``carry`` recording where the taper finally closes.

**Why it is here.** The two lists answer deliberately different questions — ``gaps`` is where the band must be visible at all, ``taperGaps`` is where what is drawn must slope. The terminal gap is left out of the taper set on purpose: it already draws the pinch, and this carry only reproduces that same apex everywhere the band is seen earlier (owner ruling 2026-08-25, 'one smooth taper').

.. CG-EXPLANATION-END id=interface:ContinuationSplice

``function tiedAcrossGap``
--------------------------

.. CG-BLOCK id=function:tiedAcrossGap lines=123-153

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/bandContinuation.ts
   :language: typescript
   :lines: 123-153
   :lineno-match:

.. CG-EXPLANATION-START id=function:tiedAcrossGap

**What this does.** A helper answering: does any tie land on this exact contact AND actually terminate at the immediate neighbour's own column? It scans the ties, keeps only ones landing on the contact within ``CONTACT_EPS``, and then requires the tie's low and high columns to exactly equal this gap's two columns.

**Why it is here.** It encodes two owner code-hunt findings of 2026-08-22. First, a tie may disqualify only the specific direction it crosses, not any tie anywhere in the run, or a tie crossing a different gap would wrongly block this one. Second, equality not containment: a tie that skips past the blind neighbour onto a third column further out still leaves the immediate gap with no flank to draw from, so only a tie that terminates exactly at the neighbour settles that gap. The docstring flags this refinement as inert on the frozen CS1 scene and guarded only by the synthetic pin BC8, so the named real case is provenance, not a live test.

.. CG-EXPLANATION-END id=function:tiedAcrossGap

``function bandContinuations``
------------------------------

.. CG-BLOCK id=function:bandContinuations lines=154-228

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/bandContinuation.ts
   :language: typescript
   :lines: 154-228
   :lineno-match:

.. CG-EXPLANATION-START id=function:bandContinuations

**What this does.** The module's main function. For every band on every run column and in both directions, it skips the direction when a tie crosses the band's own immediate gap that way, skips when the immediate neighbour actually read the band's levels, and otherwise walks outward to find the far column that does read this ground. It then records a splice: which gaps must make the band visible, which gaps must taper, and the terminal gap's carry.

**Why it is here.** It realises the bridge for the geotech arm's gap-by-gap architecture, which needs only this one new idea rather than a parallel rule set. It uses the one shared reads-the-ground predicate (owner ruling 2026-08-25, 'data that disagrees is still data'): the neighbour blocks the carry when it measured anything at these levels, not just some of this family, and that single predicate is what stops the double-close ghost wedge.

.. CG-EXPLANATION-END id=function:bandContinuations

