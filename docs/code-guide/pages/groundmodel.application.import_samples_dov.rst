groundmodel.application.import_samples_dov
==========================================

.. CG-PAGE source=src/groundmodel/application/import_samples_dov.py complete=true

*Source file:* ``src/groundmodel/application/import_samples_dov.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-101

.. literalinclude:: ../../../src/groundmodel/application/import_samples_dov.py
   :language: python
   :lines: 1-101
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the sample-and-lab-test import file. It gathers the WFS-fetch wrapper, the six lab-test database rows (sample, grain-size, Atterberg, CaCO3, organic content, water content, and the catch-all scalar test), the dedup helpers, the sample and grain-size and scalar clients, and the DOV parameter constants. The long docstring lays out the pipeline and two design points.

**Why it is here.** This is the phase-C3/C4 companion to the borehole importer, running against the same bbox and the same session so everything commits together. The docstring records why samples and lab tests share one orchestrator (they share the parent-permkey-map flow, and a second class would thread the map out and back for no benefit) and explains DOV's two-row Atterberg shape (liquid limit and plastic limit arrive as separate rows and are collapsed into one).

.. CG-EXPLANATION-END id=module-header

Class ``ImportSamplesDov`` — header
-----------------------------------

.. CG-BLOCK id=class:ImportSamplesDov lines=102-111

.. literalinclude:: ../../../src/groundmodel/application/import_samples_dov.py
   :language: python
   :lines: 102-111
   :lineno-match:

.. CG-EXPLANATION-START id=class:ImportSamplesDov

**What this does.** Opens the sample-import use case, which adds rows to the parent's session without committing.

**Why it is here.** Same sharing contract as the interpretation importer: the parent commits once at the end.

.. CG-EXPLANATION-END id=class:ImportSamplesDov

Method ``ImportSamplesDov``. ``def __init__``
---------------------------------------------

.. CG-BLOCK id=method:ImportSamplesDov.__init__ lines=112-116

.. literalinclude:: ../../../src/groundmodel/application/import_samples_dov.py
   :language: python
   :lines: 112-116
   :lineno-match:

.. CG-EXPLANATION-START id=method:ImportSamplesDov.__init__

**What this does.** Stores the shared session.

**Why it is here.** The session belongs to the parent; writes here join the parent's transaction.

.. CG-EXPLANATION-END id=method:ImportSamplesDov.__init__

Method ``ImportSamplesDov``. ``async def execute``
--------------------------------------------------

.. CG-BLOCK id=method:ImportSamplesDov.execute lines=117-392

.. literalinclude:: ../../../src/groundmodel/application/import_samples_dov.py
   :language: python
   :lines: 117-392
   :lineno-match:

.. CG-EXPLANATION-START id=method:ImportSamplesDov.execute

**What this does.** Runs the sample pipeline: query samples in the bbox filtered to known boreholes, pre-load already-stored samples for refresh-on-duplicate, persist the new ones while building a permkey-to-sample map, then fetch-download-parse-persist grain sizes, and finally run the four scalar lab-test phases; it returns a full count summary.

**Why it is here.** Existing samples are loaded before the empty-rows early exit because new lab tests can still arrive for already-stored samples (docs/parsers-dov.md refresh-on-duplicate). Grain-size rows with empty curves are counted as failed rather than stored, because the parser already flagged them and an empty array would mislead the consumer. Everything is staged without committing so the parent lands it atomically.

.. CG-EXPLANATION-END id=method:ImportSamplesDov.execute

Method ``ImportSamplesDov``. ``async def _fetch_and_attach_scalar_lab_tests``
-----------------------------------------------------------------------------

.. CG-BLOCK id=method:ImportSamplesDov._fetch_and_attach_scalar_lab_tests lines=393-533

.. literalinclude:: ../../../src/groundmodel/application/import_samples_dov.py
   :language: python
   :lines: 393-533
   :lineno-match:

.. CG-EXPLANATION-START id=method:ImportSamplesDov._fetch_and_attach_scalar_lab_tests

**What this does.** Runs the four typed scalar phases (Atterberg, CaCO3, organic carbon, water content) plus the catch-all, fetching all five WFS queries in parallel, then persisting each family through its own helper. A network error marks every stream failed and returns without touching the already-staged rows.

