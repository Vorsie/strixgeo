// find_untranslated.mjs — the i18n coverage gate for the renderer.
//
// PURPOSE
// -------
// Find every user-facing English string in the renderer that reaches the DOM
// or a toast WITHOUT going through the message catalogue (``t()`` / ``useT()``
// / ``translate()``). Run it, drive it to zero, and the app in Dutch mode
// shows no stray English on the surfaces it covers.
//
//   node scripts/find_untranslated.mjs            # human report, exits 1 on findings
//   node scripts/find_untranslated.mjs --json     # machine-readable JSON
//
// It parses each file with the TypeScript compiler (the same one ``tsc`` uses)
// and inspects the JSX/AST rather than grepping lines, so a ``className`` or a
// ``t('key')`` argument is never mistaken for display copy.
//
// WHAT IT FLAGS (display positions only)
// --------------------------------------
//   1. JSX text nodes with real words        <span>Save</span>
//   2. A curated set of user-facing JSX       title=, placeholder=, alt=,
//      string attributes                      aria-label=, aria-description=,
//                                             aria-roledescription=,
//                                             aria-valuetext=, aria-placeholder=,
//                                             label=
//   3. The message argument of a toast        toast('success', 'Saved')
//   4. Display-position string/template       {cond ? 'Yes' : 'No'},
//      literals inside the above              {n + ' items'}, {flag && 'On'}
//
// It descends into an expression ONLY through the branches that PRODUCE the
// rendered value — a conditional's two results, a logical/nullish right-hand
// side, a ``+`` concatenation, a parenthesis. It never descends into a
// condition, a comparison, or an arbitrary function call's arguments, so a
// ``status === 'done'`` operand is not mistaken for copy.
//
// WHAT IT NEVER FLAGS (the documented exclusion list)
// ---------------------------------------------------
//   * Files under excluded directories:
//       - components/onboarding, components/licensing, components/updater
//         (prototypes with their own ``launch`` catalogue — out of this slice)
//       - i18n/ itself (the catalogues ARE the translations)
//       - any *.test.tsx / *.test.ts / *.spec.* / __mocks__ / e2e test dirs
//   * Any string that is the argument of t() / useT()-result / translate() —
//     structurally impossible to reach in a display position, but calls to
//     ``t`` / ``translate`` / ``log.*`` / ``console.*`` are never descended
//     into regardless.
//   * className / class / id / key / role / type / name / href / src /
//     data-testid / SVG geometry / aria-*by references — never in the
//     attribute allow-list, so never flagged.
//   * Log + console output — not a display position; toast is the only
//     programmatic sink that is scanned.
//   * Domain-canon tokens (soil names, NAD packing classes, lithology labels,
//     lab-test labels) — these render by SELECTING a Dutch source token, not
//     through the catalogue (see i18n/locales/en/index.ts). They reach the DOM
//     through lookup calls, not literals, so they do not appear as findings;
//     the few that surface as bare literals carry an inline exemption.
//   * Unit + symbol tokens (MPa, kN/m³, m TAW, %, °, numeric-only) — identical
//     across locales; skipped by SYMBOL_ONLY.
//   * Any literal with an inline ``i18n-exempt`` marker (see below).
//
// INLINE EXEMPTION
// ----------------
// A string that is deliberately left English carries, on its own line or the
// line directly above it, a comment:
//
//     // i18n-exempt: <reason>            or    {/* i18n-exempt: <reason> */}
//
// The reason is mandatory by convention (the finder does not parse it, code
// review does). Use it for developer-only chrome and symbol/format literals the
// SYMBOL_ONLY heuristic does not catch — never to silence a real translation.
//
// This script is a manual gate. It is deliberately NOT wired into any git hook
// or CI in this slice.

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RENDERER_ROOT = path.resolve(__dirname, '..', 'src', 'renderer', 'src')

// --- Exclusion config -------------------------------------------------------

/** Directory prefixes (relative to the renderer root, POSIX slashes) whose
 *  files are skipped entirely. */
const EXCLUDED_DIR_PREFIXES = [
  'components/onboarding/',
  'components/licensing/',
  'components/updater/',
  'i18n/',
]

/** A file is skipped if its basename matches any of these (tests, mocks). */
const EXCLUDED_FILE_PATTERNS = [/\.test\.[cm]?tsx?$/, /\.spec\.[cm]?tsx?$/, /\.d\.ts$/]

/** A path segment that marks a whole subtree as test/mocks scaffolding. */
const EXCLUDED_PATH_SEGMENTS = ['/__mocks__/', '/__tests__/', '/e2e/']

/** JSX attribute names (lower-cased) whose STRING value renders to the user.
 *  An allow-list, not a deny-list: an attribute not named here is never a
 *  finding, which is why className / id / data-testid / SVG geometry are safe. */
const USER_FACING_ATTRS = new Set([
  'title',
  'placeholder',
  'alt',
  'label',
  'aria-label',
  'aria-description',
  'aria-roledescription',
  'aria-valuetext',
  'aria-placeholder',
])

