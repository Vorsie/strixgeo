# DOV e2e fixtures (cassettes)

Extracted from CLAUDE.md 2026-07-12 — the fixture-refresh procedure for the
offline DOV e2e specs.  (Cesium visual goldens: see the last section.)

**DOV cassettes — the `flow_dov_bbox_*` specs never touch the network.** The
runner sets ``STRIXGEO_DOV_FIXTURE_MODE=1``, which makes ``make_dov_async_client``
(``dov_http.py``) back the client with an ``httpx.MockTransport``
(``dov_fixture_transport.py``) that serves every DOV call — WFS count/features
+ per-permkey CPT/borehole/interpretation/observation XML + the Virtuele Boring
lagenmodel catalogue — from on-disk fixture files under
``desktop/tests/e2e/fixtures/dov/``. The full URL→file route table is the module
docstring of ``dov_fixture_transport.py``.

The Virtuele Boring model-picker catalogue lives on a **different DOV host**
(``services.dov.vlaanderen.be/virtueleboringserver/base/lagenmodel``) than the
WFS / xdov routes and maps to ``virtuele_boring/lagenmodel.json`` (a small
2-entry list). Without it the offline harness 502s on the unreachable live
catalogue (walker findings 1-9, 2026-09-06).

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

## Scenario pass (walker)

`desktop/tests/e2e/walker/` is a novice-user fuzz pass, run BEFORE every
installer build so the owner has less to dogfeed (owner ruling 2026-09-06).
It restores the bundled worked example (`desktop/resources/sample/worked-example.strix`)
through the app's own open-from-recents path (the main process decodes the
binary `.strix` and, finding no such project in the DB, POSTs `/restore`), then
walks the spine Data to Export as a NOVICE: it discovers every interactive
element on screen each step (buttons, inputs, menu items, tabs, checkboxes,
canvases, links, anything with a role or a testid, INCLUDING elements with no
testid) and a seeded policy picks the next action with real weight plus a large
slice of deliberate chaos (right-click anything, drag between unrelated
elements, wheel with modifiers, junk into inputs, double / triple / hammer
clicks, F1-cheatsheet shortcuts in the wrong stage, resize, Enter / Escape at
random, close and reopen). The tutorial catalogue is only a weighting prior.

It also does what an engineer does BETWEEN the stage work (owner 2026-10-13:
"I test it once and find a bug, walker is thus not doing its job" -- opening a
second project left the first one's models active, and the walker had never
opened a second project). About 10 % of steps take a project-level verb,
weighted switchProject 3 / undoRedoBurst 4 / saveProject 3 / openSettings 2 /
openImportDialog 3:

- `switchProject` -- File > Close Project (the menu IPC a Ctrl+W sends),
  answer an unsaved-changes prompt with Discard or Save (and the force-revert
  prompt if a discard is refused), then open the OTHER project from the welcome
  screen's recent list, all in ONE renderer session (a page reload would throw
  away the very state that leaks). The second project is the seeded synthetic
  fixture (`E2E_FIXTURE_PROJECT_ID`, written as a `.strix` from its bundle and
  registered as a recent entry beside the worked example); the bundled sample
  card is not used because it goes through an OS save dialog the harness
  cancels. At most 4 switches per walk, at least 120 steps apart, so the walk
  goes there and comes back. Disabled when the runner seeded no fixture.
- `undoRedoBurst` -- Ctrl+Z x n then Ctrl+Y x n (n 1..5) on the current stage.
- `saveProject` -- File > Save (Ctrl+S), so later closes are sometimes clean,
  sometimes dirty.
- `openSettings` -- open Settings, pick a section, flip one switch twice, leave
  with Save or Escape.
- `openImportDialog` -- each Import menu route of the Data toolbar once per walk
  (CPT .gef / DOV / pdf, borehole XML / DOV / pdf, lab), then Escape. The native
  file dialog answers "cancelled" under the harness (see below); a route the
  build does not show is skipped.

Save and Settings go through the menu IPC, not a pressed key: Playwright's
keyboard never reaches a native menu accelerator.

After every action it checks the invariants and records a FINDING per violation
(the walk never aborts): no renderer error toast / console error, no refused
request the UI offered (a 409 answered by a dialog is fine), no phantom row (on
screen but not on the server), no empty view over live data, the app stays
responsive (5 s heartbeat), no `cross-project-request` (a request under one
project's path naming a model id first seen under the other project, or a
request for the previous project while the other one is open; judged against
the project open when the request was SENT, from the click on its recent entry
on), and after the final close no lingering Electron or `groundmodel` process.

Run it (it is opt-in, so the deterministic suite is unaffected):

```
.\scripts\run-e2e.ps1 walker
```

The runner sets `WALKER=1` whenever `walker` is in its arguments; without it the
spec skips. Env knobs:

- `WALKER_SEED` -- the printed integer seed; set it to replay a finding exactly.
- `WALKER_STEPS` -- action budget per walk (default 900).
- `WALKER_TIME_BUDGET_S` -- wall-clock budget per walk in seconds (default 1500).
  The Playwright timeout follows it: budget + 300 s for the launch, the restore
  and the close.
- `WALKER_RUNS` -- independent walks in one invocation (default 1), each its own
  launch, close and results directory, with seeds seed, seed+1, ... (the base
  seed and every run's count live in `_results/walker/batch-<runner pid>.json`,
  so they survive the worker restart that follows a crashed run).
- `WALKER_TRACE=1` -- the step line also on the console. Every step is ALWAYS
  appended to the run's `trail.log` BEFORE its action runs (the reporters hide
  the test's console), so a run that hangs ends its file on the step it hung on.

`run-e2e.ps1 walker` passes every knob through unchanged.

**Native OS dialogs never open under the harness.** `STRIX_E2E` (unpackaged
only) makes the main process answer `dialog.showSaveDialog` / `showOpenDialog`
as cancelled and message boxes with their cancel (else default) button
(`desktop/src/main/e2eDialogs.ts`), logging `[e2e] native ... suppressed`.
Playwright cannot dismiss an OS dialog: before this, a walker click on Export
Plaxis or Save project blocked the run until the test timeout, or
landed a Save window on the owner's screen when he was at the machine
(2026-09-10). External links get the same treatment: `shell.openExternal` logs
the URL and opens nothing, so a walker click on the map's attribution links
(Leaflet, OpenStreetMap, Digitaal Vlaanderen) no longer opens Chrome windows.

Findings land in `desktop/tests/e2e/_results/walker/<timestamp>-seed<seed>/findings.md`,
one section per finding (step number, the last steps as the reproduction, the
invariant, the request / console line, and a screenshot). The file's first line
is the grep-stable summary `WALKER: <n> findings`; next to it is `trail.log`.
After the last run the console prints `[walker] WALKER: <total> findings over
<k> of <N> runs`; the gate is 0 findings over all runs. The exit code is 0
unless the app actually crashed, because findings are data, not failures.

The pure logic (policy, budget, invariants, cross-project ledger, trail, batch,
report, process tree) lives in
`walker*.ts` beside the spec and is unit tested under Vitest
(`walker*.test.ts`); Playwright runs only the `.spec.ts`.

**Rule: run the walker before every installer build**, review `findings.md`,
and fix or file what it surfaced before the build ships.
