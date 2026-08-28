/**
 * Shared plumbing for the Cesium VISUAL-GOLDEN specs
 * (``flow_unit_statistics``, ``flow_litho_3d_golden``).
 *
 * Why this exists — pixel goldens need a level of determinism the rest of
 * the suite never asked for:
 *
 * 1. **The fixture baseline must be re-established in-spec.**  Earlier specs
 *    in a full-suite run legitimately mutate the shared fixture (bulk-accept
 *    adds litho units, the geotech pipeline spec rebuilds the geotech model,
 *    …), and every mutation reshapes the scene a golden pins.  Assertions on
 *    testids tolerate that; a screenshot cannot.  ``reseedFixture`` re-runs
 *    ``build_synthetic_fixture.py`` — the sanctioned reset, the same one the
 *    e2e runner performs at suite start — so the golden always renders the
 *    seeded baseline regardless of which specs ran before.  Re-seeding
 *    restores the exact suite-start state, and every spec in this suite is
 *    order-proof by convention, so later specs are unaffected.
 *
 * 2. **The renderer must not reach the network.**  The Cesium basemap lid
 *    textures itself from the Geopunt ortho WMS when the machine is online
 *    (``computeBasemapBounds`` builds the GetMap URL), so the same scene
 *    renders differently online vs offline — and the WMS imagery itself can
 *    change over time.  ``blockExternalNetwork`` aborts every non-local
 *    http(s) request from the renderer, pinning the golden to the offline
 *    rendering in every environment.  (The rest of the suite is already
 *    offline by design — DOV is cassette-served — this just closes the one
 *    remaining hole for pixel assertions.)
 *
 * 3. **WebGL output needs a tolerance.**  SwiftShader (the harness forces
 *    ``STRIXGEO_DISABLE_GPU=1``) is a deterministic software rasteriser, so
 *    same-machine same-scene runs are near-identical — but anti-aliased
 *    triangle edges and text can wobble by a frame's worth of sub-pixel
 *    noise between runs (camera flight easing lands on slightly different
 *    final frames).  ``WEBGL_MAX_DIFF_PIXEL_RATIO`` is the shared budget;
 *    see the constant's comment for how it was chosen and when to revisit.
 */

import { execFileSync } from 'node:child_process'
import path from 'path'

/** Fixed backend port — matches the rest of the harness. */
const API_BASE = 'http://127.0.0.1:8765'

/**
 * Per-golden pixel budget for ``toHaveScreenshot``.
 *
 * 0.02 (2 % of the element's pixels may differ, each judged with
 * Playwright's default per-pixel YIQ threshold of 0.2) absorbs SwiftShader's
 * anti-aliasing wobble on triangle edges and the sub-pixel variance of the
 * camera flight's final frame, while still failing loudly on any real scene
 * change (a moved wall, a recoloured unit, a missing panel repaints far more
 * than 2 %).  Chosen as a documented starting point, not a measurement of
 * one machine: tighten it if re-runs prove byte-stable, loosen it ONLY with
 * a diff image in hand showing the noise is genuinely non-semantic.
 */
export const WEBGL_MAX_DIFF_PIXEL_RATIO = 0.02

/**
 * How long to let a freshly mounted Cesium scene settle before screenshotting.
 *
 * The camera frames the model with ``flyToBoundingSphere({ duration: 1.5 })``
 * (``geology3DPrimitives.flyToBounds``), and SwiftShader needs a few more
 * frames after the flight to finish mesh upload + first full render.  4 s =
 * the 1.5 s flight + a 2.5 s software-rendering allowance.
 */
export const CESIUM_SETTLE_MS = 4_000

/**
 * Re-run the synthetic fixture builder, restoring the seeded baseline.
 *
 * Spawns ``uv run python desktop/tests/e2e/fixtures/build_synthetic_fixture.py``
 * from the repo root — the exact command the e2e runner uses at suite start —
 * and verifies the printed project id matches ``expectedProjectId`` so a
 * mis-pointed DATABASE_URL fails here, loudly, instead of as a golden diff.
 *
 * Parameters
 * ----------
 * expectedProjectId
 *     The suite's ``E2E_FIXTURE_PROJECT_ID`` — the deterministic project the
 *     builder must (re)seed.
 *
 * Raises
 * ------
 * Error
 *     When the builder exits non-zero or seeds a different project id.
 */
