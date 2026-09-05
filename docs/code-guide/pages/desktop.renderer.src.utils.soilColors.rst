desktop.renderer.src.utils.soilColors
=====================================

.. CG-PAGE source=desktop/src/renderer/src/utils/soilColors.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/soilColors.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-13

.. literalinclude:: ../../../desktop/src/renderer/src/utils/soilColors.ts
   :language: typescript
   :lines: 1-13
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A large lookup table from DOV soil-type codes (the "hoofdnaam", or main soil name) to a fill colour, a concise English legend label and the original Dutch name. The comment names the authoritative source — the Flemish working group's ``codetabel_hoofdnaam.csv`` (2026-05) — and explains that the colours are grouped by DOV classification so that a code the table does not yet style still gets a sensible hue.

**Why it is here.** The comment cites the project rule "never hardcode translations in domain or import code": the translation lives only here, at this presentation boundary, while the domain stores the raw DOV token. This is the translate-at-the-boundary rule, and keeping the Dutch source name beside the English label is the raw-token-verification habit — a domain expert can check that each mapping is right.

.. CG-EXPLANATION-END id=module-header

``interface SoilStyle``
-----------------------

.. CG-BLOCK id=interface:SoilStyle lines=14-22

.. literalinclude:: ../../../desktop/src/renderer/src/utils/soilColors.ts
   :language: typescript
   :lines: 14-22
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SoilStyle

**What this does.** The shape of one styled entry: a CSS fill colour, a concise English label for the borelog legend, and the optional original Dutch source label from DOV's code table.

**Why it is here.** Carrying the Dutch source alongside the English label lets the interface show the raw token (for example as a tooltip) so a domain expert can confirm the translation without leaving the app — the raw-token-verification rule.

.. CG-EXPLANATION-END id=interface:SoilStyle

``const FALLBACK``
------------------

.. CG-BLOCK id=const:FALLBACK lines=23-25

.. literalinclude:: ../../../desktop/src/renderer/src/utils/soilColors.ts
   :language: typescript
   :lines: 23-25
   :lineno-match:

.. CG-EXPLANATION-START id=const:FALLBACK

**What this does.** The fallback style — a neutral grey fill labelled "unknown".

**Why it is here.** So an empty or unrecognised token still renders as something visible in the borelog rather than as a blank gap.

.. CG-EXPLANATION-END id=const:FALLBACK

``const C``
-----------

.. CG-BLOCK id=const:C lines=26-61

.. literalinclude:: ../../../desktop/src/renderer/src/utils/soilColors.ts
   :language: typescript
   :lines: 26-61
   :lineno-match:

.. CG-EXPLANATION-START id=const:C

**What this does.** A small palette of named family colours — sand tan, silt, clay, carbonate, volcanic, metamorphic, organic and so on — that the big table below reuses.

**Why it is here.** The comment records the intent: keep each family's palette narrow so codes within one class look related, and naming a hue once means every code in that family shares exactly the same colour.

.. CG-EXPLANATION-END id=const:C

``const SOIL_COLORS``
---------------------

.. CG-BLOCK id=const:SOIL_COLORS lines=62-232

.. literalinclude:: ../../../desktop/src/renderer/src/utils/soilColors.ts
   :language: typescript
   :lines: 62-232
   :lineno-match:

.. CG-EXPLANATION-START id=const:SOIL_COLORS

**What this does.** The full table: one entry per DOV code, grouped by family (anthropogenic waste, sands, gravels, fine fractions, organic, carbonates, shells and fossils, silica rocks, iron deposits, evaporites, volcanic, intrusive, metamorphic, lithified sediment, weathering products, minerals, and a few distinctive others), each mapping to a fill colour, an English label and the Dutch source name.

**Why it is here.** This is the single source that turns a raw DOV token into a colour and a readable label. A comment on the stones entry records a corrected mapping — the code XZ turned out to mean generic sand, not stones, per the authoritative code table — which is exactly the kind of mistake that keeping the raw source name makes catchable.

.. CG-EXPLANATION-END id=const:SOIL_COLORS

``function soilStyle``
----------------------

.. CG-BLOCK id=function:soilStyle lines=233-236

.. literalinclude:: ../../../desktop/src/renderer/src/utils/soilColors.ts
   :language: typescript
   :lines: 233-236
   :lineno-match:

.. CG-EXPLANATION-START id=function:soilStyle

**What this does.** Resolves a DOV token to its style: the fallback for an empty or unknown token, otherwise the table entry for that code. This is a *colour lookup* — mapping a text token to a fixed colour from a curated table.

**Why it is here.** The docstring records the guarantee: the borelog always renders something visible regardless of how complete the dictionary is, because an unrecognised token still gets the neutral fallback.

.. CG-EXPLANATION-END id=function:soilStyle

