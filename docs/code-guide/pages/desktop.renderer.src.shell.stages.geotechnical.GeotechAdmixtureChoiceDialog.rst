desktop.renderer.src.shell.stages.geotechnical.GeotechAdmixtureChoiceDialog
===========================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/geotechnical/GeotechAdmixtureChoiceDialog.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/geotechnical/GeotechAdmixtureChoiceDialog.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-32

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/GeotechAdmixtureChoiceDialog.tsx
   :language: tsx
   :lines: 1-32
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the file that draws the admixture question the geotech subdivision asks. The top comment records the owner's wording of the question — "we see you have an admixture here, which NAD classes do you want, pure sand or sand with admixture" — and states the shape: one row per admixture-ambiguous litho unit, two radio choices per row, no choice pre-ticked for a unit nobody has answered yet, and a Divide button that stays disabled until every listed unit has an answer. It then pulls in the pieces it draws with: a ``Button`` and a ``Modal`` (a pop-up dialog), the translation helper, the language switch, the soil-label lookup tables, the admixture-adjective helper, and the two data types it works with.

**Why it is here.** This is one of the two questions the geotech Build press asks before it runs, and the owner ruled on 2026-09-04 that a unit whose admixtures leave the NAD family ambiguous must be answered by the engineer, not guessed by the machine. It is deliberately a separate file from ``GeotechBuildPreflightDialog`` even though both sit in the same Build pre-flight flow, because it asks a different question (which NAD family, not which unbanded test) and gates the press differently (every unit must be answered, versus choosing a build option).

.. CG-EXPLANATION-END id=module-header

``const COARSE_SOILS``
----------------------

.. CG-BLOCK id=const:COARSE_SOILS lines=33-35

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/GeotechAdmixtureChoiceDialog.tsx
   :language: tsx
   :lines: 33-35
   :lineno-match:

.. CG-EXPLANATION-START id=const:COARSE_SOILS

**What this does.** A fixed set naming the two coarse soils, sand (``ZAND``) and gravel (``GRIND``).

**Why it is here.** It decides which "with admixture" wording a unit shows: a coarse soil forks on a clay or silt admixture, while every other forkable soil (silt, clay) forks on a sand admixture. Peat (``VEEN``) never forks, so it never reaches this dialog at all.

.. CG-EXPLANATION-END id=const:COARSE_SOILS

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=36-53

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/GeotechAdmixtureChoiceDialog.tsx
   :language: tsx
   :lines: 36-53
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** Names the inputs the dialog is handed by its parent — in this library those inputs are called "props". They are: ``open`` (whether to draw the dialog at all), ``units`` (the admixture-ambiguous litho units to answer), ``selections`` (the current answer for each unit, or nothing when still unanswered), ``onSelect`` (called when the engineer picks a family for one unit), ``onConfirm`` (called to save the answers and continue the press), ``onCancel`` (close without dividing), and an optional ``busy`` flag that disables every control while an action is running.

**Why it is here.** An ``interface`` in this language is just a written note about the shape of an object — here it lets the parent and the dialog agree exactly on what is passed between them. The caller owns whether the dialog is open, so the dialog itself never decides its own lifetime; it only reports the engineer's choices back up through the callbacks.

.. CG-EXPLANATION-END id=interface:Props

``function soilLabel``
----------------------

.. CG-BLOCK id=function:soilLabel lines=54-63

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/GeotechAdmixtureChoiceDialog.tsx
   :language: tsx
   :lines: 54-63
   :lineno-match:

.. CG-EXPLANATION-START id=function:soilLabel

**What this does.** Turns a raw soil code into its display name in whichever language the interface is set to — Dutch labels when the language is Dutch, English otherwise — and falls back to the raw code if no label is known.

**Why it is here.** Translation happens here, at the screen, not in storage: the domain keeps the raw soil token and this lookup table converts it for display (the translate-at-the-presentation-boundary rule). The fallback to the raw code means an unknown soil still shows something rather than a blank.

.. CG-EXPLANATION-END id=function:soilLabel

``function foundAdmixtureLabel``
--------------------------------

.. CG-BLOCK id=function:foundAdmixtureLabel lines=64-79

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/GeotechAdmixtureChoiceDialog.tsx
   :language: tsx
   :lines: 64-79
   :lineno-match:

.. CG-EXPLANATION-START id=function:foundAdmixtureLabel

**What this does.** Builds the phrase naming the admixture (or admixtures) that made this unit ambiguous — usually one word like "silty", but "silty, clayey" for a unit carrying both — for the sentence "This {soil} carries a {admixture} admixture."

**Why it is here.** The engineer needs to see WHY the question is being asked about this particular unit, so the found admixture is named in the row. Joining several with a comma covers the uncommon unit that carries more than one admixture (owner ruling 2026-09-05).

.. CG-EXPLANATION-END id=function:foundAdmixtureLabel

``function GeotechAdmixtureChoiceDialog``
-----------------------------------------

.. CG-BLOCK id=function:GeotechAdmixtureChoiceDialog lines=80-204

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/GeotechAdmixtureChoiceDialog.tsx
   :language: tsx
   :lines: 80-204
   :lineno-match:

.. CG-EXPLANATION-START id=function:GeotechAdmixtureChoiceDialog

**What this does.** The dialog itself — in this library a screen piece is drawn by a "component", a function that returns a description of what to show. It draws a titled pop-up listing one card per unit; each card names the unit, states which admixture was found (with the soil written in lower case because it sits mid-sentence), and offers two radio buttons: "Pure {soil}" (the clean NAD column) or "{soil} with admixture" (the with-admixture column). When any unit is still unanswered it shows a short gate note, and the footer carries a Cancel button and a Divide button that is only enabled once every unit has an answer. On opening, it moves the keyboard focus onto the very first radio button.

**Why it is here.** The owner asked the engineer to make each call deliberately, so no radio is pre-checked and Divide stays disabled until every unit is answered — a disabled primary button is a poor place to land focus, which is why focus goes to the first choice instead. It uses ``useRef`` (a handle to a real on-screen element that survives redraws) to hold that first radio, and ``useEffect`` (code that runs after the screen is drawn) to focus it when the dialog opens. The soil is lower-cased only in the mid-sentence "carries…" line, where Title Case reads wrong in English and Dutch alike (ux-reviewer 2026-09-05); the option labels keep their Title Case.

.. CG-EXPLANATION-END id=function:GeotechAdmixtureChoiceDialog