export function reseedFixture(expectedProjectId: string): void {
  const started = Date.now()
  // helpers/ → e2e → tests → desktop → repo root.
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..')
  // execFileSync (never a shell) — the arguments are static, and ``uv`` is a
  // native .exe so Windows resolves it through PATH without cmd.exe. stderr
  // (the builder's log) passes through to the Playwright reporter output for
  // diagnosis; stdout is captured for the id check.
  const stdout = execFileSync(
    'uv',
    ['run', 'python', 'desktop/tests/e2e/fixtures/build_synthetic_fixture.py'],
    { cwd: repoRoot, timeout: 300_000, stdio: ['ignore', 'pipe', 'inherit'] },
  ).toString()
  const lines = stdout.trim().split(/\r?\n/)
  const seededId = lines[lines.length - 1]?.trim()
  if (seededId !== expectedProjectId) {
    throw new Error(
      `reseedFixture: builder seeded project ${seededId ?? '<none>'}, ` +
        `expected ${expectedProjectId} — is DATABASE_URL pointing at the integration DB?`,
    )
  }
  // The reseed is the single biggest slice of a golden spec's budget — logged
  // so a timeout can be attributed instead of guessed at.
  console.log(`[golden] reseedFixture: ${Date.now() - started} ms`)
}

/**
 * Abort every renderer request that leaves the machine.
 *
 * Local backend traffic (``127.0.0.1`` / ``localhost``) and non-http schemes
 * (``file://`` app assets, ``devtools://``) pass through untouched; anything
 * else — the Geopunt WMS lid texture, map tiles, whatever a future dependency
 * phones — is aborted so the golden renders the offline scene everywhere.
 *
 * Parameters
 * ----------
 * page
 *     The renderer page, BEFORE navigating to a stage that mounts Cesium.
 */
export async function blockExternalNetwork(
  page: import('@playwright/test').Page,
): Promise<void> {
  await page.route('**/*', route => {
    const url = route.request().url()
    const external =
      /^https?:\/\//i.test(url) &&
      !url.startsWith('http://127.0.0.1') &&
      !url.startsWith('http://localhost') &&
      !url.startsWith('https://127.0.0.1') &&
      !url.startsWith('https://localhost')
    return external ? route.abort() : route.continue()
  })
}

/** What ``resolveFenceTargetUnit`` learned about the seeded geotech model. */
export interface FenceTargetUnit {
  /** The geotech model the Parameters roster reads. */
  geotechModelId: string
  /** The NAD unit (geotech formation) whose fence walls the spec pins. */
  unitId: string
  /** Distinct resolver bodies among the unit's accepted bands. */
  bodyCount: number
  /** Approved same-unit edges over qc-bearing CPTs — the wall supply. */
  approvedEdgeCount: number
  /**
   * The litho unit (formation) hosting the target's bands — the tree's TOP
   * level row (the Parameters pane lists litho units, not geotech units,
   * since the 2026-08-27 body-tree redesign).
   */
  lithoUnitId: string
  /** The litho resolver body the covering litho bands belong to (level 2). */
  lithoBodyId: string
  /** The target unit's NAD packing class — the class-row key component. */
  nadClass: number
  /**
   * Distinct geotech bodies among the class row's bands inside that litho
   * body — decides the leaf-absorb branch (≥2 → expander + body rows; 1 →
   * the class row IS the leaf).
   */
  classBodyCount: number
  /** Litho bodies homed to ``lithoUnitId`` — level-2 sibling count. */
  lithoBodyCount: number
  /** Distinct NAD classes inside ``lithoBodyId`` — level-3 sibling count. */
  classCount: number
  /**
   * The DEEPEST tree row the leaf-absorb rule leaves standing for this chain,
   * derived bottom-up from the sibling counts above — never from the DOM.
   *
   * The rule (spec §1, GT3 precedent): "a level with exactly one child renders
   * no expander and no child row", applied only when that single child is
   * itself a leaf. So a one-body / one-class / one-geotech-body chain collapses
   * all the way up and the LITHO UNIT row is the leaf. The spec walks to this
   * level and asserts the rows above it expand — pinning the ruling rather
   * than assuming a fixed depth (the fixture's chain is fully single-child,
   * which is exactly how a four-level walk failed on a correct tree).
   */
  deepestKind: 'litho-unit' | 'litho-body' | 'geotech-class'
}

/**
 * Resolve, over the API, which seeded NAD unit the fence-cutout golden pins.
 *
 * The geotech rows are re-minted (uuid7) on every seed, so the spec cannot
 * hard-code ids — instead it derives the target the way the fence itself
 * does: the unit must have accepted bands on qc-bearing CPTs AND at least
 * one approved edge joining two of its own bands (that pair is what
 * ``buildProjectFence`` turns into wall panels).  Candidates are ordered by
 * approved-edge count (desc), band count (desc), then NAD class + name —
 * CONTENT fields, never minted ids, so the same unit wins every seed even
 * though its uuid7 id differs.
 *
 * Parameters
 * ----------
 * projectId
 *     The fixture project id.
 *
 * Returns
 * -------
 * Promise<FenceTargetUnit>
 *     The winning unit + the counts the spec asserts on.
 *
 * Raises
 * ------
 * Error
 *     When no geotech model exists or no unit qualifies — both mean the
 *     fixture's ``_seed_geotech_model`` step did not run or regressed.
 */
