groundmodel.application.import_borehole_dov
===========================================

.. CG-PAGE source=src/groundmodel/application/import_borehole_dov.py complete=true

*Source file:* ``src/groundmodel/application/import_borehole_dov.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-66

.. literalinclude:: ../../../src/groundmodel/application/import_borehole_dov.py
   :language: python
   :lines: 1-66
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the DOV borehole-import file. It pulls in the shared WFS-fetch wrapper, the two child orchestrators it drives (interpretations and samples), the borehole domain object and its database rows, the borehole repository, the DOV boring parser and client, and the caches — and its docstring lists the import's growing scope (headers and drill segments in phase C1, all eight interpretation streams in C2, lab samples and grain-sizes in C3).

**Why it is here.** The docstring records the key contract: all four child collections (drill segments, field log, observations, samples plus grain-sizes) land in one single commit, so a borehole and everything attached to it are saved atomically (docs/parsers-dov.md).

.. CG-EXPLANATION-END id=module-header

Class ``ImportBoreholeDov`` — header
------------------------------------

.. CG-BLOCK id=class:ImportBoreholeDov lines=67-88

.. literalinclude:: ../../../src/groundmodel/application/import_borehole_dov.py
   :language: python
   :lines: 67-88
   :lineno-match:

.. CG-EXPLANATION-START id=class:ImportBoreholeDov

**What this does.** Opens the borehole bulk-import use case. The docstring says it mirrors the CPT importer's five phases and describes the per-resource cache subdirectories.

**Why it is here.** It deliberately mirrors ``ImportCptDov`` — same phase split, same error story — so the two import paths stay consistent. The cache is split into ``boring/``, ``interpretatie/`` and other subdirectories because DOV's permkey (a stable ``YYYY-NNNNNN`` id) is not unique across resource types, so keeping them in separate folders stops one resource's XML overwriting another's.

.. CG-EXPLANATION-END id=class:ImportBoreholeDov

Method ``ImportBoreholeDov``. ``def __init__``
----------------------------------------------

.. CG-BLOCK id=method:ImportBoreholeDov.__init__ lines=89-114

.. literalinclude:: ../../../src/groundmodel/application/import_borehole_dov.py
   :language: python
   :lines: 89-114
   :lineno-match:

.. CG-EXPLANATION-START id=method:ImportBoreholeDov.__init__

**What this does.** Stores the session and repository and builds the four per-resource XML caches (boring, interpretation, sample, observation).

**Why it is here.** Same permkey-collision reason as the class docstring: each DOV resource type gets its own cache folder.

.. CG-EXPLANATION-END id=method:ImportBoreholeDov.__init__

Method ``ImportBoreholeDov``. ``async def execute``
---------------------------------------------------

.. CG-BLOCK id=method:ImportBoreholeDov.execute lines=115-369

.. literalinclude:: ../../../src/groundmodel/application/import_borehole_dov.py
   :language: python
   :lines: 115-369
   :lineno-match:

.. CG-EXPLANATION-START id=method:ImportBoreholeDov.execute

**What this does.** Runs the full borehole import over one bbox using a single shared HTTP client. It fetches and parses the boreholes, reports any lost to download or parse, runs one batch duplicate query, then saves new boreholes while building two id maps (by test id and by permkey). Phase 4b attaches interpretations and phase 4c attaches samples and lab tests to every in-scope borehole. Phase 5 commits the whole tree once, and it returns a rich summary of every child count.

**Why it is here.** One HTTP client is reused across all phases so the connection pool stays warm and later phases skip the connect handshake, and one rate-limit state is shared so a single rate-limit response slows every remaining phase. Existing boreholes are put into the same id maps as new ones so the child phases run for them too: this is refresh-on-duplicate — a parser fix reaches an existing project by re-import, and per-row dedup inside the child phases stops re-adding children already present, with no wipe needed (docs/parsers-dov.md; CLAUDE.md idempotency-on-ingest). The commit runs even when zero boreholes were newly imported, because the child phases may have added rows to existing ones.

.. CG-EXPLANATION-END id=method:ImportBoreholeDov.execute

Method ``ImportBoreholeDov``. ``async def _fetch_boreholes``
------------------------------------------------------------

.. CG-BLOCK id=method:ImportBoreholeDov._fetch_boreholes lines=370-417

.. literalinclude:: ../../../src/groundmodel/application/import_borehole_dov.py
   :language: python
   :lines: 370-417
   :lineno-match:

