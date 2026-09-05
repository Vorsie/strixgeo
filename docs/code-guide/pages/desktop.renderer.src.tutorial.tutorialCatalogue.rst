desktop.renderer.src.tutorial.tutorialCatalogue
===============================================

.. CG-PAGE source=desktop/src/renderer/src/tutorial/tutorialCatalogue.ts complete=true

*Source file:* ``desktop/src/renderer/src/tutorial/tutorialCatalogue.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-25

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/tutorialCatalogue.ts
   :language: typescript
   :lines: 1-25
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment and one import. The comment explains that this file is the tour written *as data* — its chapters and steps expressed as plain records rather than as code. It describes what each step record carries: which on-screen control to spotlight (``anchor``, a ``data-testid``), how the step completes (``done``), where its wording lives (``titleKey`` and ``bodyKey``), and which stage tab owns the anchor (``stage``, so the card can say ``open the … tab`` when the control is off screen). It notes that chapters 1-3 carry full drafted copy while chapters 4-8 are one-sentence skeletons, so the whole walk runs end to end and the owner's review is a copy pass; and that a test asserts every anchor exists under ``desktop/src``, every wording key exists in both language catalogues, ids are unique, and every do-it fact names a real state field. The import pulls in the ``TutorialState`` shape only.

**Why it is here.** A ``data-testid`` is a small invisible label attached to an on-screen control purely so tests and the tour can find it by name. Keeping the tour as *data* (not code) is what lets one small machine walk it and lets the tests check it completely. All wording is a draft held under *i18n keys* — an *i18n key* is a short name that stands for a piece of translated text — because the words themselves live in the app's language catalogues, honouring the ruling that the tutorial follows the app language (``docs/design/onboarding-activation-updater-proto.md``).

.. CG-EXPLANATION-END id=module-header

``type TutorialDone``
---------------------

.. CG-BLOCK id=type:TutorialDone lines=26-31

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/tutorialCatalogue.ts
   :language: typescript
   :lines: 26-31
   :lineno-match:

.. CG-EXPLANATION-START id=type:TutorialDone

**What this does.** Names the two ways a step can finish: the plain word ``'next'`` (an explain step — the user clicks Next), or a small record naming an observable fact (``{ state }``, a do-it step that finishes on its own when that fact becomes true).

**Why it is here.** A *union* type lists the allowed values, so a step's ``done`` is always exactly one of these two well-defined kinds — the same two kinds the ``isSatisfied`` helper tests on the ``tutorialMachine`` page.

.. CG-EXPLANATION-END id=type:TutorialDone

``type TutorialStage``
----------------------

.. CG-BLOCK id=type:TutorialStage lines=32-42

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/tutorialCatalogue.ts
   :language: typescript
   :lines: 32-42
   :lineno-match:

.. CG-EXPLANATION-START id=type:TutorialStage

**What this does.** Names the set of allowed stage values a step can belong to: ``'welcome'`` (the pre-project welcome screen, which has no stage tab) plus the seven workflow stages — data, sections, geology, lithology, geotechnical, parameters, and export.

**Why it is here.** The docstring explains that a step's anchor lives on one stage, so naming the exact set lets the card say ``open the … tab`` when that stage is not showing, and a mistyped stage is caught before the app runs rather than at run time.

.. CG-EXPLANATION-END id=type:TutorialStage

``interface CatalogueStep``
---------------------------

.. CG-BLOCK id=interface:CatalogueStep lines=43-60

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/tutorialCatalogue.ts
   :language: typescript
   :lines: 43-60
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CatalogueStep

**What this does.** The shape of one step: a stable unique id (which is also its saved-progress key), the 1-based chapter number it belongs to, the ``data-testid`` to spotlight, how it completes, the two translation keys for its title and body text, and the stage that must be open for the anchor to be visible.

**Why it is here.** One record per step keeps everything about a step in a single place. As the ``mk`` builder below shows, the id also forms the stem of the wording keys, so a step's identity and its wording can never drift apart.

.. CG-EXPLANATION-END id=interface:CatalogueStep

``interface TutorialChapter``
-----------------------------