export async function resolveFenceTargetUnit(projectId: string): Promise<FenceTargetUnit> {
  const getJson = async (url: string): Promise<unknown> => {
    const r = await fetch(url)
    if (!r.ok) throw new Error(`GET ${url} → HTTP ${r.status}: ${await r.text()}`)
    return r.json()
  }
  const geologyBase = `${API_BASE}/projects/${projectId}/geology`

  const models = (await getJson(`${geologyBase}/models`)) as { id: string; kind: string }[]
  const geotech = models.find(m => m.kind === 'geotechnical')
  if (!geotech) {
    throw new Error(
      'resolveFenceTargetUnit: no geotechnical model — did the fixture seed step run?',
    )
  }

  const layers = (await getJson(`${geologyBase}/models/${geotech.id}/layers`)) as {
    id: string
    formation_id: string
    cpt_id: string | null
    body_id: string | null
    status: string
    parent_litho_layer_id: string | null
  }[]
  const edges = (await getJson(`${geologyBase}/models/${geotech.id}/contact-correlations`)) as {
    layer_a_id: string
    layer_b_id: string
    user_approved: boolean
  }[]
  const cpts = (await getJson(`${API_BASE}/cpt/?project_id=${projectId}`)) as {
    id: string
    n_rows: number | null
  }[]
  const formations = (await getJson(`${geologyBase}/formations`)) as {
    id: string
    name: string | null
    nad_class: number | null
  }[]
  const formationById = new Map(formations.map(f => [f.id, f] as const))

  const qcCptIds = new Set(cpts.filter(c => (c.n_rows ?? 0) > 0).map(c => c.id))
  const acceptedById = new Map(
    layers.filter(l => l.status === 'accepted').map(l => [l.id, l] as const),
  )

  // Approved edges whose BOTH endpoints are accepted bands of the SAME unit
  // on qc-bearing CPTs — the pairs the fence turns into wall panels.
  const edgeCountByUnit = new Map<string, number>()
  for (const e of edges) {
    if (!e.user_approved) continue
    const a = acceptedById.get(e.layer_a_id)
    const b = acceptedById.get(e.layer_b_id)
    if (!a || !b || a.formation_id !== b.formation_id) continue
    if (a.cpt_id === null || b.cpt_id === null) continue
    if (!qcCptIds.has(a.cpt_id) || !qcCptIds.has(b.cpt_id)) continue
    edgeCountByUnit.set(a.formation_id, (edgeCountByUnit.get(a.formation_id) ?? 0) + 1)
  }
  if (edgeCountByUnit.size === 0) {
    throw new Error(
      'resolveFenceTargetUnit: no approved same-unit geotech edge over qc CPTs — ' +
        'the fence cutout would be empty; check _seed_geotech_model.',
    )
  }

  const bandCountByUnit = new Map<string, number>()
  const bodiesByUnit = new Map<string, Set<string>>()
  for (const l of acceptedById.values()) {
    bandCountByUnit.set(l.formation_id, (bandCountByUnit.get(l.formation_id) ?? 0) + 1)
    if (l.body_id !== null) {
      const set = bodiesByUnit.get(l.formation_id) ?? new Set<string>()
      set.add(l.body_id)
      bodiesByUnit.set(l.formation_id, set)
    }
  }

  // Tie-breaks are CONTENT fields (NAD class, then name): the uuid7 ids are
  // re-minted per seed, so an id-based order could flip the winner between
  // seeds even though the rendered scenes are identical.
  const nadOf = (fid: string): number => formationById.get(fid)?.nad_class ?? 999
  const nameOf = (fid: string): string => formationById.get(fid)?.name ?? ''
  const winner = [...edgeCountByUnit.entries()].sort(
    (x, y) =>
      y[1] - x[1] ||
      (bandCountByUnit.get(y[0]) ?? 0) - (bandCountByUnit.get(x[0]) ?? 0) ||
      nadOf(x[0]) - nadOf(y[0]) ||
      nameOf(x[0]).localeCompare(nameOf(y[0])),
  )[0][0]

  // The tree hangs every geotech band under its covering litho band's body
  // (``parent_litho_layer_id``, the Slice-A FK). Majority band count picks
  // the litho home the golden pins; the tie-break is CONTENT (shallowest
  // covering band) because every id is re-minted per seed.
  const litho = models.find(m => m.kind === 'lithostratigraphic')
  if (!litho) {
    throw new Error('resolveFenceTargetUnit: no lithostratigraphic model in the fixture')
  }
  const lithoLayers = (await getJson(`${geologyBase}/models/${litho.id}/layers`)) as {
    id: string
    formation_id: string
    body_id: string | null
    depth_top: number | null
  }[]
  const lithoById = new Map(lithoLayers.map(l => [l.id, l] as const))

  // The tree homes a litho body under the ROSTER's formation (BodyOrm
  // .formation_id), falling back to the band's own formation only when the
  // roster does not know the body — mirror of lithoBodyIdsForUnit. Deriving
  // the unit from the band's formation alone addresses the wrong top-level
  // row whenever a body's home differs (the twin case) — the first re-run
  // failed exactly there.
  const lithoBodies = (await getJson(`${geologyBase}/models/${litho.id}/bodies`)) as {
    id: string
    formation_id?: string | null
  }[]
  const bodyHomeById = new Map(lithoBodies.map(b => [b.id, b.formation_id ?? null] as const))

  interface LithoHome {
    unit: string
    body: string
    count: number
    minTop: number
    geotechBodies: Set<string>
  }
  const homeByKey = new Map<string, LithoHome>()
  for (const l of acceptedById.values()) {
    if (l.formation_id !== winner) continue
    const parent =
      l.parent_litho_layer_id === null ? undefined : lithoById.get(l.parent_litho_layer_id)
    if (!parent || parent.body_id === null) continue
    const homeUnit = bodyHomeById.get(parent.body_id) ?? parent.formation_id
    const key = `${homeUnit}|${parent.body_id}`
    const home = homeByKey.get(key) ?? {
      unit: homeUnit,
      body: parent.body_id,
      count: 0,
      minTop: Infinity,
      geotechBodies: new Set<string>(),
    }
    home.count += 1
    home.minTop = Math.min(home.minTop, parent.depth_top ?? Infinity)
    if (l.body_id !== null) home.geotechBodies.add(l.body_id)
    homeByKey.set(key, home)
  }
  if (homeByKey.size === 0) {
    throw new Error(
      'resolveFenceTargetUnit: no accepted band of the target unit carries ' +
        'parent_litho_layer_id — reseed the fixture on a backend at migration ' +
        'c9d0e1f2a3b4 or later (the parent-band FK).',
    )
  }
  const home = [...homeByKey.values()].sort(
    (x, y) => y.count - x.count || x.minTop - y.minTop,
  )[0]

  const nadClass = formationById.get(winner)?.nad_class
  if (nadClass === null || nadClass === undefined) {
    throw new Error(
      'resolveFenceTargetUnit: the target unit has no nad_class — its class row cannot be addressed',
    )
  }

  // Level-2 siblings: litho bodies homed to the target's litho unit.
  const lithoBodiesOfUnit = new Set<string>()
  for (const l of lithoLayers) {
    if (l.body_id === null) continue
    const homeUnit = bodyHomeById.get(l.body_id) ?? l.formation_id
    if (homeUnit === home.unit) lithoBodiesOfUnit.add(l.body_id)
  }

  // Level-3 siblings: distinct NAD classes among EVERY accepted geotech band
  // whose covering litho band sits in this litho body — other units' bands
  // included, because they are this body's sibling class rows.
  const classesInLithoBody = new Set<number>()
  for (const l of acceptedById.values()) {
    const parent =
      l.parent_litho_layer_id === null ? undefined : lithoById.get(l.parent_litho_layer_id)
    if (!parent || parent.body_id !== home.body) continue
    const cls = formationById.get(l.formation_id)?.nad_class
    if (cls !== null && cls !== undefined) classesInLithoBody.add(cls)
  }

  // Leaf-absorb, bottom-up: a single LEAF child collapses into its parent.
  const classIsLeaf = home.geotechBodies.size <= 1
  const lithoBodyIsLeaf = classesInLithoBody.size <= 1 && classIsLeaf
  const unitIsLeaf = lithoBodiesOfUnit.size <= 1 && lithoBodyIsLeaf
  const deepestKind = unitIsLeaf
    ? ('litho-unit' as const)
    : lithoBodyIsLeaf
      ? ('litho-body' as const)
      : ('geotech-class' as const)

  return {
    geotechModelId: geotech.id,
    unitId: winner,
    bodyCount: bodiesByUnit.get(winner)?.size ?? 0,
    approvedEdgeCount: edgeCountByUnit.get(winner) ?? 0,
    lithoUnitId: home.unit,
    lithoBodyId: home.body,
    nadClass,
    classBodyCount: home.geotechBodies.size,
    lithoBodyCount: lithoBodiesOfUnit.size,
    classCount: classesInLithoBody.size,
    deepestKind,
  }
}
