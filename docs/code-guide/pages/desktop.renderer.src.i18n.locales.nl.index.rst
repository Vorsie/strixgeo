desktop.renderer.src.i18n.locales.nl.index
==========================================

.. CG-PAGE source=desktop/src/renderer/src/i18n/locales/nl/index.ts complete=true

*Source file:* ``desktop/src/renderer/src/i18n/locales/nl/index.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-38

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/locales/nl/index.ts
   :language: typescript
   :lines: 1-38
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A comment and the imports. It introduces the Dutch (Belgium) catalogue — the Dutch mirror of the English one — built exactly the same way, one module per area merged together, but typed as a PARTIAL catalogue rather than a complete one. It imports each of the Dutch per-area modules.

**Why it is here.** The comment gives the reasons for typing it as partial: a key that exists in English but not here falls back to the English string, so a half-translated app is still usable rather than crashing; and a key that does NOT exist in English is a build error, so a rename on the English side cannot leave an orphaned Dutch string behind. It also records the terminology rules — Belgian Flemish register wins over Netherlands-Dutch (it names "kleefweerstand" over "plaatselijke wrijvingsweerstand" and "grondwatertafel" over "grondwaterstand"), because the buyers are BE/NL consultancies; domain tokens are never translated here because their sources are already Dutch; and any term that is a judgement call carries a ``// FLAG alt:`` comment that the review-table script reads directly, so the review table cannot drift from the source files.

.. CG-EXPLANATION-END id=module-header

``const NL``
------------

.. CG-BLOCK id=const:NL lines=39-53

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/locales/nl/index.ts
   :language: typescript
   :lines: 39-53
   :lineno-match:

.. CG-EXPLANATION-START id=const:NL

**What this does.** The finished Dutch catalogue — the per-area Dutch modules merged into one lookup. The comment block below leads into the addressable module list.

**Why it is here.** It mirrors the English composition exactly — the same areas in the same order — so the two catalogues line up key for key, and (by the ``Partial`` rule stated above) anything it does not carry falls back to the English string at run time.

.. CG-EXPLANATION-END id=const:NL

``const NL_MODULES``
--------------------

.. CG-BLOCK id=const:NL_MODULES lines=54-65

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/locales/nl/index.ts
   :language: typescript
   :lines: 54-65
   :lineno-match:

.. CG-EXPLANATION-START id=const:NL_MODULES

**What this does.** The same Dutch modules kept separately addressable by name.

**Why it is here.** The docstring says this lets the parity test report which area a missing or duplicated key belongs to, rather than just that one exists somewhere.

.. CG-EXPLANATION-END id=const:NL_MODULES

