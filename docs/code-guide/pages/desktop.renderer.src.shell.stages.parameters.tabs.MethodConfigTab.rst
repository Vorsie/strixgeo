desktop.renderer.src.shell.stages.parameters.tabs.MethodConfigTab
=================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/parameters/tabs/MethodConfigTab.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/parameters/tabs/MethodConfigTab.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-40

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/tabs/MethodConfigTab.tsx
   :language: tsx
   :lines: 1-40
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file (the Methods tab — the parameter-source picker) and describes its shape in a long header comment before importing four icons, the translation hook, and the message-key type. The tab lays out three columns of method "cards": formula-driven correlations, table-driven Excel lookups, and probabilistic plus machine-learning hooks.

**Why it is here.** Owner directive (2026-05-21): correlation formulas and Excel table lookups are two DIFFERENT methods and must never be blended in one cell — the engineer picks ONE source path per parameter-and-unit pair so the downstream design tool gets an unambiguous input. The comment is candid that this is a structural skeleton today: the real correlation library, the full parameter table and the probabilistic schema are Phase-5 work. The surface is opened now so engineers and reviewers can see the three-pillar shape and push back on it before the Phase-5 budget is committed. Design-ready parameters are Phase 5 by scope; this tab only shows where they will be configured.

.. CG-EXPLANATION-END id=module-header

``interface MethodCardSpec``
----------------------------

.. CG-BLOCK id=interface:MethodCardSpec lines=41-50

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/tabs/MethodConfigTab.tsx
   :language: tsx
   :lines: 41-50
   :lineno-match:

.. CG-EXPLANATION-START id=interface:MethodCardSpec

**What this does.** Declares the shape of one method card: translation keys for its title, its reference, what it applies to and its status, plus a stable English test id. An interface names the shape of an object.

**Why it is here.** The visible text is held as translation keys so the card follows the app's language, while the test id is a fixed English string kept out of the translated catalogue so the automated end-to-end test selectors do not move when the language changes.

.. CG-EXPLANATION-END id=interface:MethodCardSpec

``const CORRELATION_CARDS``
---------------------------

.. CG-BLOCK id=const:CORRELATION_CARDS lines=51-88

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/tabs/MethodConfigTab.tsx
   :language: tsx
   :lines: 51-88
   :lineno-match:

.. CG-EXPLANATION-START id=const:CORRELATION_CARDS

**What this does.** The list of correlation cards — the formula-driven derivations: Robertson & Wride 1986, Mayne 2007, Kulhawy & Mayne 2014, Uzielli 2013, and Robertson 2015/2009 — each marked as a Phase-5 placeholder.

**Why it is here.** These are the published CPT correlations the Phase-5 parameter work will implement; listing them now shows the engineer which formula families the tool will offer, each with room for its reference, inputs and applicability, without committing the implementation yet. The references are the published Robertson and Mayne/Kulhawy/Uzielli papers.

.. CG-EXPLANATION-END id=const:CORRELATION_CARDS

``const XLSX_CARDS``
--------------------

.. CG-BLOCK id=const:XLSX_CARDS lines=89-105

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/tabs/MethodConfigTab.tsx
   :language: tsx
   :lines: 89-105
   :lineno-match:

.. CG-EXPLANATION-START id=const:XLSX_CARDS

**What this does.** The list of Excel-lookup cards: the standard NAD packing-class parameter table (a 38-by-313 spreadsheet) and an import slot for a project-specific spreadsheet — both Phase-5 placeholders.

**Why it is here.** Table lookups are the second, separate method path (never blended with the formulas per the owner directive). The standard table is the packing-class parameter table published in the Belgian national annex to Eurocode 7 (NBN EN 1997-1 ANB Tabel 2.1); the import slot exists for a firm's own project spreadsheet.

.. CG-EXPLANATION-END id=const:XLSX_CARDS

``const FUTURE_CARDS``
----------------------

