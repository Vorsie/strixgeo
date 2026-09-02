// Render a message template with ONE ``{slot}`` replaced by a React node.
//
// ``t('key', { name })`` flattens an interpolated value into plain text, which
// is right for a toast or an attribute — but a dialog TITLE emphasises the name
// with a ``<span className="font-bold">``. A pre/post key pair would restore the
// emphasis yet break for a locale that places the name mid-sentence (Dutch:
// "Contact bij {name} verwijderen?"). Splitting the resolved template on the
// literal ``{slot}`` marker keeps the emphasis AND the per-locale word order.
//
// Call with the UN-interpolated template — ``t('key')`` (no params) returns the
// message with the ``{slot}`` marker intact, which this function then splits.

import { Fragment, type ReactNode } from 'react'

/**
 * Render a template around a single ``{slot}`` replaced by a node.
 *
 * Parameters
 * ----------
 * template : string
 *     The resolved message, e.g. ``"Delete contact at {name}?"``. Pass the
 *     result of ``t('key')`` WITHOUT params so the marker survives.
 * slot : string
 *     The placeholder name to replace, without braces, e.g. ``"name"``.
 * node : ReactNode
 *     What to render in the marker's place (typically a styled ``<span>``).
 *
 * Returns
 * -------
 * ReactNode
 *     The literal text before the marker, then ``node``, then the text after.
 *     If the marker is absent, the template is returned unchanged.
 */
export function interpolateSlot(template: string, slot: string, node: ReactNode): ReactNode {
  const marker = `{${slot}}`
  const at = template.indexOf(marker)
  if (at === -1) return template
  return (
    <Fragment>
      {template.slice(0, at)}
      {node}
      {template.slice(at + marker.length)}
    </Fragment>
  )
}