**Why it is here.** The five queries are fetched together because they are independent, but the follow-up dedup queries run one after another, not in parallel, because a single session can only run one operation at a time (concurrent queries on it raise an error). A lab-side WFS failure is isolated so the boreholes, samples and grain-sizes already staged still commit.

.. CG-EXPLANATION-END id=method:ImportSamplesDov._fetch_and_attach_scalar_lab_tests

Method ``ImportSamplesDov``. ``def _persist_atterberg``
-------------------------------------------------------

.. CG-BLOCK id=method:ImportSamplesDov._persist_atterberg lines=534-610

.. literalinclude:: ../../../src/groundmodel/application/import_samples_dov.py
   :language: python
   :lines: 534-610
   :lineno-match:

.. CG-EXPLANATION-START id=method:ImportSamplesDov._persist_atterberg

**What this does.** Buckets the liquid-limit and plastic-limit rows by parent sample, then collapses each bucket into one Atterberg row, skipping any already stored and isolating per-row failures.

**Why it is here.** DOV ships one row per parameter, so a sample with both limits has two rows that must be merged into one record; a sample with only one limit is still stored with the other column empty, because a partial measurement is real. A plastic-limit row flagged not-measurable maps to the non-plastic flag, DOV's convention for a soil that cannot be rolled into a 3 mm thread.

.. CG-EXPLANATION-END id=method:ImportSamplesDov._persist_atterberg

Method ``ImportSamplesDov``. ``def _persist_caco3``
---------------------------------------------------

.. CG-BLOCK id=method:ImportSamplesDov._persist_caco3 lines=611-634

.. literalinclude:: ../../../src/groundmodel/application/import_samples_dov.py
   :language: python
   :lines: 611-634
   :lineno-match:

.. CG-EXPLANATION-START id=method:ImportSamplesDov._persist_caco3

**What this does.** Persists one carbonate-content row per WFS row through the shared single-value helper.

**Why it is here.** Carbonate content, organic carbon and water content share the same per-row shape, so they route through one helper that names the right counter and builder — extracting the common flow rather than repeating it.

.. CG-EXPLANATION-END id=method:ImportSamplesDov._persist_caco3

Method ``ImportSamplesDov``. ``def _persist_organic``
-----------------------------------------------------

.. CG-BLOCK id=method:ImportSamplesDov._persist_organic lines=635-658

.. literalinclude:: ../../../src/groundmodel/application/import_samples_dov.py
   :language: python
   :lines: 635-658
   :lineno-match:

.. CG-EXPLANATION-START id=method:ImportSamplesDov._persist_organic

**What this does.** Persists one organic-content row per WFS row through the same shared single-value helper.

**Why it is here.** Same reuse as carbonate content, with the organic-carbon builder.

.. CG-EXPLANATION-END id=method:ImportSamplesDov._persist_organic

Method ``ImportSamplesDov``. ``def _persist_water_content``
-----------------------------------------------------------

.. CG-BLOCK id=method:ImportSamplesDov._persist_water_content lines=659-682

.. literalinclude:: ../../../src/groundmodel/application/import_samples_dov.py
   :language: python
   :lines: 659-682
   :lineno-match:

.. CG-EXPLANATION-START id=method:ImportSamplesDov._persist_water_content

**What this does.** Persists one water-content row per WFS row through the same shared single-value helper.

**Why it is here.** Same reuse, with the water-content builder and its wider valid range.

.. CG-EXPLANATION-END id=method:ImportSamplesDov._persist_water_content

Method ``ImportSamplesDov``. ``def _persist_scalar_lab_tests``
--------------------------------------------------------------

.. CG-BLOCK id=method:ImportSamplesDov._persist_scalar_lab_tests lines=683-749

.. literalinclude:: ../../../src/groundmodel/application/import_samples_dov.py
   :language: python
   :lines: 683-749
   :lineno-match:

.. CG-EXPLANATION-START id=method:ImportSamplesDov._persist_scalar_lab_tests

**What this does.** Persists each catch-all scalar observation into the generic lab-test table, skipping already-stored rows and those whose parent sample is not in this import, then logs a phase summary when anything happened.

**Why it is here.** Unlike the typed families the catch-all runs no value-range check, because it is meant to store anything DOV sends (numeric, text, or null-with-condition). The ``[i/total]`` per-row prefix and the INFO phase summary are the bulk-loop logging rules from the Definition of Done, and the summary is suppressed when nothing happened so an empty bbox adds no noise.

