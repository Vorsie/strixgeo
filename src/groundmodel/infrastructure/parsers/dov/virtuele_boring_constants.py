"""Constants for the DOV Virtuele Boring (virtual borehole) REST API.

The API lives at ``services.dov.vlaanderen.be/virtueleboringserver`` and
exposes per-point and per-line synthetic borehole queries against the
Flanders public subsurface models (G3D v2/v3, HCOV v1/v2, OMA v1.1,
primary minerals). See CLAUDE.md "Known Architectural Debt" #10 for the
motivation. The doorprik endpoint gives one absolute-elevation
top/base/thickness row per layer encountered at a single (x, y) point.

Verified live 2026-05-14:
* Bare GET → 400 "Required request parameter 'xValues' for method
  parameter type List is not present".
* ``/profielbevraging/lagen`` requires ``xValues`` + ``yValues`` lists
  with at least two points (polyline). Single-point probes return
  500 with an empty body.
* ``/virtueleprofielen/doorprik/{model}?x=&y=`` returns 200 with the
  per-layer stack at the point. This is what we call from the client.
* CRS expected: Belgian Lambert 72 (EPSG:31370). Out-of-Flanders
  coordinates return 200 with whatever-was-extrapolated data; we gate
  on ``epsg == 31370`` at the application layer rather than rely on
  DOV to refuse the query.
"""

from __future__ import annotations

# Public base URL. The internal path is ``/dovvirtueleboringserver/...``
# (the Spring context-path) — 404s reveal it but it is not the public
# entry. Always use the public ``/virtueleboringserver/`` form.
DOV_VIRTUELE_BORING_BASE_URL = "https://services.dov.vlaanderen.be/virtueleboringserver"

# Point-pick endpoint. Returns ``{data: [{name, top, base, thickness}],
# layers: [<full unit catalogue inline>]}`` for the chosen model.
DOV_VIRTUELE_BORING_DOORPRIK_PATH = "/base/virtueleprofielen/doorprik"

# Model-catalog endpoint. Returns the list of 12 (currently) available
# layered models with their allowed resolutions. Used by the desktop
# client to populate the model-picker dropdowns.
DOV_VIRTUELE_BORING_LAGENMODEL_PATH = "/base/lagenmodel"

# Default model code — Geologisch 3D-model v3.1 per formatie. Anything
# else (members, hydrogeology, primary minerals, Antwerp shallow model)
# is selected explicitly by the caller.
DOV_VIRTUELE_BORING_DEFAULT_MODEL = "g3dv3_F"

# The Virtuele Boring server expects Lambert 72. Only investigations
# already stored in that CRS round-trip cleanly — anything else gets
# transformed at the application layer before the call.
DOV_VIRTUELE_BORING_HORIZONTAL_EPSG = 31370

# Per-call timeout. The doorprik endpoint typically responds in <500 ms
# but we leave generous slack for cold-cache DOV servers. Connect
# timeout stays short so a DNS/connectivity failure surfaces quickly.
DOV_VIRTUELE_BORING_TIMEOUT_SECONDS = 30.0
DOV_VIRTUELE_BORING_CONNECT_TIMEOUT_SECONDS = 10.0

# Per-project parallel doorprik fan-out. Each investigation × selected
# model is one request; a 50-CPT project × 2 models = 100 calls. DOV's
# per-IP rate limit kicks in above ~50 concurrent during peak hours per
# CLAUDE.local.md "DOV import end-to-end" notes — match that ceiling.
DOV_VIRTUELE_BORING_PARALLELISM = 50
