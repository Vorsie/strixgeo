# Connecting geotech units — design

**Date:** 2026-06-25
**Status:** ready for plan
**Owner directive:** brainstormed 2026-06-25. Goal = litho units subdivided by packing, with the packing sub-bands **connected across tests into true geotech bodies** — auto where the packing sequence matches, plus user-adjustable manual connect/disconnect — feeding the Parameters stage later.
**Builds on:** the geotech subdivision (`SubdivideAllBodies`, develop) + the litho correlation machinery (correlate-mode gesture, `litho_contact_correlation_edge`, `ResolveLithoInstances`).

---

## 1. Problem

The geotech subdivision splits each litho unit into NAD packing sub-bands per test. Today the cross-test connection of those sub-bands is weak:

- The persisted geotech edges are **derived from litho edges** (`SubdivideAllBodies._derive_geotech_edges_from_litho`): a packing band connects only where the *litho* contacts were correlated **and** the resulting sub-bands are the same NAD class. The engineer can't say "this matig-sand continues to the next test" independently.
- The section **render** connects sub-bands by an ephemeral local sequence-match inside `subdivideRegionsByGeotech` (frontend), with no persistence and no way to adjust it.

The engineer wants packing bands correlated into **connected geotech bodies** — auto-seeded by matching packing sequences, then **manually adjustable** — so each geotech body is a single packing class traced across tests (the unit the future Parameters stage will compute per-body statistics on).

## 2. Scope & frame

**Within each litho body.** The litho correlation stays the connectivity frame: a litho body already traces a soil (e.g. a sand) across tests. Packing connections only join sub-bands **inside the same litho body**. This deliberately avoids the "187 singletons" trap (a from-scratch geotech-edge partition, where loose-sand never bands to dense-sand) — the litho partition provides connectivity; packing subdivides and connects *within* it.

**Connection rule (auto and manual):** an edge may join two sub-bands only when they are the **same NAD class** AND in the **same litho body**. A geotech body is therefore one packing class — which is what makes per-body parameters meaningful. Tying two different packing classes is rejected.

## 3. Architecture — reuse the litho correlation machinery

No new subsystem. Geotech packing correlation *is* litho correlation pointed at the geotech axis:

- **Edges:** the existing `litho_contact_correlation_edge` rows on the **geotech** model are the source of truth for packing connections (they already exist there, currently auto-derived). Each edge ties two geotech sub-band `litho_layer` ids. Auto and manual edges are **identical rows** — a manual connect inserts a row, a manual disconnect deletes one; no `auto`/`manual` flag is needed.
- **Bodies:** `ResolveLithoInstances` already runs over geotech edges → stamps `body_id` on each geotech sub-band + materialises `BodyOrm`. That is the connected geotech body the Parameters stage will group on (Parameters itself stays out of scope — this lays the body foundation).

## 4. Auto population (replaces `_derive_geotech_edges_from_litho`)

In `SubdivideAllBodies`, the geotech edge derivation changes from "map litho edges" to "packing-sequence match within each litho body":

1. Group the materialised geotech sub-bands by **litho body** (the litho `body_id` of the parent litho unit each sub-band was subdivided from).
2. Within a litho body, order its participating tests **along the section** and walk adjacent test pairs.
3. For an adjacent pair, compare their packing **sequences** (the ordered list of NAD classes of the sub-bands in that body on each test). If the sequences are **identical** (same count, same class order), emit a geotech edge between each aligned pair of sub-bands (1:1). Any mismatch → emit nothing for that pair (manual fills it).
4. Canonical `a < b` ordering, dedup per section, same as the litho edge derivation.

This is purely deterministic from the packing classification, so it re-runs cleanly on every subdivide.

## 5. Manual gesture — reuse litho correlate UX

A **"Correlate packing"** toolbar verb on the geotech axis, mirroring litho's Correlate and reusing the same correlate-mode state machine:

- Click a packing band on one test → armed (sticky source); click the band on the neighbour → **connect** (insert a geotech edge). **Guard:** allowed only when the two bands are the **same NAD class** AND in the **same litho body**; otherwise rejected with a brief hint ("packing connects the same class within one litho unit").
- **Right-click a connection → Disconnect** (delete the edge).
- The click target is the per-column packing band (the geotech sub-layer rect — already NAD-coloured + NAD-labelled), the object the engineer is already reading.
- Connect/disconnect persists immediately (same endpoints the litho correlate gesture uses, pointed at the geotech model), then re-runs `ResolveLithoInstances` so `body_id` + the render update.

## 6. Render — driven by geotech `body_id`

`subdivideRegionsByGeotech` stops deciding sub-band connections by *local sequence-match* and instead reads the geotech **`body_id`** the resolver stamped on each sub-band: within a litho region, two adjacent sub-bands join into one banded sub-quad **iff they share a geotech `body_id`**, else they render as separate per-test sub-bands. Both auto and manual connections flow through the resolver → `body_id` → render, so a manual connect/disconnect updates the section immediately.

The litho partition still frames every region, so an unconnected sub-band is a per-test sliver **inside its litho band** — never a model-wide singleton. The 187-singleton trap stays closed because connectivity is bounded by the litho partition, not recomputed from geotech edges across the whole model.

## 7. Durability across re-subdivide

Re-running "Subdivide all bodies" regenerates the geotech sub-band layers with new ids, so it **wipes and regenerates all geotech connections** (auto is re-derived; manual is lost). This is acceptable — the engineer adjusts after subdividing and rarely re-subdivides. A **confirmation prompt** fires before a re-subdivide *when geotech connections already exist*: "Re-subdividing regenerates all geotech packing connections — any manual connections you made will be cleared. Continue?" (default-focus Cancel, action-named button). The first-ever subdivide does not prompt.

## 8. Edge cases

- **Borehole sub-bands** carry an extrapolated NAD class, so they connect by the same same-class/same-body rule.
- **`nad_class = null`** sub-bands (no qc, no extrapolation) cannot auto-connect; a manual tie is rejected (no class to match).
- A **litho body spanning a single test** has nothing to connect — its sub-bands are per-test by definition.
- A manual connect whose litho-body or class guard fails is a no-op with a hint (never a silent partial connect).

## 9. Testing

- **Pure-domain (auto rule):** identical packing sequence within a litho body → 1:1 edges; any mismatch → no edges for that pair; two sub-bands in different litho bodies never connect; same litho body but different NAD class never connect.
- **Frontend (gesture):** correlate-packing mode emits an edge for a same-class/same-body pair; rejects a cross-body tie; rejects a cross-class tie; right-click disconnects.
- **Frontend (render):** two sub-bands sharing a geotech `body_id` band into one sub-quad; differing `body_id` stay split; an unconnected sub-band renders as a per-test sliver inside its litho region (no model-wide singleton).
- **Re-subdivide prompt:** fires only when connections exist; confirm wipes + regenerates.
- **Real-data acceptance (the arbiter):** on `test.strix`, after Subdivide, a litho sand body whose two adjacent tests share a packing sequence renders one connected packing band per class; a mismatched pair renders per-test until a manual tie joins the same-class bands.

## 10. Out of scope

- The Parameters stage itself (per-body statistics) — this only lays the connected-body foundation.
- Cross-litho-body packing connections (deliberately excluded — within-body only).
- LCS / nearest-class auto-matching (auto is full-sequence-match only; manual covers the rest).
- Any change to the litho correlation, the litho partition, or the NAD classifier.
