desktop.renderer.src.utils.lithoLabels
======================================

.. CG-PAGE source=desktop/src/renderer/src/utils/lithoLabels.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/lithoLabels.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-61

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoLabels.ts
   :language: typescript
   :lines: 1-61
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment and the imports. This file turns the raw stored codes of a lithostratigraphic unit — its base soil plus any admixtures — into a readable English display label. It imports the admixture data shape, the base-lithology label tables, the language selector, and the Dutch admixture tables.

**Why it is here.** The comment records that this module is the translation boundary: the base-lithology codes come from the engine's ``BASE_LITHOLOGIES``, the admixture soil and amount codes come from the DOV vocabulary, and all of them stay raw and Dutch in the database and API — translated only here for display, never at ingest (CLAUDE.md UX Conventions). It produces a pipe-delimited label (the main soil in capitals, then one admixture per pipe-separated field), with the raw DOV codes still visible in dropdowns and tooltips so engineers can cross-check. The comment also records the format history: it produced Dutch prose until 2026-05-21, then switched to the pipe format because prose produced broken English when an amount adverb collided with a "with X" phrase; the stored Dutch tokens never changed.

.. CG-EXPLANATION-END id=module-header

``const ADMIXTURE_SOIL_EN``
---------------------------

.. CG-BLOCK id=const:ADMIXTURE_SOIL_EN lines=62-130

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoLabels.ts
   :language: typescript
   :lines: 62-130
   :lineno-match:

.. CG-EXPLANATION-START id=const:ADMIXTURE_SOIL_EN

**What this does.** A lookup table from an admixture soil code to its English adjective ("clayey", "silty") or, for coarse inclusions, a "with X" phrase ("with shell debris"). It covers the core five soils, grain-size variants, organics, carbonates and shells, minerals, and man-made material.

**Why it is here.** The comment records that the source is the DOV master soil-name codelist of 108 codes, and that a borehole admixture can be any of those 108, not just the five core soils. Only the codes that actually turn up as admixtures in practice are given a curated English adjective; the rest fall through to the Dutch-description fallback below, which avoids the old failure where an unknown code showed as its raw token ("om", "xz"). The adjective form follows NEN 5104 / Belgian field-description practice, put into English.

.. CG-EXPLANATION-END id=const:ADMIXTURE_SOIL_EN

``const ADMIXTURE_SOIL_FALLBACK_DUTCH``
---------------------------------------

.. CG-BLOCK id=const:ADMIXTURE_SOIL_FALLBACK_DUTCH lines=131-172

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoLabels.ts
   :language: typescript
   :lines: 131-172
   :lineno-match:

.. CG-EXPLANATION-START id=const:ADMIXTURE_SOIL_FALLBACK_DUTCH

**What this does.** A last-resort lookup from the long tail of soil-name codes — rock types, evaporites, metamorphic rocks — to an English description.

**Why it is here.** The comment records that these codes almost never appear as an admixture in normal use but are still part of the DOV vocabulary, so they are given a graceful label of last resort ("with andesite" instead of the bare code "ab").

.. CG-EXPLANATION-END id=const:ADMIXTURE_SOIL_FALLBACK_DUTCH

``const ADMIXTURE_AMOUNT_EN``
-----------------------------

.. CG-BLOCK id=const:ADMIXTURE_AMOUNT_EN lines=173-196

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoLabels.ts
   :language: typescript
   :lines: 173-196
   :lineno-match:

.. CG-EXPLANATION-START id=const:ADMIXTURE_AMOUNT_EN

**What this does.** A lookup table from an amount code to the English adverb placed in front of a soil adjective — slightly, moderately, very, strongly, weakly — plus "with" and two range values.

**Why it is here.** The comment records that the source is the DOV quantity vocabulary. It notes that the amount code V is the same letter as the peat soil code, but the field it appears in decides the reading, and that the generic "unspecified intensity" marker N is mapped to a plain "with" rather than left as a raw "N" in the label.

.. CG-EXPLANATION-END id=const:ADMIXTURE_AMOUNT_EN

``const ADMIXTURE_AMOUNT_QUANTITY_EN``
--------------------------------------

.. CG-BLOCK id=const:ADMIXTURE_AMOUNT_QUANTITY_EN lines=197-218

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoLabels.ts
   :language: typescript
   :lines: 197-218
   :lineno-match:

.. CG-EXPLANATION-START id=const:ADMIXTURE_AMOUNT_QUANTITY_EN

