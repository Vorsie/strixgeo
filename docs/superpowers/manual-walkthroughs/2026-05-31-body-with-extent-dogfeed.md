# Manual Dogfeed Walkthrough — Body-with-Extent Gestures (Slice 7)

**Date:** 2026-05-31
**Branch:** develop
**Scope:** Slice 7 — frontend gestures, auto-suggest UI, provenance-conflict dialog

---

## Prerequisites

1. Backend running on `localhost:8765` (`uv run uvicorn ...` or the usual dev start script).
2. Dev DB has at least one project with a lithostratigraphic model that has accepted contacts.
3. Desktop app running (`npm run dev` in `desktop/`).

---

## Step 1 — Open a section with accepted litho contacts

1. Open the project.
2. Navigate to the **Sections** stage.
3. Select an existing section that has accepted litho contacts visible.
4. Switch the axis to **Lithostratigraphic** (the litho toggle in the toolbar).

Expected state: you can see litho bands in the section view with green boundary lines and, if you ran auto-correlate, emerald/amber ribbon-style correlation overlays.

---

## Step 2 — Right-click a body wedge (BodyContextMenu)

1. In the section view, right-click on one of the detected body wedges (the fill area between two correlated bands).
2. A context menu should appear with:
   - **Claim left extent** submenu: `Pinch-out (halfway)`, `Extrapolated`, `Open`
   - **Claim right extent** submenu: same items
   - **Name body**
   - **Dissolve body**

**Verify:** menu appears at the pointer position (not at screen 0,0).

---

## Step 3 — Claim a body extent

1. From the right-click context menu, choose **Claim left extent → Pinch-out (halfway)**.
2. Expected: a success toast "Extent claimed: left → pinch_out_halfway".
3. The body wedge in the section view should update to show a halfway-pinch geometry on the left side.

**Verify:** the body's left side now shows as a wedge tapering to the midpoint between the source and its nearest neighbour.

---

## Step 4 — Provenance conflict (409 path)

The provenance-conflict dialog fires only when trying to overwrite an
**auto-detector-set** `to_target` extent. User-to-user overwrite just
succeeds silently. To reach the dialog:

1. First run **Detect bodies** (the `DetectBodies` verb — either via API or
   a toolbar button if wired) so the model has a body with `to_target` on
   one side. Alternatively, skip ahead if you already have such a body.
2. Right-click the body with the `to_target` extent.
3. Choose **Claim left extent → Extrapolated** (overwriting the detector claim).
4. Expected: the **Provenance Conflict Dialog** opens:
   - Title: "Extent already claimed"
   - Body copy: "The left side of this body already has an auto-detected
     extent. Your claim (extrapolated) would overwrite it."
   - Three buttons: **Apply my claim** (default-focused), **Keep current**, **Cancel**

5. Click **Apply my claim**.
6. Expected: a success toast "Extent claimed: left → extrapolated". The body's
   left extent is now `extrapolated`.

**Note:** Claiming over a *user-set* extent (e.g. you already claimed
`pinch_out_halfway` in Step 3) silently overwrites without a dialog — the
provenance guard protects detector claims only.

---

## Step 5 — Clear a body extent

1. Right-click the body again.
2. Choose **Clear left extent** (appears in the menu when the side is already claimed).
3. Expected: a success toast. The body's left side reverts to null (no left-side rendering).

---

## Step 6 — Name a body

1. Right-click a body.
2. Choose **Name body**.
3. A browser prompt appears — enter a name (e.g. "Test lens").
4. Click OK.
5. Expected: success toast. The body's name is now stored.

---

## Step 7 — "Suggest pinch-outs" toolbar verb

1. In the section toolbar (top of the section view), look for the **Suggest pinch-outs** button (Sparkles icon, next to "Detect lenses").
2. Click it.
3. Expected: a toast showing the number of candidates found (e.g. "3 pinch-out candidates").
4. In the section view, dashed amber wedges should appear for each candidate — these are the ghost candidates.

**If 0 candidates:** the toast says "No pinch-out candidates found" and no ghost wedges appear. This is correct if the topology has no single-sided correlation closure.

---

## Step 8 — Click a ghost candidate to accept it

1. If ghost candidates appeared in Step 7, click on one of the dashed amber wedge fills.
2. Expected: a success toast "Pinch-out claimed." The ghost disappears, and the body gets a new `pinch_out_halfway` extent on that side.
3. The ghost candidate list is cleared (all remaining ghosts disappear too).

---

## Step 9 — Dissolve a body

1. Right-click any body wedge.
2. Choose **Dissolve body**.
3. A confirmation dialog appears: "Dissolve this body? This removes the body and its extent data."
4. Click OK.
5. Expected: success toast "Body dissolved." The body wedge disappears from the section view.

---

## Known limitations (DONE_WITH_CONCERNS)

- The Playwright e2e spec (`flow_body_extent_gestures.spec.ts`) exercises the API contract only. It requires a fixture project with a lithostratigraphic model. The spec will skip gracefully if no candidates are found for the suggest-pinch-outs step (topology-dependent).
- The provenance-conflict "Apply" path in the dialog does a sequential `clearBodyExtent` → retry `claimBodyExtent`. If the retry itself returns 409 (e.g. both sides were claimed by the detector), the user will see another conflict dialog. This is correct behaviour but slightly surprising — future work could detect this loop.
- `nameBody` uses `window.prompt` (quick path) — see debt #93 for the full rename UX via InspectLensBodyPanel.
