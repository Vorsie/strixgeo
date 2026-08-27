# DOV e2e fixtures (cassettes)

Extracted from CLAUDE.md 2026-07-12 — the fixture-refresh procedure for the
offline DOV e2e specs.  (Cesium visual goldens: see the last section.)

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

## Cesium visual goldens (screenshot tests)

Two specs pin PIXELS, not just testids — the only automated eyes on the
WebGL surfaces (jsdom has no WebGL, so Vitest never renders them):

* ``flow_unit_statistics.spec.ts`` — the Parameters fence cutout
  (``unit-fence-cutout.png``).
* ``flow_litho_3d_golden.spec.ts`` — the Litho 3-D stage after a real
  in-app voxel build (``litho-3d-solid.png``).

Goldens live where Playwright puts them:
``desktop/tests/e2e/<spec>.spec.ts-snapshots/<name>-win32.png`` — committed,
platform-suffixed (a golden blessed on Windows only gates Windows runs).
Both specs re-seed the fixture (``helpers/visual_golden.reseedFixture``) and
block external network (the basemap lid's Geopunt WMS fetch) so the scene is
deterministic in any run order and any connectivity.  The pixel tolerance is
``WEBGL_MAX_DIFF_PIXEL_RATIO`` in ``helpers/visual_golden.ts`` — rationale at
the constant.

**When a golden fails**, Playwright writes three images under
``desktop/tests/e2e/_results/…``: ``*-expected.png`` (the stored golden),
``*-actual.png`` (what rendered), and ``*-diff.png`` (changed pixels
highlighted).  The HTML report (``npx playwright show-report``) shows them
side by side.

**Re-blessing** — only after LOOKING at the diff, never to silence a red:

1. Open the diff image and decide whether the change is an intended visual
   change (a ruling landed, a colour map changed, the fixture grew) or a
   regression.  This is the owner's judgement call — a golden exists to force
   exactly this look.
2. Regression → fix the code; the golden stays.
3. Intended → re-bless:

   ```
   .\scripts\run-e2e.ps1 flow_unit_statistics --update-snapshots
   .\scripts\run-e2e.ps1 flow_litho_3d_golden --update-snapshots
   ```

   then eyeball the NEW golden once more and commit it in the same commit as
   the change that moved the pixels, so history explains why the image moved.

**First run on a fresh clone / new machine:** a missing golden fails the
test and writes the image — that failure is the red run.  Inspect the
written image, re-run green, commit it.