**What this does.** A lookup table from an amount code to an English quantity word — trace, little, some, much, abundant — for the noun-phrase admixtures (the "with X" group like shell debris and fossils).

**Why it is here.** The comment records why this is a separate table: a noun-phrase admixture reads with a quantity in front of the noun ("little shell debris"), whereas an amount adverb ("slightly") only works in front of an adjective ("slightly clayey"), so the two groups need different words.

.. CG-EXPLANATION-END id=const:ADMIXTURE_AMOUNT_QUANTITY_EN

``const ADMIXTURE_SOIL_OPTIONS``
--------------------------------

.. CG-BLOCK id=const:ADMIXTURE_SOIL_OPTIONS lines=219-278

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoLabels.ts
   :language: typescript
   :lines: 219-278
   :lineno-match:

.. CG-EXPLANATION-START id=const:ADMIXTURE_SOIL_OPTIONS

**What this does.** The public, ordered list of curated admixture-soil choices for dropdowns, each a code paired with a human label; ordered core soils, then grain-size variants, organics, carbonates, minerals, man-made, and misc.

**Why it is here.** The docstring records that the picker dialog and the ghost composition editor share this list so stored values match what the dropdowns can express; the old five-option dropdown silently fell back to "Gravel (GL)" for any unknown stored code, causing the reported mismatch where the dropdown said "Gravel" but the preview showed "very om Silt".

.. CG-EXPLANATION-END id=const:ADMIXTURE_SOIL_OPTIONS

``const ADMIXTURE_AMOUNT_OPTIONS``
----------------------------------

.. CG-BLOCK id=const:ADMIXTURE_AMOUNT_OPTIONS lines=279-296

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoLabels.ts
   :language: typescript
   :lines: 279-296
   :lineno-match:

.. CG-EXPLANATION-START id=const:ADMIXTURE_AMOUNT_OPTIONS

**What this does.** The public list of amount choices for dropdowns, each a code paired with a label, from "unspecified" through the single steps to the two range values.

**Why it is here.** The docstring records that it is shared with the picker dialog and the ghost composition editor so the dropdown and the stored values stay in step.

.. CG-EXPLANATION-END id=const:ADMIXTURE_AMOUNT_OPTIONS

``function admixtureSoilLabel``
-------------------------------

.. CG-BLOCK id=function:admixtureSoilLabel lines=297-315

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoLabels.ts
   :language: typescript
   :lines: 297-315
   :lineno-match:

.. CG-EXPLANATION-START id=function:admixtureSoilLabel

**What this does.** Looks up the English adjective for an admixture soil code: the curated English table first, then the Dutch-description fallback, and finally the raw code in lower case if neither has it.

**Why it is here.** The docstring records that it is used both by the formatter and by the dialog when it must label a stored value that is not in the curated options; the graceful fallback chain means no raw alphanumeric token ever reaches the user-facing label.

.. CG-EXPLANATION-END id=function:admixtureSoilLabel

``function admixtureSoilAdjective``
-----------------------------------

.. CG-BLOCK id=function:admixtureSoilAdjective lines=316-366

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoLabels.ts
   :language: typescript
   :lines: 316-366
   :lineno-match:

.. CG-EXPLANATION-START id=function:admixtureSoilAdjective

**What this does.** Returns the admixture adjective in the active interface language — the Dutch word (siltig, kleiig, zandig) when the language is Dutch, otherwise the English one, with the English word as a graceful fallback for codes the Dutch table does not cover.

**Why it is here.** The docstring records that the geotech admixture prompt uses it to name the admixture it found (owner ruling 2026-09-05), and that it makes the same language choice as the Dutch vocabulary's soil function.

.. CG-EXPLANATION-END id=function:admixtureSoilAdjective

``function formatLithoDisplayName``
-----------------------------------

.. CG-BLOCK id=function:formatLithoDisplayName lines=367-378

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoLabels.ts
   :language: typescript
   :lines: 367-378
   :lineno-match:

.. CG-EXPLANATION-START id=function:formatLithoDisplayName

**What this does.** The English formatter: builds the pipe-delimited display name — main soil in capitals, then one field per admixture — by handing the shared composer the English vocabulary.

**Why it is here.** The docstring records that adjective admixtures take an amount adverb while noun-phrase ("with X") admixtures drop the "with" and take a quantity word; this English form is the language-stable one used by the export path.

.. CG-EXPLANATION-END id=function:formatLithoDisplayName

``interface LithoVocab``
------------------------

.. CG-BLOCK id=interface:LithoVocab lines=379-388

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoLabels.ts
   :language: typescript
   :lines: 379-388
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LithoVocab

