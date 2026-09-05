desktop.renderer.src.i18n.locales.en.models
===========================================

.. CG-PAGE source=desktop/src/renderer/src/i18n/locales/en/models.ts complete=true

*Source file:* ``desktop/src/renderer/src/i18n/locales/en/models.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-5

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/locales/en/models.ts
   :language: typescript
   :lines: 1-5
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and opens the ``MODELS`` catalogue — the words for the three model-building stages: geological (stratigraphy), lithostratigraphic (litho), and geotechnical (geotech). It is the English side.

**Why it is here.** The interface text lives in per-language catalogues so a component asks for a text by its key and gets the string for the active language. The header points to ``locales/en/index.ts`` for the key-naming rules and the domain-canon carve-out — soil names, lithology labels and NAD packing-class names come from their own Dutch-canonical sources and are never re-translated here, only at the presentation boundary.

.. CG-EXPLANATION-END id=module-header

``const MODELS``
----------------

.. CG-BLOCK id=const:MODELS lines=6-618

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/locales/en/models.ts
   :language: typescript
   :lines: 6-618
   :lineno-match:

.. CG-EXPLANATION-START id=const:MODELS

**What this does.** The key-to-text pairs for the three model stages, in three big blocks. The geology block (``geology.*``) covers formations and their ordering, Fill-from-boreholes, Build-3D, the surface-crossing validator, the 3-D layers legend, the lumping/formation-selection dialog and the hook toasts. The lithology block (``litho.*``) covers creating and clearing a litho model, the excluded-boreholes list, Build-model with its progress phases, the bodies/solids legend, auto-correlate, the parent-formation and snap dialogs. The geotech block (``geotech.*``) covers Subdivide-all-bodies, the NAD packing classes and their confidence/no-CPT badges, the re-subdivide warning, the soil-body-packing roster, the model-check report and the admixture-choice prompt. Values with ``{n}``, ``{name}`` or ``{label}`` slots are filled in at display time.

**Why it is here.** Words are split into their own keys wherever a sentence must reorder or pluralise per language — for example ``geotech.reSubdivideModelPre/Mid/Post`` split a warning around its bold and emphasised fragments so each keeps its emphasis. The comments record several owner rulings behind the wording: cone-derived packing is the norm and carries no badge, so only the exceptions (``badgeNoCpt``, ``badgeCptEstPartial``) have keys (owner 2026-08-27); the geotech roster is soil then litho-body then packing-body (owner 2026-08-31); and the admixture prompt names the specific admixture found and asks only the clay/silt-or-sand fork (owner 2026-09-04/05).

.. CG-EXPLANATION-END id=const:MODELS