.. CG-BLOCK id=interface:TutorialChapter lines=61-75

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/tutorialCatalogue.ts
   :language: typescript
   :lines: 61-75
   :lineno-match:

.. CG-EXPLANATION-START id=interface:TutorialChapter

**What this does.** Chapter-level information: the 1-based chapter number, a translation key for the chapter's name, and an OPTIONAL ``videoUrl`` — a link to a worked-example clip.

**Why it is here.** The comment records the ruling A7 (owner, 2026-09-02): the owner records tutorial clips on the worked-example project, and when a chapter has a URL the coach card shows a ``Watch the clip`` button that opens it in the system browser. It is unset today because no clips exist yet and the app is offline-first — videos are never bundled or fetched. This is the ``chapters carry an optional videoUrl`` ruling (``docs/design/onboarding-activation-updater-proto.md``).

.. CG-EXPLANATION-END id=interface:TutorialChapter

``const TUTORIAL_CHAPTERS``
---------------------------

.. CG-BLOCK id=const:TUTORIAL_CHAPTERS lines=76-90

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/tutorialCatalogue.ts
   :language: typescript
   :lines: 76-90
   :lineno-match:

.. CG-EXPLANATION-START id=const:TUTORIAL_CHAPTERS

**What this does.** The eight chapters in order, each with its number and a translation key for its title; none carries a video URL yet.

**Why it is here.** This is the ordered list the progress strip and the chapter lookups read. As the comment says, the titles are drafts for the owner to revise.

.. CG-EXPLANATION-END id=const:TUTORIAL_CHAPTERS

``function mk``
---------------

.. CG-BLOCK id=function:mk lines=91-109

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/tutorialCatalogue.ts
   :language: typescript
   :lines: 91-109
   :lineno-match:

.. CG-EXPLANATION-START id=function:mk

**What this does.** A tiny builder that assembles one step record from its parts, filling in the two wording keys automatically as ``tutorial.<id>.title`` and ``tutorial.<id>.body``.

**Why it is here.** The docstring explains the point: the id is the single source of truth for both a step's identity and its wording, so every step's copy is found by one predictable scheme and cannot be mistyped step by step.

.. CG-EXPLANATION-END id=function:mk

``const TUTORIAL_STEPS``
------------------------

.. CG-BLOCK id=const:TUTORIAL_STEPS lines=110-201

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/tutorialCatalogue.ts
   :language: typescript
   :lines: 110-201
   :lineno-match:

.. CG-EXPLANATION-START id=const:TUTORIAL_STEPS

**What this does.** The whole tour as one flat, ordered list of steps the machine walks straight through, grouped by comment into the eight chapters. Chapters 1-3 (your project, import, cross-sections) are fully drafted; chapters 4-8 (geological model, litho model, geotech, parameters, export) are skeletons. Each entry names its anchor control and how it completes — a do-it step names the observable fact that proves the user did the thing (a project opened, a CPT count above zero, a section created, contacts filled, litho layers accepted, solids built, a geotech model created), while an explain step is ``'next'``. Several inline comments record fixes made after the owner's own walkthroughs — for example leading the user to where the project settings live before the CRS field (a CRS is a coordinate reference system), pointing at Correlate before Build, and correcting an anchor that had matched no element.

**Why it is here.** One flat list is exactly what the linear machine on the ``tutorialMachine`` page walks. The anchors are real ``data-testid`` values that a companion test asserts exist under ``desktop/src``. The many owner-walk comments are the record of tuning the tour against real run-throughs (owner walk 2026-09-03) — each names the exact control and the reason it changed.

.. CG-EXPLANATION-END id=const:TUTORIAL_STEPS

``function chapterMeta``
------------------------

.. CG-BLOCK id=function:chapterMeta lines=202-204

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/tutorialCatalogue.ts
   :language: typescript
   :lines: 202-204
   :lineno-match:

.. CG-EXPLANATION-START id=function:chapterMeta

**What this does.** Looks up a chapter's record by its number, returning it or ``undefined`` when the number is out of range.

**Why it is here.** The docstring notes the overlay uses it to fetch a chapter's title key and any video URL for the coach card.

.. CG-EXPLANATION-END id=function:chapterMeta