.. CG-EXPLANATION-END id=method:ImportSamplesDov._persist_scalar_lab_tests

Method ``ImportSamplesDov``. ``def _persist_single_value``
----------------------------------------------------------

.. CG-BLOCK id=method:ImportSamplesDov._persist_single_value lines=750-818

.. literalinclude:: ../../../src/groundmodel/application/import_samples_dov.py
   :language: python
   :lines: 750-818
   :lineno-match:

.. CG-EXPLANATION-START id=method:ImportSamplesDov._persist_single_value

**What this does.** The shared per-row persist used by carbonate, organic and water content: skip if already present, fail if the parent sample is missing, otherwise build the row (recording why when the builder returns nothing) and stage it, isolating errors.

**Why it is here.** The three single-parameter families differ only by their builder and counter names, so parameterising one helper removes three near-identical copies. It logs the raw value and detection condition when a value is dropped, so a low attached count is explainable from the log without re-running (a Definition-of-Done logging rule).

.. CG-EXPLANATION-END id=method:ImportSamplesDov._persist_single_value

Function ``def _sample_to_orm``
-------------------------------

.. CG-BLOCK id=function:_sample_to_orm lines=819-845

.. literalinclude:: ../../../src/groundmodel/application/import_samples_dov.py
   :language: python
   :lines: 819-845
   :lineno-match:

.. CG-EXPLANATION-START id=function:_sample_to_orm

**What this does.** Maps a sample WFS row plus its borehole id into a sample database row, defaulting a missing depth to zero.

**Why it is here.** The depth columns cannot be empty and the domain allows a top equal to a base for a spot sample, so a missing depth is treated as a surface spot sample; the docstring notes this is a rare DOV state.

.. CG-EXPLANATION-END id=function:_sample_to_orm

Function ``def _grain_size_to_orm``
-----------------------------------

.. CG-BLOCK id=function:_grain_size_to_orm lines=846-870

.. literalinclude:: ../../../src/groundmodel/application/import_samples_dov.py
   :language: python
   :lines: 846-870
   :lineno-match:

.. CG-EXPLANATION-START id=function:_grain_size_to_orm

**What this does.** Maps a parsed grain-size result plus its sample id into a grain-size database row.

**Why it is here.** A plain mapping helper kept pure (no logging, no database) so it is easy to unit-test.

.. CG-EXPLANATION-END id=function:_grain_size_to_orm

Function ``def _atterberg_kind``
--------------------------------

.. CG-BLOCK id=function:_atterberg_kind lines=871-885

.. literalinclude:: ../../../src/groundmodel/application/import_samples_dov.py
   :language: python
   :lines: 871-885
   :lineno-match:

.. CG-EXPLANATION-START id=function:_atterberg_kind

**What this does.** Returns ``LL`` or ``PL`` for the two Atterberg parameter strings, or nothing for anything else.

**Why it is here.** It buckets the per-parameter rows so a sample's two rows collapse into one record; it compares the full DOV parameter string (verified live) rather than a substring for safety.

.. CG-EXPLANATION-END id=function:_atterberg_kind

Function ``def _atterberg_to_orm``
----------------------------------

.. CG-BLOCK id=function:_atterberg_to_orm lines=886-948

.. literalinclude:: ../../../src/groundmodel/application/import_samples_dov.py
   :language: python
   :lines: 886-948
   :lineno-match:

.. CG-EXPLANATION-START id=function:_atterberg_to_orm

**What this does.** Collapses a sample's liquid-limit and plastic-limit rows into one Atterberg record, applying the range check, the non-plastic mapping, and a method/date fallback, and returning nothing when there is nothing to store.

