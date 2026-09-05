desktop.renderer.src.shell.stages.geotechnical.geotechBadges
============================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/geotechnical/geotechBadges.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/geotechnical/geotechBadges.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-20

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/geotechBadges.tsx
   :language: tsx
   :lines: 1-20
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the file for the two badges the geotech roster puts on a packing-body row: where the packing class came from (its provenance) and how much the model trusts it (its confidence). It pulls in the confidence type, the translation helper, the message-key type, and the provenance type from the tree builder.

**Why it is here.** The badges live in their own file because the tree builder computes the per-body provenance and confidence and the row renderer draws them — keeping the badge vocabulary in one place so the value the builder computes and the label the row shows can never drift apart.

.. CG-EXPLANATION-END id=module-header

``const CONFIDENCE_BADGE_CLASS``
--------------------------------

.. CG-BLOCK id=const:CONFIDENCE_BADGE_CLASS lines=21-27

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/geotechBadges.tsx
   :language: tsx
   :lines: 21-27
   :lineno-match:

.. CG-EXPLANATION-START id=const:CONFIDENCE_BADGE_CLASS

**What this does.** A lookup giving each confidence tier its colours: green for high, neutral slate for medium, orange for low, in both light and dark themes.

**Why it is here.** Amber is reserved for unsaved-state markers and red for errors (a project colour convention), so medium and low use neutral slate and orange instead — drawing attention without falsely signalling an error or unsaved work.

.. CG-EXPLANATION-END id=const:CONFIDENCE_BADGE_CLASS

``const CONFIDENCE_LABEL_KEYS``
-------------------------------

.. CG-BLOCK id=const:CONFIDENCE_LABEL_KEYS lines=28-55

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/geotechBadges.tsx
   :language: tsx
   :lines: 28-55
   :lineno-match:

.. CG-EXPLANATION-START id=const:CONFIDENCE_LABEL_KEYS

**What this does.** A lookup mapping each confidence tier to the message-catalogue key for its capitalised label.

**Why it is here.** The label text is translated, so the badge holds a key into the message catalogue rather than a hard-coded word, letting it read in the active interface language.

.. CG-EXPLANATION-END id=const:CONFIDENCE_LABEL_KEYS

``const PROVENANCE_BADGES``
---------------------------

.. CG-BLOCK id=const:PROVENANCE_BADGES lines=56-96

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/geotechBadges.tsx
   :language: tsx
   :lines: 56-96
   :lineno-match:

.. CG-EXPLANATION-START id=const:PROVENANCE_BADGES

**What this does.** A lookup giving each provenance value its badge text, tooltip, test-id stem and colour — but the fully cone-derived value maps to NOTHING (no badge), while the mixed "partial" value and the "none" value each get one.

**Why it is here.** The owner ruled on 2026-08-27 that the norm carries no badge, because almost every packing class is derived from cone soundings — so marking the norm would badge nearly every row, and only the EXCEPTIONS should stand out. But a non-null NAD class does not by itself mean a cone touched the soil: the borehole fill can emit the weakest class seen elsewhere in the body ("body minimum") or a lithology floor ("absolute minimum"), both stored as low confidence, and presenting one of those unmarked would show an invented value as a measured one (Data Integrity rules 1 and 2). A body with many cone bands and one fill band keeps its own "partial" badge rather than being rounded to either end, because calling it "No CPT" would be untrue. Neither tooltip says "fallback" — the owner disliked the word, since it just means the model is not ready. NAD classes are from NBN EN 1997-1 ANB Tabel 2.1, the Belgian national annex to Eurocode 7.

.. CG-EXPLANATION-END id=const:PROVENANCE_BADGES

``function ProvenanceBadge``
----------------------------

.. CG-BLOCK id=function:ProvenanceBadge lines=97-135

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/geotechBadges.tsx
   :language: tsx
   :lines: 97-135
   :lineno-match:

.. CG-EXPLANATION-START id=function:ProvenanceBadge

**What this does.** A tiny component that draws the provenance badge for a row — or nothing. It draws nothing when the row has no packing class, and nothing for a fully cone-derived row; otherwise it draws the small labelled badge with its tooltip.

**Why it is here.** It is suppressed for an unclassified row because there is no classification whose provenance to state, and the row's own label already says as much; and suppressed for the norm because — per the owner's 2026-08-27 ruling — only the exceptions badge. It takes an id key as the test-id suffix so a single-unit row and a class row can each carry a distinct, findable badge.

.. CG-EXPLANATION-END id=function:ProvenanceBadge

``function ConfidenceBadge``
----------------------------

.. CG-BLOCK id=function:ConfidenceBadge lines=136-154

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/geotechBadges.tsx
   :language: tsx
   :lines: 136-154
   :lineno-match:

.. CG-EXPLANATION-START id=function:ConfidenceBadge

**What this does.** A tiny component that draws the confidence badge — high, medium or low — for a row, or nothing when no confidence is supplied.

**Why it is here.** A row with no backing layer has no confidence to state, so it draws nothing rather than an empty or misleading badge; the id key gives each badge a distinct test-id, the same convention as the provenance badge.

.. CG-EXPLANATION-END id=function:ConfidenceBadge

