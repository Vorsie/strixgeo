# Formation color swatch — click-to-override

**Date:** 2026-05-30
**Stage:** Geology (also visible in Lithology via shared `formation.color`)
**Owner:** Robin

## Problem

The Geology inspector's formation list shows a coloured swatch next to each
formation. Today the only path to change that colour is the full Edit Formation
modal (`FormationDialog`). When the user wants a quick contrast tweak — two
neighbouring formations are close in hue, the section is hard to read — the
modal is the wrong tool: it asks for name + regional ref alongside the colour
and is heavier than the intent.

## Goal

Click the swatch → native colour picker opens → on close, the formation's
colour updates project-wide (sections, 3D viewer, DXF/Plaxis exports,
Lithology stage). One gesture, no modal.

Owner framing (2026-05-30): *"this is just to increase contrast between
layers if necessary"* — small visual ergonomics, not a styling overhaul.

## Non-goals

- **No global / user-level catalog override.** Override stays scoped to this
  project's formation rows.
- **No "reset to default" affordance.** The default lives only at creation
  (G3Dv3 autocomplete or the neutral `#9ca3af`); we don't store it separately.
  If a user wants to revert, they re-open the Edit dialog and re-pick the
  G3Dv3 entry.
- **No contrast-aware preset palette.** Native picker is enough.
- **No new persistence layer.** The existing `formation.color` field (already
  a string, already PATCHable, already in the `.gmproj` bundle) is the store.

## Design

### Storage

Reuses the existing `GeologicalFormation.color` (`str`, hex `#aabbcc`) and the
existing `PATCH /projects/{pid}/geology/formations/{fid}` endpoint with the
`{ color }` field of `GeologicalFormationUpdatePayload`. **Zero new backend
surface.**

"Project-specific" satisfied because formation rows are project-scoped: a new
project has no formations until the user creates them, and each new formation
takes its catalog/default colour at creation time. There is no carry-over from
one project to the next.

### Gesture

The swatch element in `GeologyInspector.tsx:991` is currently:

```tsx
<span
  aria-hidden
  style={{ backgroundColor: formation.color }}
  title={formation.color}
  className="inline-block w-3 h-3 rounded-sm border border-gray-300"
/>
```

It becomes a `<label>` wrapping a hidden native `<input type="color">`:

```tsx
<label
  className="inline-block w-3 h-3 rounded-sm border border-gray-300 cursor-pointer ..."
  style={{ backgroundColor: pendingColor ?? formation.color }}
  title={`${formation.color} — click to change`}
>
  <input
    type="color"
    className="sr-only"
    value={pendingColor ?? formation.color}
    onChange={(e) => setPendingColor(e.currentTarget.value)}
    onBlur={() => commitColorIfChanged()}
  />
</label>
```

Local `pendingColor` state holds the in-progress pick so the swatch reflects
the chosen colour while the OS picker is still open. `onBlur` is the commit
trigger:

- If `pendingColor` equals `formation.color` (or is null) → no-op, clear
  pending state.
- Otherwise → call `handleUpdateFormationColor(formation, pendingColor)`:
  1. PATCH `/formations/{id}` with `{ color: newColor }`.
  2. On success: `handleFormationUpdated(response)` (bus refresh, dirties the
     `.gmproj`).
  3. Push an undo command that PATCHes back to the previous colour.
  4. Clear `pendingColor`.

### Undo entry

Matches the existing reorder / delete undo shape in the inspector. The command
captures `{ formationId, oldColor, newColor }`; redo re-applies `newColor`,
undo re-applies `oldColor`. Both paths go through the same
`api.geology.updateFormation` call so the bus stays consistent.

### Where the new colour shows up

`formation.color` is consumed by:

- `GeologyInspector` row swatch (this file).
- `LithologyInspector` swatches via the shared formation list.
- `ContactsLayer` band fills + `CorrelationEdgesOverlay` colours via
  `contactOverlays.ts`.
- The pinch-out ghost overlay.
- `Geology3DViewer` formation surface colours.
- DXF + Plaxis exports (layer names + colour metadata).

All of these read `formation.color` reactively through the
`useGeologicalModel` bus, so they update on the next render after
`handleFormationUpdated` fires. No additional plumbing.

## Edge cases

- **Picker cancelled (user hits Esc / closes without changing).** `onChange`
  never fires → `pendingColor` stays null → `onBlur` no-ops. No PATCH.
- **User picks the same colour they started with.** Equality check in
  `commitColorIfChanged` skips the PATCH and the undo push.
- **PATCH fails (network error).** `pendingColor` is cleared in `finally`, so
  the swatch reverts to `formation.color` and the failure is surfaced through
  the existing `handleFormationUpdated` error toast path (no new error UI).
- **Session-import formation (amber asterisk).** Unchanged — the override
  flows through `formation.color`, which the session-import manifest already
  tracks. Re-PATCHing a session-imported formation doesn't add a second entry
  to the manifest.
- **Read-only model.** Same gating the existing Edit button uses; the swatch
  button gets the same `disabled` prop.

## Testing

Vitest cases in a new `GeologyInspector.colorSwatch.test.tsx`:

1. Renders the swatch with the formation's current colour.
2. Changing the input fires no PATCH until blur.
3. Blur with a changed colour fires `api.geology.updateFormation` with the new
   value, calls `handleFormationUpdated`, and pushes one undo command.
4. Blur with the same colour fires no PATCH and pushes no undo.
5. Esc-cancel (no `onChange` event) fires no PATCH.
6. Undo command re-PATCHes back to the previous colour.

No new integration test needed — the backend path is exercised by existing
`PATCH /formations/{id}` tests.

## Implementation files (estimated)

- `desktop/src/renderer/src/shell/stages/geology/GeologyInspector.tsx` — swap
  the swatch for the labelled input, add `pendingColor` state, add the
  `commitColorIfChanged` handler. ~30 lines net.
- `desktop/src/renderer/src/shell/stages/geology/GeologyInspector.colorSwatch.test.tsx`
  — new file, ~120 lines.

No backend / domain / ORM / migration changes.

## Out of debt

This is a one-component slice; it does not unblock or affect any Tier G item.
It lands as a small ergonomics improvement on the existing geology stage.
