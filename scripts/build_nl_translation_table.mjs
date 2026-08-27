// Build the EN→NL terminology review page from the locale files.
//
//   node scripts/build_nl_translation_table.mjs
//   → blend_viewer/nl_translation_table.html
//
// The page is GENERATED, never hand-written. Two things follow from that:
//
//   * The table cannot disagree with the app. Strings come from importing the
//     real modules (bundled with esbuild, so the TS + the module graph resolve
//     exactly as the renderer sees them), not from re-typing them here.
//   * A ``// FLAG alt: a | b — why`` comment in a locale file is the ONLY way a
//     row gets flagged. Flagging is therefore a source-code act with a diff,
//     not a decision that lives in a document nobody updates.
//
// Rows the owner most needs are surfaced first: the flagged terms get their own
// section at the top, and the filter defaults to showing everything.

import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const I18N = join(REPO, 'desktop/src/renderer/src/i18n')
const OUT = join(REPO, 'blend_viewer/nl_translation_table.html')

// esbuild is a desktop/ devDependency and the repo root has no node_modules, so
// resolve it from desktop/package.json rather than from this file's directory.
const require = createRequire(pathToFileURL(join(REPO, 'desktop/package.json')))
const { build } = require('esbuild')

// ---------------------------------------------------------------------------
// 1. Load the catalogues by bundling them, so the values are the real ones.
// ---------------------------------------------------------------------------

const entry = join(HERE, '.i18n-dump-entry.mjs')
const bundle = join(HERE, '.i18n-dump-bundle.mjs')

writeFileSync(
  entry,
  [
    `export { EN, EN_MODULES } from ${JSON.stringify(join(I18N, 'locales/en/index.ts'))}`,
    `export { NL, NL_MODULES } from ${JSON.stringify(join(I18N, 'locales/nl/index.ts'))}`,
  ].join('\n'),
)

await build({
  entryPoints: [entry],
  outfile: bundle,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'warning',
})

const { EN, EN_MODULES, NL } = await import(pathToFileURL(bundle).href)

// ---------------------------------------------------------------------------
// 2. Read the FLAG / NOTE annotations straight out of the NL sources.
//
// A comment block directly above a key annotates that key. Blank lines and
// other keys break the association, so a stale comment cannot silently attach
// itself to whatever key was added below it.
// ---------------------------------------------------------------------------

/** @type {Map<string, {flag: string|null, alts: string[], note: string|null}>} */
const annotations = new Map()

for (const file of readdirSync(join(I18N, 'locales/nl'))) {
  if (!file.endsWith('.ts') || file === 'index.ts') continue
  const lines = readFileSync(join(I18N, 'locales/nl', file), 'utf8').split('\n')

  /** @type {string[]} */
  let pending = []
  for (const raw of lines) {
    const line = raw.trim()
    const comment = line.match(/^\/\/ ?(.*)$/)
    if (comment) {
      pending.push(comment[1])
      continue
    }
    const keyMatch = line.match(/^'([^']+)':/)
    if (keyMatch) {
      const text = pending.join(' ').trim()
      const flagMatch = text.match(/FLAG(?:\s+alt:\s*([^—]*))?—?\s*(.*)$/)
      const noteMatch = text.match(/^NOTE:?\s*(.*)$/)
      annotations.set(keyMatch[1], {
        flag: flagMatch ? (flagMatch[2] || '').trim() || null : null,
        alts: flagMatch && flagMatch[1] ? flagMatch[1].split('|').map(s => s.trim()).filter(Boolean) : [],
        note: noteMatch ? noteMatch[1].trim() : null,
      })
      pending = []
      continue
    }
    // Any non-comment, non-key line (a blank line, a section banner's blank
    // separator, a closing brace) drops the pending block.
    if (line === '' || line === '} as const' || line.startsWith('export ')) pending = []
  }
}

// ---------------------------------------------------------------------------
// 3. Group the rows by surface, using the EN module a key belongs to.
// ---------------------------------------------------------------------------

const SURFACE_TITLES = {
  chrome: 'Shell chrome — shared verbs, boot states, project launcher + metadata, stage rail',
  data: 'Data stage — import verbs, map/chart canvas  ★ WIRED',
  settings: 'Settings dialog  ★ WIRED',
  models: 'Model stages — geological, lithostratigraphic, geotechnical',
  sections: 'Sections stage — canvas, toolbar, inspector, header, menus, overlays',
  outputs: 'Parameters + Export stages',
  panels: 'Shared panels + dialogs — map, borelog, lab, elevation, composition, confirms, cheatsheet',
}