.. CG-EXPLANATION-START id=method:ImportBoreholeDov._fetch_boreholes

**What this does.** Runs the discovery and download-parse phases for boreholes and returns the raw discovered count alongside the successfully parsed pairs.

**Why it is here.** Splitting this out keeps ``execute`` readable; the gap between the discovered count and the parsed count is exactly the number lost to failures, which the caller reports.

.. CG-EXPLANATION-END id=method:ImportBoreholeDov._fetch_boreholes

Method ``ImportBoreholeDov``. ``async def _fetch_and_attach_interpretations``
-----------------------------------------------------------------------------

.. CG-BLOCK id=method:ImportBoreholeDov._fetch_and_attach_interpretations lines=418-476

.. literalinclude:: ../../../src/groundmodel/application/import_borehole_dov.py
   :language: python
   :lines: 418-476
   :lineno-match:

.. CG-EXPLANATION-START id=method:ImportBoreholeDov._fetch_and_attach_interpretations

**What this does.** Runs the interpretation orchestrator over the same bbox for every in-scope borehole, passing the id map and the per-borehole availability flags; on a network error it logs and returns a failed-count result instead of raising.

**Why it is here.** The id map covers new and existing boreholes so refresh-on-duplicate applies, and the availability flags let the child detect a WFS gap (DOV says a borehole has a stratigraphy but the stream returns nothing). Network errors are swallowed so a transient interpretation outage still leaves the engineer with the boreholes they imported — graceful degradation, not a rolled-back import.

.. CG-EXPLANATION-END id=method:ImportBoreholeDov._fetch_and_attach_interpretations

Method ``ImportBoreholeDov``. ``async def _fetch_and_attach_samples``
---------------------------------------------------------------------

.. CG-BLOCK id=method:ImportBoreholeDov._fetch_and_attach_samples lines=477-533

.. literalinclude:: ../../../src/groundmodel/application/import_borehole_dov.py
   :language: python
   :lines: 477-533
   :lineno-match:

.. CG-EXPLANATION-START id=method:ImportBoreholeDov._fetch_and_attach_samples

**What this does.** Runs the sample-and-lab-test orchestrator over the same bbox for every in-scope borehole (keyed by permkey), degrading gracefully on a network error.

**Why it is here.** Same contract as the interpretation phase: refresh-on-duplicate through the shared map, and a transient lab-side outage must not abort the parent borehole commit.

.. CG-EXPLANATION-END id=method:ImportBoreholeDov._fetch_and_attach_samples

Method ``ImportBoreholeDov``. ``def _build_orm``
------------------------------------------------

.. CG-BLOCK id=method:ImportBoreholeDov._build_orm lines=534-599

.. literalinclude:: ../../../src/groundmodel/application/import_borehole_dov.py
   :language: python
   :lines: 534-599
   :lineno-match:

.. CG-EXPLANATION-START id=method:ImportBoreholeDov._build_orm

**What this does.** Merges the WFS row's metadata into the parsed borehole, then builds the ``BoreholeOrm`` row with its drill segments and field-log intervals as children.

**Why it is here.** The boring XML omits a few fields that live on the WFS row, so this is the merge point; it stamps the DOV elevation source when a surface level was present and NONE otherwise, so a later refresh can overwrite a file elevation without clobbering a manual one (debt #8).

.. CG-EXPLANATION-END id=method:ImportBoreholeDov._build_orm

Method ``ImportBoreholeDov``. ``def _merge_wfs``
------------------------------------------------

.. CG-BLOCK id=method:ImportBoreholeDov._merge_wfs lines=600-650

.. literalinclude:: ../../../src/groundmodel/application/import_borehole_dov.py
   :language: python
   :lines: 600-650
   :lineno-match:

.. CG-EXPLANATION-START id=method:ImportBoreholeDov._merge_wfs

**What this does.** Fills any field the XML left empty from the WFS row — drill method, municipality, executor, purpose, total depth, and, as a last resort, coordinates and surface level — never overwriting a value the XML did supply; it raises when neither source has usable coordinates.

**Why it is here.** The XML is the more detailed source so it wins when both have a value; the WFS row is the canonical fallback. A borehole with no coordinates from either source is unmappable and unsafe to store, so raising here routes it into the per-row failed counter and the rest of the batch still imports.

.. CG-EXPLANATION-END id=method:ImportBoreholeDov._merge_wfs

