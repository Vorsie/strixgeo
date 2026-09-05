desktop.renderer.src.shell.stages.geotechnical.GeotechBuildReportBanner
=======================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/geotechnical/GeotechBuildReportBanner.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/geotechnical/GeotechBuildReportBanner.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-47

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/GeotechBuildReportBanner.tsx
   :language: tsx
   :lines: 1-47
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the file that draws the gapless build report — the little trust readout in the corner of the Geotechnical stage. The long comment lays out the design: it reports but never blocks (the solids are written either way), a kept promise is shown rather than left silent, an unmeasured clause is never green, colour is never the only signal, and a spot is only one press away when there is somewhere to go. It then pulls in ``useState`` (a way to remember a value between redraws), four small icons, the translation helper, and the report data types.

**Why it is here.** It exists to measure the owner's 2026-08-26 constraint — "I can't have gaps or fallbacks in the model unless users make mistakes" — on every build. Seven clauses check that promise; this is where the verdict is read. It is a corner panel rather than a pop-up precisely because the engineer must look at the model and the verdict at the same time to act on a finding like "Tie-section 7, gap 12", and it is positioned bottom-right because the other three corners and the top centre of the canvas are already taken.

.. CG-EXPLANATION-END id=module-header

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=48-75

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/GeotechBuildReportBanner.tsx
   :language: tsx
   :lines: 48-75
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** Names the two inputs the banner is handed: ``report`` (the last build's seven-clause verdict, or nothing when there is no verdict) and ``onVisitSpot`` (a function that walks the engineer to a named spot — the section, plus the gap's own two columns named by their tests).

**Why it is here.** An ``interface`` is a written note about the shape of what is passed in. A ``null`` report draws nothing on purpose: a model never built, or built by a version older than the gate, has nothing honest to say, and a permanent grey "no verdict" strip would only train the engineer to stop reading this corner. The gap is handed over by the NAMES of its two columns rather than by its position index, because that index means a different gap on the geotech axis than on the litho frame it was measured against — passing the index across that boundary once centred the wrong gap.

.. CG-EXPLANATION-END id=interface:Props

``const VERDICT_STYLE``
-----------------------

.. CG-BLOCK id=const:VERDICT_STYLE lines=76-113

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/GeotechBuildReportBanner.tsx
   :language: tsx
   :lines: 76-113
   :lineno-match:

.. CG-EXPLANATION-START id=const:VERDICT_STYLE

**What this does.** A lookup giving each of the three verdicts — pass, fail, incomplete — its own text colour, border colour and icon (a check circle, a warning triangle, a question-mark circle).

**Why it is here.** Colour is never the only signal (WCAG 2.2 AA, docs/ux.md): every verdict also carries its own glyph, so an engineer who cannot separate the colours still reads the state from the icon.

.. CG-EXPLANATION-END id=const:VERDICT_STYLE

``function summaryOf``
----------------------

.. CG-BLOCK id=function:summaryOf lines=114-129

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/GeotechBuildReportBanner.tsx
   :language: tsx
   :lines: 114-129
   :lineno-match:

.. CG-EXPLANATION-START id=function:summaryOf

**What this does.** Builds the one-line summary sentence from a report: how many clauses failed out of the total, how many could not be checked, and — only on a clean, fully measured report — the phrase "no gaps".

**Why it is here.** It is a plain helper, not a component, so it is handed the translator as an argument rather than calling for it itself. The clean phrasing is pinned by the tests because it is the exact wording the owner will read as the guarantee that the model has no gaps; an unmeasured clause is folded into the summary rather than being quietly reported as a pass.

.. CG-EXPLANATION-END id=function:summaryOf

``function EntryRow``
---------------------

.. CG-BLOCK id=function:EntryRow lines=130-174

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/GeotechBuildReportBanner.tsx
   :language: tsx
   :lines: 130-174
   :lineno-match:

.. CG-EXPLANATION-START id=function:EntryRow

**What this does.** Draws one named finding inside a clause — a bullet, its label, and a "Show me" button, but only when the finding actually names a section to walk to. When pressed, the button asks the parent to open that section and, if the finding also named the gap's two columns, to centre on them.

**Why it is here.** It tests whether the section id is truthy rather than merely present, because the backend sends an absent locator as an explicit null and an empty-string id is no id either — testing the slot instead of the value once put a "Show me" button on findings that stand nowhere. The gap's columns follow the same rule: an empty list is exactly as unusable as no list, so both collapse to "open the section and centre nothing".

.. CG-EXPLANATION-END id=function:EntryRow

``function ClauseRow``
----------------------

.. CG-BLOCK id=function:ClauseRow lines=175-239

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/GeotechBuildReportBanner.tsx
   :language: tsx
   :lines: 175-239
   :lineno-match:

.. CG-EXPLANATION-START id=function:ClauseRow

**What this does.** Draws one of the seven clauses in the expandable detail list: a pass/fail/unmeasured mark and colour, the clause number and title, an italic "not checked" reason when the clause could not be evaluated, and — beneath it — a row for each named finding.

**Why it is here.** Each finding under a clause has no id of its own, so its position in the clause is used as its React key; that order is the engine's and is stable for a given build, which is enough for a list that is only rebuilt when a new build lands. The not-checked reason is shown so an unmeasured clause explains itself rather than sitting as a bare amber mark.

.. CG-EXPLANATION-END id=function:ClauseRow

``function GeotechBuildReportBanner``
-------------------------------------

.. CG-BLOCK id=function:GeotechBuildReportBanner lines=240-313

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/GeotechBuildReportBanner.tsx
   :language: tsx
   :lines: 240-313
   :lineno-match:

.. CG-EXPLANATION-START id=function:GeotechBuildReportBanner

**What this does.** The banner component itself. It draws nothing when there is no report; otherwise it shows a corner card with the verdict icon, the "Model check" label, the one-line summary, and — right there, without opening anything — the names of any broken promises. A disclosure button expands a scrollable list of all seven clauses with their findings.

**Why it is here.** The ``useState`` that remembers whether the detail list is open is declared ABOVE the early "return nothing" line, because the order of these React features must not depend on whether a verdict exists (the project's hook-order rule). The broken promises are named without expanding anything because the whole value of the report is that the engineer does not have to hunt. It announces itself as a status, not an alert, so it never talks over whatever the engineer is reading — it only appears after a build they just ran.

.. CG-EXPLANATION-END id=function:GeotechBuildReportBanner

