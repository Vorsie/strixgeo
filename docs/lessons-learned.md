# Engineering Lessons — Strix

Transferable, hard-won lessons. Each is a *rule* + the concrete instance that taught it + how to apply. Add to this when a bug or process gap teaches something a future session (or a future Claude) would otherwise repeat. Keep it to genuinely non-obvious lessons — not things the code or CLAUDE.md already say.

---

## 2026-07-26 — The geotech save/reopen data-loss bug (codex safety audit)

### 15. A new model *kind* that reuses a table with kind-gated triggers can silently lose data on restore — audit the whole round-trip, not the create path.
Geotech subdivision reuses the `litho_layer` table and the "Shape A" idea (layers are truth, contacts are a derived mirror). The create path worked. But **reopening** a saved subdivided project dropped every geotech layer: the bundle serialized geotech's FC-mirror *contacts* (unlike litho, which emits `contacts=[]`), so restore's de-dupe **skipped** the explicit geotech-layer insert and deferred to the FC→LL trigger — which is **gated to `lithostratigraphic` only** (`mirror_litho_contact_to_layer`, migration `p0j1k2l3m4n5:73`). No layer → dangling correlation edges → FK 500 / silent loss. Two asymmetries (serialization + trigger kind-gate) lined up to lose data only on the round-trip. Fix: serialize geotech as Shape-A (`NON_STRATIGRAPHIC_KINDS`) so layers restore explicitly, and the *un-gated* LL→FC trigger rebuilds the mirror; plus reconcile `body_id` for geotech too.
**Apply:** when a new `kind` reuses a table that has kind-gated triggers or kind-branched serialization, write the **save → close → reopen** regression test before calling it shipped. Grep every `IF ... kind` in the triggers and every `if model.kind ==` in the bundle serializer/restorer and confirm the new kind is handled on *both* the write and the read side. Create-path green says nothing about round-trip survival.

### 16. A disproven hypothesis + a symptom that won't quit = keep pulling the thread; the harness "artifact" may be the real bug.
The audit flagged a suspected restore *ordering* P0. It **didn't reproduce** (SQLAlchemy batches inserts — proven with child-before-parent tests). But writing the geotech round-trip test kept hitting obstacles — a `MissingGreenlet`, an HTTP 500, then a DB FK violation — each of which *looked* like a test-harness problem. Chasing "why does the harness fight me" (rather than papering over it with `expunge_all`/session tweaks) led straight to the real, worse defect above. The FK violation **was** the bug, not an artifact.
**Apply:** when a suspected bug is disproven but a related symptom persists, don't close the ticket — the real defect is usually adjacent. And when the test harness repeatedly resists (greenlet errors, 500s, FK violations that survive the obvious session fixes), treat the resistance as a signal about the *system*, not just the test. Verify a reproduction is real vs. artifact by reading the code path the error names, not by assuming.

---

## 2026-06-30 — Geotech body model + the whole-codebase observability/testing audit

### 1. An all-or-nothing match rule almost never matches on real data — match *partially* along the lines you already have.
The geotech auto-correlate connected two columns' packing sub-bands **only when their full NAD-class sequences were identical**. On the real CS1 section the sequences differed on every pair (`S7 [6,6,7,8]` vs `S11 [6,8,5]`), so it emitted **zero** edges and the sands rendered as 13 disconnected bodies — even though the litho unit was one connected sand. The fix: walk the **existing litho correlation edges** and connect each same-class band in the **longest-common-subsequence** of the two stacks (`aligned_same_class_pairs`). Sand edges went 0→8, bodies 13→9 on real data.
**Apply:** when a feature "derives from" an existing connectivity (litho→geotech, geo→litho), *inherit and refine* that connectivity per-element; never gate the whole inheritance on a strict full-shape equality. Strict equality is for fixtures, not field data.