**What this does.** A record describing everything the composer needs for one language: the base-label table, a function giving the soil adjective, the amount and quantity tables, the "locally" prefix, and the "with" connective.

**Why it is here.** The docstring records that choosing this table by language IS the whole language switch — the composing logic is shared, so English and Dutch can never end up formatted differently.

.. CG-EXPLANATION-END id=interface:LithoVocab

``const EN_VOCAB``
------------------

.. CG-BLOCK id=const:EN_VOCAB lines=389-397

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoLabels.ts
   :language: typescript
   :lines: 389-397
   :lineno-match:

.. CG-EXPLANATION-START id=const:EN_VOCAB

**What this does.** The English vocabulary bundle, wired to the English tables and the connectives "locally " and "with ".

**Why it is here.** It is the English half of the shared composer's language switch.

.. CG-EXPLANATION-END id=const:EN_VOCAB

``const NL_VOCAB``
------------------

.. CG-BLOCK id=const:NL_VOCAB lines=398-414

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoLabels.ts
   :language: typescript
   :lines: 398-414
   :lineno-match:

.. CG-EXPLANATION-START id=const:NL_VOCAB

**What this does.** The Dutch vocabulary bundle, wired to the Dutch tables and the connectives "plaatselijk " and "met "; its soil function tries the Dutch word first and falls back to the English adjective.

**Why it is here.** The comment records the Dutch-first, English-fallback rule so a code the Dutch table does not curate still renders rather than showing a raw token.

.. CG-EXPLANATION-END id=const:NL_VOCAB

``function stripWithPrefix``
----------------------------

.. CG-BLOCK id=function:stripWithPrefix lines=415-443

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoLabels.ts
   :language: typescript
   :lines: 415-443
   :lineno-match:

.. CG-EXPLANATION-START id=function:stripWithPrefix

**What this does.** Removes a leading "with " or "met " from an admixture label, reporting whether it was a noun-phrase and returning the remaining core word.

**Why it is here.** The docstring records that the Dutch fallback can return an English adjective that still starts with "with ", so both connectives are recognised whatever the active language, ensuring a mixed fallback never leaves a stray English "with" inside a Dutch label.

.. CG-EXPLANATION-END id=function:stripWithPrefix

``function composeLithoName``
-----------------------------

.. CG-BLOCK id=function:composeLithoName lines=444-492

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoLabels.ts
   :language: typescript
   :lines: 444-492
   :lineno-match:

.. CG-EXPLANATION-START id=function:composeLithoName

**What this does.** The shared composer. It capitalises the base soil name, then for each admixture picks the soil word, decides whether it is an adjective or a "with X" noun-phrase, puts the right amount or quantity word in front, adds a "locally" prefix when flagged, and joins the fields with pipes.

**Why it is here.** The docstring records that the pipe format and noun-phrase handling are identical in every language and only the words differ — which is exactly what the vocabulary supplies — so it was extracted once and shared by the English formatter and the active-language formatter (CLAUDE.md "extract on the second copy").

.. CG-EXPLANATION-END id=function:composeLithoName

``function lithoDisplayName``
-----------------------------

.. CG-BLOCK id=function:lithoDisplayName lines=493-511

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoLabels.ts
   :language: typescript
   :lines: 493-511
   :lineno-match:

.. CG-EXPLANATION-START id=function:lithoDisplayName

**What this does.** The active-language formatter: composes the pipe-delimited name using the Dutch vocabulary when the language is Dutch, otherwise the English one.

**Why it is here.** The docstring records that this is the UI-facing formatter every on-screen litho label should use so names follow the language toggle, while the English ``formatLithoDisplayName`` stays the language-stable form used by exports (fence DXF layer names) — because an export is a contract that must read the same whatever the interface language.

.. CG-EXPLANATION-END id=function:lithoDisplayName

``function lithoBaseLabel``
---------------------------

.. CG-BLOCK id=function:lithoBaseLabel lines=512-515

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoLabels.ts
   :language: typescript
   :lines: 512-515
   :lineno-match:

.. CG-EXPLANATION-START id=function:lithoBaseLabel

**What this does.** Returns the title-case base-lithology label ("Sand" / "Zand") in the active language, or the raw code when it is not one of the five base soils.

**Why it is here.** The docstring records that it is for dropdown and option rows that want just the bare soil name in sentence case rather than the capitalised band form, and that choosing the source-token table is the whole translation.

.. CG-EXPLANATION-END id=function:lithoBaseLabel

