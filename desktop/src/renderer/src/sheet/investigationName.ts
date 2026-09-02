/**
 * Short code + project key from an investigation name (spec "Codes, colours,
 * legend"). DOV names are ``<opdracht>-<code>`` (``GEO-16/095-S7``); the
 * opdracht is what the owner calls "the geo identifier" and it is the colour
 * key on the map. A name without a dash has no project and is its own code.
 */
export interface SplitName {
  projectKey: string
  code: string
}

export function splitInvestigationName(rawName: string): SplitName {
  const name = rawName.trim()
  const tokens = name.split('-').map(t => t.trim())
  if (tokens.length === 1) return { projectKey: '', code: name }
  let code = tokens[tokens.length - 1]
  let head = tokens.slice(0, -1)
  // ``B-4`` / ``…-S-12``: a bare number after a single letter keeps the letter.
  if (/^\d+$/.test(code) && head.length > 0 && /^[A-Za-z]$/.test(head[head.length - 1])) {
    code = head[head.length - 1] + code
    head = head.slice(0, -1)
  }
  const projectKey = head.join('-')
  if (code === '') return { projectKey, code: projectKey || name }
  return { projectKey, code }
}
