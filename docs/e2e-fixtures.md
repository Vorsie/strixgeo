# DOV e2e fixtures (cassettes)

Extracted from CLAUDE.md 2026-07-12 — the fixture-refresh procedure for the
offline DOV e2e specs.

**DOV cassettes — the `flow_dov_bbox_*` specs never touch the network.** The
runner sets ``STRIXGEO_DOV_FIXTURE_MODE=1``, which makes ``make_dov_async_client``
(``dov_http.py``) back the client with an ``httpx.MockTransport``
(``dov_fixture_transport.py``) that serves every DOV call — WFS count/features
+ per-permkey CPT/borehole/interpretation/observation XML — from on-disk
fixture files under ``desktop/tests/e2e/fixtures/dov/``. The full URL→file
route table is the module docstring of ``dov_fixture_transport.py``.

The fixtures are **hand-authored synthetic DOV-format files** (permkeys like
``2024-E2E-001``, not real DOV ids) — a refresh is a pure file edit, no network:

1. **Add or change a record** — drop the per-permkey XML under the matching
   subdir (``cpt/<permkey>``, ``borehole/<permkey>``, …) in DOV's export XML
   shape, and add the permkey to the relevant ``wfs/<layer>_features.json``.
2. **Keep the count file in sync** — the specs assert exact counts
   (``imported=3``), so bump ``wfs/<layer>_count.xml`` to match the feature
   list, and update the spec's expected count.
3. **Stay inside the fixture bbox** — a WFS request whose BBOX doesn't overlap
   ``_FIXTURE_BBOX_L72_*`` in ``dov_fixture_transport.py`` gets the *empty*
   fixture (the imported=0 rejection path). New records must sit inside that
   box, or widen the box + the spec's bbox together.
4. **New endpoint / layer** — add a route branch in the transport's ``handler``
   + a slug mapping, then the fixture file. An unmatched URL returns 404 by
   design (a missing fixture surfaces as a test failure, not a silent skip).
5. Verify with ``.\scripts\run-e2e.ps1 flow_dov_bbox_cpt_import flow_dov_bbox_borehole_import``.