**Why it is here.** The docstring records each decision: the ranges match the domain entity; a not-measurable plastic limit means non-plastic (DOV's 3 mm-thread convention) while other conditions leave it unclaimed; method and date come from whichever row has them, preferring the liquid-limit row because labs run it first; and the liquid-limit permkey is the canonical identity because both rows collapse into one.

.. CG-EXPLANATION-END id=function:_atterberg_to_orm

Function ``def _caco3_to_orm``
------------------------------

.. CG-BLOCK id=function:_caco3_to_orm lines=949-970

.. literalinclude:: ../../../src/groundmodel/application/import_samples_dov.py
   :language: python
   :lines: 949-970
   :lineno-match:

.. CG-EXPLANATION-START id=function:_caco3_to_orm

**What this does.** Maps a carbonate observation into a carbonate-content row, validating the value into 0 to 100 percent and returning nothing when there is neither a usable value nor any metadata.

**Why it is here.** The range matches the domain entity; a row with no value and no method or date has nothing meaningful to record.

.. CG-EXPLANATION-END id=function:_caco3_to_orm

Function ``def _organic_carbon_to_orm``
---------------------------------------

.. CG-BLOCK id=function:_organic_carbon_to_orm lines=971-996

.. literalinclude:: ../../../src/groundmodel/application/import_samples_dov.py
   :language: python
   :lines: 971-996
   :lineno-match:

.. CG-EXPLANATION-START id=function:_organic_carbon_to_orm

**What this does.** Maps an organic-carbon observation into an organic-content row, filling only the carbon percentage and leaving organic matter empty.

**Why it is here.** DOV ships organic carbon, not organic matter, and the domain rule is to not auto-convert independently-measured quantities — a caller needing organic matter applies the conversion factor at presentation time (Data Integrity Rule 3).

.. CG-EXPLANATION-END id=function:_organic_carbon_to_orm

Function ``def _water_content_to_orm``
--------------------------------------

.. CG-BLOCK id=function:_water_content_to_orm lines=997-1017

.. literalinclude:: ../../../src/groundmodel/application/import_samples_dov.py
   :language: python
   :lines: 997-1017
   :lineno-match:

.. CG-EXPLANATION-START id=function:_water_content_to_orm

**What this does.** Maps a water-content observation into a water-content row, validating the value into 0 to 1000 percent.

**Why it is here.** The range is wide because peats and quick clays exceed 100 percent, so the value is not clamped to 100; only a value outside 0 to 1000 is treated as non-physical.

.. CG-EXPLANATION-END id=function:_water_content_to_orm

Function ``def _scalar_lab_test_to_orm``
----------------------------------------

.. CG-BLOCK id=function:_scalar_lab_test_to_orm lines=1018-1051

.. literalinclude:: ../../../src/groundmodel/application/import_samples_dov.py
   :language: python
   :lines: 1018-1051
   :lineno-match:

.. CG-EXPLANATION-START id=function:_scalar_lab_test_to_orm

**What this does.** Maps a generic scalar observation into a catch-all lab-test row, putting a numeric value in the numeric column and non-numeric text (like an ASTM classification code) in the text column, and always returning a row.

**Why it is here.** Unlike the typed mappers this never drops a row: the catch-all stores whatever arrived from DOV because the metadata (parameter, method, date, detection condition) is itself useful diagnostic information.

.. CG-EXPLANATION-END id=function:_scalar_lab_test_to_orm

Function ``def _apply_grain_size_method_fallback``
--------------------------------------------------

.. CG-BLOCK id=function:_apply_grain_size_method_fallback lines=1052-1072

.. literalinclude:: ../../../src/groundmodel/application/import_samples_dov.py
   :language: python
   :lines: 1052-1072
   :lineno-match:

.. CG-EXPLANATION-START id=function:_apply_grain_size_method_fallback

**What this does.** Fills a parsed grain-size's method from the WFS row when the XML left it empty, then returns the same parse result.

**Why it is here.** DOV's grain-size XML sometimes omits the method element, but the WFS row carries it reliably, so the fallback keeps the chart legend reading ``sieving`` or ``hydrometer`` instead of a placeholder.

.. CG-EXPLANATION-END id=function:_apply_grain_size_method_fallback

Function ``def _optional_pct``
------------------------------

.. CG-BLOCK id=function:_optional_pct lines=1073-1088

.. literalinclude:: ../../../src/groundmodel/application/import_samples_dov.py
   :language: python
   :lines: 1073-1088
   :lineno-match:

.. CG-EXPLANATION-START id=function:_optional_pct

**What this does.** Parses a DOV numeric string into a number, returning nothing for an empty, null or non-numeric string.

**Why it is here.** DOV ships values as strings even when the type is numeric, so a tolerant parse lets the caller decide whether a row carries useful metadata despite a missing value.

.. CG-EXPLANATION-END id=function:_optional_pct