/** Callee names whose arguments are NEVER descended into: they are either the
 *  translator itself (already routed) or a logging sink (not a display). */
const OPAQUE_CALLEES = new Set(['t', 'translate', 'useT'])
const OPAQUE_CALLEE_OBJECTS = new Set(['log', 'console'])

/** The toast action — its second argument is the user-facing message. */
const TOAST_CALLEE = 'toast'

// --- Content heuristics -----------------------------------------------------

/** A collected string is a finding only if it carries real words. Two adjacent
 *  letters is the floor: "or", "OK", "No" count; "m", "×", "3D" (one letter)
 *  do not. */
function hasWords(text) {
  return /[A-Za-z]{2,}/.test(text)
}

/** Unit / symbol / format tokens that are identical in every locale and must
 *  not be translated. Skips strings that, once digits / whitespace / the
 *  symbol charset are stripped, are composed only of known unit + datum
 *  abbreviations. Keeps natural-language copy (which leaves a real word behind). */
const UNIT_WORDS = new Set([
  'mpa',
  'kpa',
  'kn',
  'm',
  'mm',
  'cm',
  'km',
  'taw',
  'nap',
  'ma',
  'kg',
  'deg',
])
function isSymbolOnly(text) {
  const trimmed = text.trim()
  if (trimmed.length === 0) return true
  if (!hasWords(trimmed)) return true
  // Strip digits, whitespace and the symbol/punctuation charset used by units.
  const wordChunks = trimmed
    .replace(/[0-9\s.,:;/%×·°±–—\-()[\]²³<>=+]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  if (wordChunks.length === 0) return true
  return wordChunks.every(chunk => UNIT_WORDS.has(chunk.toLowerCase()))
}

/** URL / asset-path literals are never display copy. */
function isUrlOrPath(text) {
  return /^(https?:\/\/|mailto:|data:|\/[a-z]|\.\/|\.\.\/)/.test(text.trim())
}

function isFinding(text) {
  if (!hasWords(text)) return false
  if (isSymbolOnly(text)) return false
  if (isUrlOrPath(text)) return false
  return true
}

// --- Inline exemption -------------------------------------------------------

/** True when the line of ``pos`` (or the line directly above it) carries an
 *  ``i18n-exempt`` marker. */
function isExempt(sourceFile, pos, exemptLines) {
  const { line } = sourceFile.getLineAndCharacterOfPosition(pos)
  return exemptLines.has(line) || exemptLines.has(line - 1)
}

/** Collect the 0-based line numbers that carry an ``i18n-exempt`` marker. */
function collectExemptLines(text) {
  const lines = text.split(/\r?\n/)
  const exempt = new Set()
  lines.forEach((content, index) => {
    if (content.includes('i18n-exempt')) exempt.add(index)
  })
  return exempt
}

// --- AST walk ---------------------------------------------------------------

/** Extract display-position string literals from an expression, following only
 *  value-producing branches. Pushes {text, pos} onto ``out``. */
function extractDisplayStrings(node, out) {
  if (node === undefined) return

  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    out.push({ text: node.text, pos: node.getStart() })
    return
  }
  if (ts.isTemplateExpression(node)) {
    // The literal chunks around the ${} slots are the display copy.
    const head = node.head.text
    if (head.length > 0) out.push({ text: head, pos: node.head.getStart() })
    for (const span of node.templateSpans) {
      const chunk = span.literal.text
      if (chunk.length > 0) out.push({ text: chunk, pos: span.literal.getStart() })
    }
    return
  }
  if (ts.isParenthesizedExpression(node)) {
    extractDisplayStrings(node.expression, out)
    return
  }
  if (ts.isConditionalExpression(node)) {
    // The two RESULTS render; the condition does not.
    extractDisplayStrings(node.whenTrue, out)
    extractDisplayStrings(node.whenFalse, out)
    return
  }
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind
    if (op === ts.SyntaxKind.PlusToken) {
      // String concatenation — both sides build the display string.
      extractDisplayStrings(node.left, out)
      extractDisplayStrings(node.right, out)
    } else if (
      op === ts.SyntaxKind.AmpersandAmpersandToken ||
      op === ts.SyntaxKind.BarBarToken ||
      op === ts.SyntaxKind.QuestionQuestionToken
    ) {
      // ``cond && 'text'`` / ``value ?? 'fallback'`` — the right side renders.
      extractDisplayStrings(node.right, out)
    }
    // Any other operator (===, !==, <, …) is a test, not a value: skip.
    return
  }
  // Identifiers, property accesses, calls, arrays, objects: not a literal
  // display value we can attribute. Stop — descending risks comparison-string
  // false positives.
}

/** Is this call one whose arguments must never be scanned (translator / log)? */
function isOpaqueCall(node) {
  const callee = node.expression
  if (ts.isIdentifier(callee)) return OPAQUE_CALLEES.has(callee.text)
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
    return OPAQUE_CALLEE_OBJECTS.has(callee.expression.text)
  }
  return false
}