const groups = []
for (const [moduleName, table] of Object.entries(EN_MODULES)) {
  const rows = Object.keys(table).map(key => {
    const a = annotations.get(key) ?? { flag: null, alts: [], note: null }
    return {
      key,
      en: EN[key],
      nl: NL[key] ?? null,
      flag: a.flag,
      alts: a.alts,
      note: a.note,
    }
  })
  groups.push({ id: moduleName, title: SURFACE_TITLES[moduleName] ?? moduleName, rows })
}

const flagged = groups.flatMap(g => g.rows.filter(r => r.flag !== null || r.alts.length > 0))
const totalKeys = Object.keys(EN).length
const translated = groups.flatMap(g => g.rows).filter(r => r.nl !== null).length

// ---------------------------------------------------------------------------
// 4. Domain canon — the vocabulary that is deliberately NOT in the catalogues.
// ---------------------------------------------------------------------------

const DOMAIN_CANON = [
  {
    what: 'NAD packing classes 1–31',
    where: 'src/groundmodel/shared/constants/litho_constants.py → NAD_CLASSES',
    already: 'Dutch at source — "ZAND, los gp", "KLEI, matig vast", "SILT, zandhoudend, vrij vast"…',
    nlPlan: 'Rendered verbatim in every language. Nothing to translate, nothing to decide.',
  },
  {
    what: 'Base lithology labels (Sand / Clay / Silt / Gravel / Peat)',
    where: 'desktop/src/renderer/src/utils/lithoConstants.ts → LITHOLOGY_LABELS',
    already: 'The DB token IS the Dutch word: ZAND / KLEI / SILT / GRIND / VEEN.',
    nlPlan: 'In NL the presentation boundary should render the TOKEN (title-cased), not a translation — a one-line change in the lookup, not a catalogue entry.',
  },
  {
    what: 'DOV soil-type codes (hoofdnaam, 108 codes)',
    where: 'desktop/src/renderer/src/utils/soilColors.ts → SoilStyle.source',
    already: 'Every entry already carries the Dutch source string alongside its English label.',
    nlPlan: 'NL selects `source` instead of `label`. Zero new translation.',
  },
  {
    what: 'Admixtures (bijmenging) + amount codes',
    where: 'desktop/src/renderer/src/utils/lithoLabels.ts',
    already: 'GL / KL / SL / ZN / VE and W / M / V / S / Z are DOV vocabulary — Dutch by definition.',
    nlPlan: 'NL emits the Dutch adjective form directly; the English adjective table is the translation, not the other way round.',
  },
  {
    what: 'Lab-test parameters + USCS/ASTM codes',
    where: 'desktop/src/renderer/src/utils/labTestLabels.ts',
    already: 'Keys are the verbatim DOV parameter strings ("Consistentiegrenzen - Vloeigrens").',
    nlPlan: 'NL shows the DOV key; ASTM/USCS class codes stay English (they are a US standard).',
  },
]

// ---------------------------------------------------------------------------
// 5. Render.
// ---------------------------------------------------------------------------

const esc = s =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function rowHtml(r) {
  const isFlagged = r.flag !== null || r.alts.length > 0
  const alts = r.alts.length
    ? `<div class="alts">${r.alts.map(a => `<span class="alt">${esc(a)}</span>`).join('')}</div>`
    : ''
  const why = r.flag ? `<div class="why">${esc(r.flag)}</div>` : ''
  const note = r.note ? `<div class="note">${esc(r.note)}</div>` : ''
  return `<tr class="${isFlagged ? 'flagged' : ''}" data-flagged="${isFlagged}">
  <td class="k"><code>${esc(r.key)}</code></td>
  <td class="en">${esc(r.en)}</td>
  <td class="nl">${r.nl === null ? '<em class="missing">— not translated —</em>' : esc(r.nl)}</td>
  <td class="f">${isFlagged ? '<span class="badge">FLAG</span>' : ''}${alts}</td>
  <td class="n">${why}${note}</td>
</tr>`
}