### 2. Never reason about identity from a truncated UUID.
"All the sands share body `019f1922`" was wrong — uuid7 is time-ordered, so 13 *different* bodies created in the same second shared the 8-char prefix. The "one body" conclusion sent the diagnosis in the wrong direction for a step.
**Apply:** in any diagnostic query/log that compares identity, print the **full** uuid. (Encoded in the `debugging-scientist` agent.)

### 3. Integration tests must have an automated trigger, or a RED one will ship.
A stale `BH1-2` integration assertion (expecting `body_id=None` after Task B intentionally changed it to assign one) shipped RED and went unnoticed — because the pre-commit hook runs `tests/unit` + desktop Vitest only, and CI explicitly skips integration. Every watertight invariant, importer round-trip, and bundle-restore guard lives in `tests/integration`, run only by the manual wrapper.
**Apply:** the `.githooks/pre-push` hook now runs the integration suite when `src/groundmodel/**` or `tests/integration/**` change. A path-gated PR-only CI job is the durable upgrade. Don't let a whole correctness layer depend on a human remembering to run a script.

### 4. The real-data gate must assert the invariant the feature protects — not just adjacent ones.
The CS1 gate checked litho≠class / null-class / sample-assignment, but **not connectivity** — the exact property that then broke silently on real data (connected litho → disconnected geotech). Synthetic LCS unit tests passed while the real section was wrong. This is the recurring "synthetic is necessary-not-sufficient" trap (it has now bitten on the strat builder, the deep-substrate fill, and here).
**Apply:** when a change enforces an invariant, add that invariant to the **real-data gate**, and prefer a checked-in frozen real-section fixture over an env-gated dev-DB extract that self-skips on a clean checkout.

### 5. Run the logging + testing reviewer pass *after* implementation — implementers mis-judge observability and tests.
Within one applied batch: the implementer **over-promoted** high-frequency per-drag logs to INFO (hundreds per editing session) and added a `log` call **inside a module declared pure**; and wrote a "regression test" (`PF-2`) whose docstring claimed a partial-survivor scenario but which returned `[]` — a **vacuous duplicate** that left the load-bearing counting path untested. The `logging-reviewer` and `testing-reviewer` agents caught all of it.
**Apply:** the Combined Workflow (implement → logging-review → testing-review → revise) is not ceremony — the reviewers catch the implementer's blind spots every time. Use the dedicated agents, not a general one.

### 6. A regression test is only real if it goes RED on the old code — verify that, don't assume it.
`PF-2` would have passed on the buggy code (it tested the wrong branch). A bug-fix test that was never seen to fail on the pre-fix code is not a regression test; it's decoration that can silently rot (see also the CLAUDE.md "the test WAS the regression" tale).
**Apply:** state how you confirmed the test fails on the old behaviour. If you can't make it fail, the test is testing the wrong thing.

### 7. Load-bearing breadcrumbs at DEBUG are invisible exactly where you dogfeed.
The renderer's `log.ts` suppresses `debug` on packaged builds, and Chrome hides `console.debug` under "Default levels" even in dev. So the drag-commit/branch-decision logs the owner needs during a dogfeed session were silent on the build they actually run.
**Apply:** a breadcrumb that frames a user-reported "it did the wrong thing" (stage/axis, gesture branch, mutation outcome) is **INFO**, not DEBUG. DEBUG is for per-row/per-frame verbosity that would flood INFO.

### 8. A subagent's "done" is a claim, not proof — and a premature/partial return is common.
Two subagents returned mid-work (one left orphaned background `pytest` processes; one returned without a status). One reported "done" while leaving a RED integration test the pre-commit hook couldn't see. The controller verifying the actual git state + running the real gate caught all three. A later instance was worse: a subagent committed 669 lines of regression *tests* for four fixes while applying only ~1 of them — leaving RED tests for missing code, one source file modified-but-uncommitted, and the primary target file entirely untouched. Its final message was truncated and off-topic (a tell). `git log --stat` + `git diff --stat <base> -- <expected-file>` exposed the gap in two commands.
**Apply:** after a subagent reports done, check the git state, run the load-bearing gate yourself, and read the diff — especially for premature returns and tests that didn't run in the hook. A truncated/off-topic final message means assume nothing shipped; verify per-file. When a security/multi-file fix flakes, finishing it directly (you have the reviewer's exact fixes + full context) is usually faster and safer than re-dispatching into another flake.