.. CG-BLOCK id=const:FUTURE_CARDS lines=106-122

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/tabs/MethodConfigTab.tsx
   :language: tsx
   :lines: 106-122
   :lineno-match:

.. CG-EXPLANATION-START id=const:FUTURE_CARDS

**What this does.** The list of forward-looking cards: probabilistic distribution wiring (a deterministic value versus a mean-and-spread), and a machine-learning suggestion surface — both Phase-5 placeholders.

**Why it is here.** These sit in their own pillar because they are the most speculative. The comment is explicit that any ML prediction must surface as a side-by-side comparison for the engineer to judge and NEVER auto-apply, per the owner's directive on ML rigour.

.. CG-EXPLANATION-END id=const:FUTURE_CARDS

``function MethodConfigTab``
----------------------------

.. CG-BLOCK id=function:MethodConfigTab lines=123-161

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/tabs/MethodConfigTab.tsx
   :language: tsx
   :lines: 123-161
   :lineno-match:

.. CG-EXPLANATION-START id=function:MethodConfigTab

**What this does.** The tab component. It stacks the three pillars — Correlations, Excel lookups, and Probabilistic plus ML — each with a header and a grid of its cards, separated by thin rules, and closes with a small status note explaining the skeleton is intentional.

**Why it is here.** The three-pillar layout makes the hard separation of methods visible on screen: an engineer can see at a glance that formulas and lookups are distinct source paths, which is the whole point of opening the surface before the Phase-5 implementation lands.

.. CG-EXPLANATION-END id=function:MethodConfigTab

``interface PillarHeaderProps``
-------------------------------

.. CG-BLOCK id=interface:PillarHeaderProps lines=162-167

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/tabs/MethodConfigTab.tsx
   :language: tsx
   :lines: 162-167
   :lineno-match:

.. CG-EXPLANATION-START id=interface:PillarHeaderProps

**What this does.** Declares the inputs to a pillar header: an icon, a title and a subtitle. An interface names the shape of an object.

**Why it is here.** It fixes the small, fixed set of things a pillar header shows, so the three headers are built the same way.

.. CG-EXPLANATION-END id=interface:PillarHeaderProps

``function PillarHeader``
-------------------------

.. CG-BLOCK id=function:PillarHeader lines=168-179

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/tabs/MethodConfigTab.tsx
   :language: tsx
   :lines: 168-179
   :lineno-match:

.. CG-EXPLANATION-START id=function:PillarHeader

**What this does.** Draws one pillar's heading — the icon and title on one line, the subtitle beneath.

**Why it is here.** Extracted so all three pillars render an identical header shape from one piece of code rather than three copies.

.. CG-EXPLANATION-END id=function:PillarHeader

``function CardGrid``
---------------------

.. CG-BLOCK id=function:CardGrid lines=180-189

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/tabs/MethodConfigTab.tsx
   :language: tsx
   :lines: 180-189
   :lineno-match:

.. CG-EXPLANATION-START id=function:CardGrid

**What this does.** Lays out a list of cards in a responsive grid — one column on a narrow pane, up to three on a wide one.

**Why it is here.** Shared by all three pillars so the card grid behaves identically everywhere and the column count adapts to the pane width in one place.

.. CG-EXPLANATION-END id=function:CardGrid

``function MethodCard``
-----------------------

.. CG-BLOCK id=function:MethodCard lines=190-205

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/tabs/MethodConfigTab.tsx
   :language: tsx
   :lines: 190-205
   :lineno-match:

.. CG-EXPLANATION-START id=function:MethodCard

**What this does.** Draws one method card: its title, its reference line, what it applies to, and a small status badge ("Phase 5").

**Why it is here.** One card renderer keeps every method — correlation, lookup or future hook — looking the same, and stamps the test id so the end-to-end tests can find a specific card by its stable English name.

.. CG-EXPLANATION-END id=function:MethodCard