function isToastCall(node) {
  return ts.isIdentifier(node.expression) && node.expression.text === TOAST_CALLEE
}

function scanFile(absPath, relPath, findings) {
  const text = fs.readFileSync(absPath, 'utf8')
  const sourceFile = ts.createSourceFile(absPath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const exemptLines = collectExemptLines(text)

  const record = (item, surface) => {
    if (!isFinding(item.text)) return
    if (isExempt(sourceFile, item.pos, exemptLines)) return
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(item.pos)
    findings.push({
      path: relPath,
      line: line + 1,
      col: character + 1,
      surface,
      text: item.text,
    })
  }

  const visit = node => {
    // 1. JSX text nodes.
    if (ts.isJsxText(node)) {
      const raw = node.text.replace(/\s+/g, ' ').trim()
      if (raw.length > 0) record({ text: raw, pos: node.getStart() }, 'jsx-text')
    }

    // 2. User-facing JSX string attributes (and expression-valued ones).
    if (ts.isJsxAttribute(node) && node.name) {
      const attrName = (node.name.escapedText ?? node.name.getText()).toString().toLowerCase()
      if (USER_FACING_ATTRS.has(attrName) && node.initializer) {
        if (ts.isStringLiteral(node.initializer)) {
          record({ text: node.initializer.text, pos: node.initializer.getStart() }, `attr:${attrName}`)
        } else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
          const out = []
          extractDisplayStrings(node.initializer.expression, out)
          out.forEach(item => record(item, `attr:${attrName}`))
        }
      }
    }

    // 3. JSX expression container as a CHILD — {cond ? 'a' : 'b'}, {n + ' x'}.
    if (ts.isJsxExpression(node) && node.expression && node.parent && isJsxChildContext(node)) {
      const out = []
      extractDisplayStrings(node.expression, out)
      out.forEach(item => record(item, 'jsx-expr'))
    }

    // 4. toast('type', <message>) — the message argument.
    if (ts.isCallExpression(node) && isToastCall(node) && node.arguments.length >= 2) {
      const out = []
      extractDisplayStrings(node.arguments[1], out)
      out.forEach(item => record(item, 'toast'))
    }

    // Do not descend into translator / log / console call arguments.
    if (ts.isCallExpression(node) && isOpaqueCall(node)) return

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
}

/** A JsxExpression is a child (not an attribute value) when its parent is a JSX
 *  element/fragment, not a JSX attribute. */
function isJsxChildContext(node) {
  const parent = node.parent
  return (
    parent &&
    (ts.isJsxElement(parent) || ts.isJsxFragment(parent))
  )
}

// --- File discovery ---------------------------------------------------------

function toPosix(p) {
  return p.split(path.sep).join('/')
}

function isExcluded(relPosix) {
  const base = relPosix.split('/').pop()
  if (EXCLUDED_FILE_PATTERNS.some(rx => rx.test(base))) return true
  if (EXCLUDED_PATH_SEGMENTS.some(seg => `/${relPosix}`.includes(seg))) return true
  if (EXCLUDED_DIR_PREFIXES.some(prefix => relPosix.startsWith(prefix))) return true
  return false
}

function walk(dir, acc) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue
      walk(full, acc)
    } else if (/\.tsx?$/.test(entry.name)) {
      acc.push(full)
    }
  }
}

function main() {
  const jsonMode = process.argv.includes('--json')
  // ``--only <substr> …`` restricts the report to paths containing any of the
  // given substrings — lets one worker verify just the files it owns without
  // touching the exclusion config. No effect on the authoritative full run.
  const onlyIndex = process.argv.indexOf('--only')
  const onlyFilters =
    onlyIndex === -1 ? [] : process.argv.slice(onlyIndex + 1).filter(a => !a.startsWith('--'))

  const files = []
  walk(RENDERER_ROOT, files)

  const findings = []
  for (const abs of files.sort()) {
    const relPosix = toPosix(path.relative(RENDERER_ROOT, abs))
    if (isExcluded(relPosix)) continue
    if (onlyFilters.length > 0 && !onlyFilters.some(sub => relPosix.includes(sub))) continue
    try {
      scanFile(abs, relPosix, findings)
    } catch (err) {
      process.stderr.write(`! failed to scan ${relPosix}: ${err.message}\n`)
    }
  }

  findings.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.col - b.col)

  if (jsonMode) {
    process.stdout.write(JSON.stringify(findings, null, 2) + '\n')
  } else {
    for (const f of findings) {
      process.stdout.write(`${f.path}:${f.line}:${f.col}  [${f.surface}]  ${JSON.stringify(f.text)}\n`)
    }
    const byFile = new Map()
    for (const f of findings) byFile.set(f.path, (byFile.get(f.path) ?? 0) + 1)
    process.stdout.write(`\n${findings.length} finding(s) across ${byFile.size} file(s).\n`)
  }

  process.exit(findings.length === 0 ? 0 : 1)
}

main()