const html = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>StrixGeo — EN→NL translation review</title>
<style>
  :root {
    --bg: #0f1115; --panel: #161a21; --panel2: #1b2029; --line: #262d39;
    --fg: #e6e9ef; --dim: #9aa4b2; --accent: #6ea8fe; --flag: #f0b429;
    --flagbg: #2a2110; --miss: #f87171; --code: #7ee787;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg);
         font: 14px/1.5 -apple-system, "Segoe UI", Roboto, sans-serif; }
  header { padding: 28px 32px 20px; border-bottom: 1px solid var(--line); background: var(--panel); }
  h1 { margin: 0 0 6px; font-size: 20px; font-weight: 650; }
  .sub { color: var(--dim); font-size: 13px; max-width: 90ch; }
  .stats { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 16px; }
  .stat { background: var(--panel2); border: 1px solid var(--line); border-radius: 8px;
          padding: 8px 14px; }
  .stat b { display: block; font-size: 19px; font-weight: 650; }
  .stat span { color: var(--dim); font-size: 11px; text-transform: uppercase;
               letter-spacing: .06em; }
  .controls { position: sticky; top: 0; z-index: 5; display: flex; gap: 10px;
              align-items: center; flex-wrap: wrap;
              padding: 12px 32px; background: var(--panel); border-bottom: 1px solid var(--line); }
  input[type=search] { flex: 1; min-width: 220px; background: var(--bg); color: var(--fg);
                       border: 1px solid var(--line); border-radius: 7px; padding: 7px 11px;
                       font-size: 13px; }
  input[type=search]:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  label.toggle { display: inline-flex; align-items: center; gap: 7px; color: var(--dim);
                 font-size: 13px; cursor: pointer; user-select: none; }
  main { padding: 0 32px 80px; }
  section { margin-top: 34px; }
  h2 { font-size: 14px; font-weight: 650; margin: 0 0 4px; }
  h2 .count { color: var(--dim); font-weight: 400; }
  .lead { color: var(--dim); font-size: 12.5px; margin: 0 0 12px; max-width: 95ch; }
  .scroll { overflow-x: auto; border: 1px solid var(--line); border-radius: 9px; }
  table { border-collapse: collapse; width: 100%; min-width: 900px; }
  /* NOT sticky: the .scroll wrapper sets overflow-x, which makes it the
     containing scrollport for position:sticky. A sticky th would then offset
     itself from the TABLE's top rather than the viewport's and permanently
     occlude the first data row. */
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .06em;
       color: var(--dim); font-weight: 600; padding: 9px 12px;
       background: var(--panel2); border-bottom: 1px solid var(--line); }
  td { padding: 9px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  tr.flagged { background: var(--flagbg); }
  tr:hover td { background: #1d222c; }
  tr.flagged:hover td { background: #332810; }
  code { color: var(--code); font: 12px/1.4 ui-monospace, Consolas, monospace;
         word-break: break-all; }
  td.k { width: 21%; }
  td.en { width: 27%; }
  td.nl { width: 27%; }
  td.f  { width: 11%; }
  td.n  { width: 14%; }
  .badge { display: inline-block; background: var(--flag); color: #1b1405; font-size: 10px;
           font-weight: 700; letter-spacing: .05em; padding: 1px 6px; border-radius: 4px; }
  .alts { margin-top: 5px; display: flex; flex-direction: column; gap: 3px; }
  .alt { color: var(--fg); font-size: 12px; background: #232934; border: 1px solid var(--line);
         border-radius: 4px; padding: 2px 6px; }
  .why, .note { color: var(--dim); font-size: 12px; }
  .note { font-style: italic; }
  .missing { color: var(--miss); font-style: italic; }
  .canon td { font-size: 13px; }
  .canon .what { font-weight: 600; width: 22%; }
  .canon code { display: block; margin-top: 3px; }
  .empty { padding: 22px; color: var(--dim); text-align: center; display: none; }
  @media (prefers-color-scheme: light) {
    :root { --bg:#fbfbfd; --panel:#fff; --panel2:#f2f4f8; --line:#dfe3ea; --fg:#1b2029;
            --dim:#5b6472; --accent:#0b62d6; --flagbg:#fff6e0; --code:#0a6b3d; --miss:#b91c1c; }
    tr:hover td { background: #eef1f6; }
    tr.flagged:hover td { background: #fdeec6; }
    .alt { background: #fff; }
  }
</style>

<header>
  <h1>StrixGeo — English → Dutch (BE) translation review</h1>
  <p class="sub">
    Generated from the locale files, so this page and the app cannot disagree.
    <b>The ${flagged.length} FLAGGED rows are the ones that need your ruling</b> — those are
    the judgement calls (band, tie, fence, build, packing, snap, sondering-vs-CPT).
    Everything else is a lookup and can be skimmed. Approving a row here approves the
    string in <code>desktop/src/renderer/src/i18n/locales/nl/</code>.
  </p>
  <div class="stats">
    <div class="stat"><b>${totalKeys}</b><span>keys catalogued</span></div>
    <div class="stat"><b>${translated}</b><span>translated to NL</span></div>
    <div class="stat"><b>${flagged.length}</b><span>need a ruling</span></div>
    <div class="stat"><b>2</b><span>surfaces wired live</span></div>
  </div>
</header>

<div class="controls">
  <input type="search" id="q" placeholder="Filter by key, English, or Dutch…" autocomplete="off">
  <label class="toggle"><input type="checkbox" id="only"> Flagged only</label>
  <span class="sub" id="shown"></span>
</div>

<main>
  <section>
    <h2>⚑ Terms that need your ruling <span class="count">(${flagged.length})</span></h2>
    <p class="lead">
      Each row is my best Flemish choice plus the alternatives I weighed. These repeat across
      the whole app, so one ruling here propagates to every screen. They are listed again in
      their own surface below.
    </p>
    <div class="scroll">
      <table>
        <thead><tr><th>Key</th><th>English</th><th>Dutch (proposed)</th><th>Alternatives</th><th>Why it is a judgement call</th></tr></thead>
        <tbody>${flagged.map(rowHtml).join('\n')}</tbody>
      </table>
    </div>
  </section>

  <section>
    <h2>Domain canon — already Dutch-backed, deliberately NOT translated here</h2>
    <p class="lead">
      Soil names, NAD packing classes and DOV codes already have a Dutch canonical source.
      Routing them through the UI translation layer would create two spellings of one term and
      break the rule that the domain stores the raw upstream token (docs/ux.md). In Dutch these
      surfaces render by <em>selecting the source token</em>, not by translating it.
    </p>
    <div class="scroll">
      <table class="canon">
        <thead><tr><th>Vocabulary &amp; canonical source</th><th>Status today</th><th>What NL mode does</th></tr></thead>
        <tbody>
${DOMAIN_CANON.map(
  d => `          <tr><td class="what">${esc(d.what)}<code>${esc(d.where)}</code></td>
            <td>${esc(d.already)}</td><td>${esc(d.nlPlan)}</td></tr>`,
).join('\n')}
        </tbody>
      </table>
    </div>
  </section>

${groups
  .map(
    g => `  <section data-surface="${g.id}">
    <h2>${esc(g.title)} <span class="count">(${g.rows.length})</span></h2>
    <div class="scroll">
      <table>
        <thead><tr><th>Key</th><th>English</th><th>Dutch (BE)</th><th>Flag / alternatives</th><th>Notes</th></tr></thead>
        <tbody>
${g.rows.map(rowHtml).join('\n')}
        </tbody>
      </table>
    </div>
  </section>`,
  )
  .join('\n')}
  <div class="empty" id="empty">No rows match that filter.</div>
</main>

<script>
  const q = document.getElementById('q')
  const only = document.getElementById('only')
  const shown = document.getElementById('shown')
  const rows = [...document.querySelectorAll('tbody tr')]
  const sections = [...document.querySelectorAll('section')]

  function apply() {
    const needle = q.value.trim().toLowerCase()
    const flaggedOnly = only.checked
    let visible = 0
    for (const row of rows) {
      const isFlagged = row.dataset.flagged === 'true'
      const hit = needle === '' || row.textContent.toLowerCase().includes(needle)
      const show = hit && (!flaggedOnly || isFlagged)
      row.style.display = show ? '' : 'none'
      if (show) visible++
    }
    for (const s of sections) {
      const any = [...s.querySelectorAll('tbody tr')].some(r => r.style.display !== 'none')
      // The domain-canon section has no data rows to filter; always keep it.
      s.style.display = s.querySelector('table.canon') || any ? '' : 'none'
    }
    shown.textContent = visible + ' row' + (visible === 1 ? '' : 's') + ' shown'
    document.getElementById('empty').style.display = visible === 0 ? 'block' : 'none'
  }
  q.addEventListener('input', apply)
  only.addEventListener('change', apply)
  apply()
</script>
`

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, html)
rmSync(entry, { force: true })
rmSync(bundle, { force: true })

console.log(`wrote ${OUT}`)
console.log(`  ${totalKeys} keys, ${translated} translated, ${flagged.length} flagged`)
console.log(`  surfaces: ${groups.map(g => `${g.id}=${g.rows.length}`).join(' ')}`)