### 9. Fix ONE instance of a vulnerability *class*, then sweep every sibling before closing it.
The geotech-unit restore IDOR fix was correct — but a `security-reviewer` pass over the *rest* of the restore path found the identical pattern (a cross-project FK the DB accepts because the referenced row exists under another project) on four more entities: `FormationContactOrm.borehole_id`/`cpt_id` (HIGH, untested), `FormationAbsenceOrm.investigation_id` (polymorphic UUID, no DB FK at all), the `LithoBodySolidOrm` geometry (no size cap → OOM vector), and an unwhitelisted review `target_kind`. All flowed through the same shared restore helpers. Fixing only the reported instance would have left the class open.
**Apply:** the moment you fix a security bug, ask "what is the *class*, and where else does it live?" Grep every caller of the shared helper / every entity with the same column shape (`*_id` FKs, polymorphic UUIDs, unbounded JSONB blobs, enum-dispatched strings). Run the dedicated `security-reviewer` on the surrounding surface, not just the one line. A single-instance security fix is a false sense of closure — the reviewer's whole value here was proving the class wasn't closed. The frozen counterpart: also add the missing regression test for the *class* (a valid-formation-but-foreign-investigation contact had zero coverage and passed every existing test).

---

## 2026-07-01 — Backlogged-hook test coverage (the audit tail)

### 10. Writing tests for un-tested code is how you find the shipped bugs — but only if you PROVE the failure, not "fix" it.
Adding a first test suite to `useInvestigationData` (872 LOC, previously zero tests) surfaced a live, shipped bug: `unhideCpts`/`unhideBoreholes` built their `touched` id-list as a **side-effect inside the `setRemovedCptIds` functional updater**, then read `touched.length` **synchronously on the next line**. Under React 18 automatic batching the updater is *deferred to the render phase*, so `touched` was always empty at the synchronous guard → the `is_hidden=false` upsert never fired → a 409-re-imported CPT came back **hidden on the next project load** (the exact failure the code comment says the logic exists to prevent). The local removed-set clear masked it within the session, which is why it shipped. The `testing-reviewer` proposed the test that went RED; the `debugging-scientist` then **proved** (instrumented logs across event-handler, promise-continuation, and effect contexts) that it was a real production bug and not a test-timing artifact — killing the tempting "it's just the test harness" escape hatch. The working sibling `handleRestoreAllCpts` already did it right (compute the list from the closure's current state *before* `setState`); the fix mirrored that.
**Apply:** (a) the highest-value place to add tests is the large hook/module with *none* — that's where the un-caught bugs are. (b) A React functional `setState(prev => …)` updater runs later; never read a variable it mutates on the following synchronous line. Compute the derived list from current state *before* calling `setState`, and add that state to the dep array. (c) When a new test fails in a way that *could* be "just the harness," don't rationalise — instrument the real code in the real call contexts and prove which it is. A guessed "test artifact" verdict would have buried a real data-loss-shaped bug.

---

## 2026-06-11 — a wasted day (the floor-clip / geo-coupled fill thread, reverted `git reset --hard f66ac920`)

### 11. Establish WHERE before HOW — name the render surface / owning layer FIRST.
A feature was built in the 2D section render when it belonged in the 3D litho builder. The target was knowable from three ignored signals: the branch name, the memory file, and a same-day approved spec that literally said "no section-lofting, no frontend plumbing."
**Apply:** before brainstorming any feature, the first paraphrase-back question is *"which surface does this render in / which layer owns it?"* — a hard gate alongside core-problem / who / success / not-do.

### 12. Check done-ness against memory + `git log`, not a spec's status line.
A spec saying "ready to implement" with unchecked boxes can describe ALREADY-SHIPPED work.
**Apply:** before acting on any spec/plan, grep the memory and `git log --oneline` for whether it already shipped.

### 13. When the user gives the same correction twice, STOP iterating the implementation and re-locate the target.
"We've been going in circles all day" / "not even close" are signals the *frame* is wrong, not the *code*.
**Apply:** re-derive what surface / layer / data the feature lives in before the next edit.

### 14. Don't stack new work on an un-dogfed, unmerged branch foundation without flagging it.
It compounds the mess and makes the eventual revert bigger.
**Apply:** flag the shaky foundation before building on it; prefer a clean base.

---

## 2026-07-27 — the voxel model-fidelity investigation

### 15. Prove an offline diagnostic reproduces the production output BEFORE trusting a single conclusion it draws.
Diagnosing the built 3-D litho model needed the frontend's 2-D partition payload, which is not stored anywhere — so the harness had to be rebuilt offline from a captured payload. Two ways to get that wrong bit immediately. (a) The **first** diagnostic recovered the voxel lattice from the persisted mesh vertices and measured a 1 m step for a 2 m grid — the greedy mesher's pinch-splitting inserts coincident edge MIDPOINTS, which are not lattice nodes. Every grid cell it reported was therefore wrong, and it named the wrong pair of boreholes as colliding. (b) The committed oracle fixture was captured from the v1 partition engine, while the build under investigation used v2 — diagnosing against it would have been a diagnosis of a model the owner never saw.
**Apply:** an offline reproduction of a production pipeline is a *hypothesis about the inputs* until it reproduces the production *output*. Make that the harness's first assertion: here, the A/B's control arm had to return the persisted build's exact fidelity numbers (49 covered / 9 uncovered / 41 exact / 8 wrong) before either arm meant anything. Never infer a pipeline's parameters from its output artifacts when the parameters are recorded somewhere authoritative (the project view-state held `voxel_horizontal_spacing_m = 2` all along).

### 16. When two subsystems consume "the position of X", check they mean the SAME position.
The voxel builder framed its model footprint from the section columns' **projected feet** (where an investigation meets the section line) but honored each investigation's drilled log at its **true map position** — two different points, 0.5–64.9 m apart on real data, inside one use case. Nine of 58 interpreted investigations consequently sat outside the footprint that gates labelling, and the model had no material at all where the ground was drilled. Both behaviours were separately documented and separately correct; the contradiction only existed between them.
**Apply:** when an entity has more than one legitimate position (true vs projected, raw vs snapped, screen vs world), treat "which one does this consumer mean?" as a review question at every consumer, and say which one in the parameter name. A footprint that gates *honored* data must be built from the *honored* positions.

### 17. A resolution limit is not a bug — but silently picking a winner is.
Two investigations closer than one voxel cannot both be represented on a regular grid; the builder honored whichever had the lexicographically smaller UUID, which on time-ordered UUIDv7 means "whichever was imported first". The loser's drilled log was replaced by its neighbour's *at the loser's own map position* — the model asserting borehole A's stratigraphy where borehole B was drilled — with nothing in the log to say so. Worse, which pairs collide depends on where the grid origin falls, so the defect set moved when an unrelated fix changed the footprint.
**Apply:** where a discretisation forces a choice between two pieces of real data, the choice is a domain rule the owner has to make — but the *reporting* of it never is. Log every contended pair by name at WARNING before asking the question, and record the arbitrary rule as debt rather than letting it read as intent.

## Verify freshness by CONTENT, not by a timestamp column (2026-07-29)

A `litho_body_solid` upsert wrote correct, current meshes while leaving
`updated_at` at the value from the build that first created the row. The ORM
column declares `onupdate=func.now()`, but that only fires on an ORM-level
UPDATE — a Core `pg_insert(...).on_conflict_do_update(set_=...)` bypasses it
entirely.

The failure this caused was not the stale column itself. It was that a
diagnosis read the timestamp, saw yesterday's date, and concluded twice — to the
owner — that a successful 61-second build had never persisted. The owner rebuilt,
saw no error, and was told again that nothing had been written. Only the backend
log settled it, and the decisive check took one query: the row content carried
**790,910 triangles, exactly the number that build's log reported**.

Two rules out of it:

* **A metadata column is a claim; the payload is the evidence.** When asking "is
  this data fresh?", compare something the process actually computes — a count, a
  checksum, a total — against what the process said it produced. `updated_at` is
  a convenience, and a convenience that can silently be wrong.
* **A row count that matches the new run while the timestamp matches the old one
  is a contradiction, not a curiosity.** 81 rows against a log saying `built=81`
  should have been read as "the write happened" long before it was.

Any `on_conflict_do_update` that omits `updated_at` from its `set_` has this
bug; the ORM declaration will not save it.


## A test guards only what a WRONG implementation would fail (2026-08-09)

Two pure functions shipped with tests that read as thorough and were partly
blind. `packingSnapCandidates` sorted its input, and every fixture happened to
arrive already sorted — delete the sort, suite stays green. `clampToNextBoundary`
documented that it does not depend on candidate order, and its fixture was
sorted too, so "first crossed" and "nearest to the origin" coincided; a wrong
implementation that returned the first in range passed the test written to pin
the nearest.

Both were found the same way, and not by re-reading the assertions: by asking
*what wrong implementation would still pass this?* and then writing that wrong
implementation and running it. A careful read had already judged both adequate.

* **Reading a test tells you what it says. Mutating the code tells you what it
  catches.** Comment out the line the test exists to protect. If it stays green,
  the test is describing behaviour rather than defending it.
* **The most suspicious test is the one whose fixture satisfies the property by
  accident.** Sorted inputs, contiguous depths, values that happen to be
  distinct — anywhere the data makes two different rules agree, only one of them
  is actually pinned.
* **Cost is trivial.** Three edits and three runs covered both functions here,
  and it surfaced a surviving mutant that a deliberate review pass had missed
  once already.

Related, from the same session: a test asserting an ABSENCE (no grip on a
non-draggable boundary) can never go red before the feature exists. It is worth
keeping as a regression guard, but it is not TDD evidence and must not be
counted toward a RED-first claim.

## The pre-commit hook serialises concurrent agents (2026-08-09)

`.githooks/pre-commit` runs a project-wide `tsc --noEmit`, so it type-checks the
whole WORKING TREE, not the files being committed. Two consequences, both hit in
one session:

* **RED-first commits are impossible without a bypass.** Committing a failing
  test on its own cannot pass a hook that runs the suite. The sequence that
  satisfies both: write the test, run it, *record the RED*, commit nothing, write
  the implementation, confirm green, then commit test and implementation as
  separate commits — the hook passes on both because the tree is green by then.
  The RED evidence lives in the transcript, which costs nothing real.
* **Two agents sharing a worktree block each other even on disjoint files.** One
  agent's half-written import fails everyone's `tsc`, so all commits stop. Either
  serialise implementers or give each a worktree. Standing down and waiting is
  the correct response — never `--no-verify`, never a retry loop.

## Hiding a window to let its work finish is what stops the work (2026-08-10)

The close flow hides the main window as soon as the engineer answers
save-or-discard, then finishes the restore in the background so the desktop comes
back immediately. Chromium backgrounds a hidden window and throttles its timers,
so the hide starved the very work it existed to permit: the app never reached its
own quit handshake and the process lingered with no window to show for it.
`webPreferences.backgroundThrottling: false` is the fix.

Three things worth carrying:

* **Any renderer work that must outlive the window's visibility needs the flag.**
  Hiding is not backgrounding-in-the-colloquial-sense; to Chromium it is a signal
  that nothing on the page matters any more.
* **The symptom was nowhere near the cause.** It surfaced as an e2e worker
  teardown timeout on `flow_litho_facies` — a spec about lithology groups, which
  passed alone in 14 s and hung for the full 180 s test timeout in any group run.
  The failure screenshot showed the build complete and no dialog, i.e. the test
  had finished its assertions; the hang was in `closeApp`. Spec-scoped debugging
  would never have reached the window options.
* **Bisect by disabling the suspect, not by reasoning about it.** Two theories
  (a slow restore, a large payload fetch) were both plausible and both wrong; a
  measurement killed the first (a replace-restore took 0.3 s). Making the hide a
  no-op and re-running the failing pair answered it in four minutes: 16.4 s,
  green. Then restore the suspect and fix it properly, so the fix is verified
  against the real failure rather than against its absence.

## A smoke script that re-implements the steps tests the script (2026-08-27)

The bundled-Postgres bring-up (debt #2) was verified with a PowerShell script
that ran `initdb`, started the server, then invoked the migrator. It passed on
the first try. The packaged app then failed on its very first boot, on the
first step the script had "proved", with a 100 %-reproducible error: `initdb`
refuses any target directory that is not empty, and the real code wrote its
`--pwfile` **inside** the data directory before calling it. The script had
written that file to the parent, because that is where a human naturally puts
a temp file. It never executed a line of the code it was vouching for.

* **A harness that reproduces the steps proves the steps are possible, not
  that your code performs them.** The only thing that tests the code is
  calling the code. The fix was an opt-in vitest spec that imports
  `startEmbeddedStack` itself and runs it against the real staged binaries in
  a `mkdtemp` profile on an ephemeral port — no Electron, no window, safe to
  run while the app is in use. It would have failed on day one.
* **Injected seams hide integration bugs by construction — assert the
  contract inside the fake.** The same slice shipped an `alembic upgrade` that
  could never work (`migrations/env.py` calls `asyncio.run`, and the caller was
  already inside a loop) because the upgrade runner is constructor-injected and
  every unit test passed a fake. The durable fix was not just the one-line
  `asyncio.to_thread` but an assertion *inside the fake* that it is never
  invoked from a thread that owns a running loop — so the seam now enforces
  what the real implementation needs.
* **Corollary for anything that writes into a data directory a tool owns:**
  put transient files (password files, markers, locks) OUTSIDE it. Tools that
  demand an empty directory are common, and the failure is total, not partial.

## Never point a test run at the app's real user profile (2026-08-27)

Verifying the packaged build meant launching `dist/win-unpacked/StrixGeo.exe`.
It booted against `app.getPath('userData')` — which resolves from
`package.json`'s `name`, **not** electron-builder's `build.productName`, and so
is the *same* `%APPDATA%/ground-model-desktop` the dev app uses. The run
created a `pgdata`, a credentials file and a log inside the owner's live
profile, then popped a native error dialog on his desktop mid-session.

* **`productName` in the `build` block does not move `userData`.** If a
  packaged app should have its own profile, that has to be arranged
  deliberately — and changing it later orphans whatever the old path holds.
* **Isolate every launch:** `--user-data-dir=<throwaway>`, and never bind the
  dev backend's port (`memory/feedback_e2e_port_8765_conflicts_dev_app`).
  Prefer a headless test that drives the same code (previous lesson) over
  launching the app at all.
* **An error dialog is the wrong failure mode for an unattended process.** Log
  and exit; show a dialog only when a human actually asked for the launch.

## A gate that cannot see failure reports success (2026-08-28)

The pre-push hook ran the integration wrapper, captured its output, and
checked the exit code:

```sh
output="$(powershell.exe -File scripts/run-integration-tests.ps1 2>&1 || true)"
ps_exit=$?          # ALWAYS 0
```

`|| true` sits **inside** the command substitution, so the assignment's status
is the status of `true`. `ps_exit` was never anything but 0 and the "primary
gate" beneath it had been dead code since the day it was written. Proof is two
lines: `out="$(bash -c 'exit 7')"` → `$?` is 7; add `|| true` inside → 0. The
`|| true` was there because `set -e` would otherwise abort the hook — a real
problem solved in the one place that destroyed the signal. Use `set +e` around
the call instead.

* **A gate needs a positive assertion that it RAN, not only a check for
  failure.** The surviving grep for `N failed` looked adequate, but every path
  that exits *before* pytest starts — the wrapper's lock ABORT, an alembic
  failure, a collection error, a crash — prints no summary at all, matches no
  failure pattern, and was reported as **"Integration tests passed"**. Assert
  the summary line exists; treat its absence as a block.
* **Anything that shifts trust onto a gate is a reason to re-read the gate.**
  This surfaced the day a batch mode started skipping per-commit test layers on
  the argument that push-time and CI re-prove them. The weakening was fine; not
  checking the gate it leaned on was not.
* **Do not filter a gate's output when you capture it.** The same evening, a
  landing script piped `git push` through `Select-String 'develop|error|
  Integration'`, which dropped pytest's summary line while keeping test paths
  (they match "integration" case-insensitively) — making a green run look like
  a suite that never ran. Log the whole thing or log the summary deliberately.

## A time-ordered id has no unique prefix (2026-08-28)

The fence DXF exporter disambiguated colliding layer names with the first 8
characters of the formation id: `Fence-SAND (019fe4ac-3)`. Those ids are
**uuid7 — the leading bits are a millisecond timestamp**, so every row created
in the same few seconds shares them. Measured on the live project: **111
formations, 14 distinct 8-char prefixes, one prefix shared by 34 rows**
spanning KLEI 21/22/23 and SILT 13/14/15/16. The trailing `-N` was a bare
collision counter, so the "traceable" suffix identified nothing and a CAD user
faced 13 indistinguishable SAND layers.

* **Never truncate a uuid7 (or ULID, or any k-sortable id) for identity.** The
  entropy is at the END. Truncating a uuid4 is merely risky; truncating a
  time-ordered id is guaranteed to collide for rows created together — which
  is exactly how a pipeline creates them.
* **When a name needs to identify a thing, use the domain identifier.** The
  repo already had one (`unit_identifier` → `NAD-06_ZAND`) used by the section
  DXF and the Plaxis mapping table. The fence had grown its own scheme instead
  of reusing it, and no test compared the two.
* **A disambiguation suffix nobody can interpret is worse than a collision** —
  it looks resolved. A visible collision gets reported; an opaque suffix gets
  trusted.

## Measure the property that matters, not the one that is easy (2026-08-28)

Asked whether small patches in an exported fence were engine debris, the first
pass measured AREA and reported "223 slivers under 50 m², probably debris".
The owner asked the right question — *does every patch have a physical
thickness on the column?* — and the answer inverted the conclusion: **319 of
320 had real thickness (median 1.06 m, minimum 6 cm)**. A thin band that
pinches out over a short distance has small area and is perfectly real
geology. The single apparent exception was also a measurement artefact: the
script rounded plan positions to 10 cm cells and read the zero-thickness end
of a wedge that is 9.9 cm thick at its other end.

* **Area, count and size are proxies. Name the physical property first**, then
  find the measure for it. Here the question was "is there material here?",
  whose measure is thickness at the logged column — not area on a wall.
* **A proxy that supports a tidy conclusion deserves more suspicion, not
  less.** "223 pieces of debris" was a satisfying finding and completely wrong.
* **Rounding is part of the measurement.** A 10 cm plan tolerance silently
  converted a real wedge into a "point contact"; the tolerance, not the data,
  produced the anomaly.
* The proposed remedy would have made things worse: dropping sub-threshold
  patches deletes logged ground and punches holes in a model whose stated
  invariant is that it is gapless.
