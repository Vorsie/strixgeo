// Rule: a backend refusal an engineer can hit in normal use shows in the app's
// language, not as the server's English sentence; unknown codes keep the server text.
import { describe, expect, it } from 'vitest'

import { messageForApiCode, messageForDetail } from './apiCodeMessages'

describe('messageForApiCode', () => {
  it('translates the four new backend codes in English', () => {
    expect(messageForApiCode('dov_import_too_large', 'en')).toMatch(/smaller/i)
    expect(messageForApiCode('dov_import_already_running', 'en')).toMatch(/already running/i)
    expect(messageForApiCode('body_partition_locked', 'en')).toMatch(/still running/i)
    expect(messageForApiCode('lock_timeout', 'en')).toMatch(/busy/i)
  })

  it('translates them in Dutch', () => {
    expect(messageForApiCode('dov_import_too_large', 'nl')).toMatch(/kleiner/i)
    expect(messageForApiCode('dov_import_already_running', 'nl')).toMatch(/loopt al/i)
    expect(messageForApiCode('body_partition_locked', 'nl')).toMatch(/loopt nog/i)
    expect(messageForApiCode('lock_timeout', 'nl')).toMatch(/bezet/i)
  })

  it('leaves unknown or missing codes to the server text', () => {
    expect(messageForApiCode('cpt_refresh_refused')).toBeNull()
    expect(messageForApiCode(undefined)).toBeNull()
    expect(messageForDetail({ code: 'something_else', message: 'server says' }, 'fallback')).toBe('server says')
    expect(messageForDetail('plain text', 'fallback')).toBe('plain text')
    expect(messageForDetail(undefined, 'fallback')).toBe('fallback')
  })

  it('prefers the translated text over the server message for a known code', () => {
    expect(messageForDetail({ code: 'lock_timeout', message: 'canceling statement' }, 'x', 'nl')).toMatch(/bezet/i)
  })
})

// ---------------------------------------------------------------------------
// FastAPI validation errors (a 422 body) arrive as a LIST of {loc, msg, type}
// entries, not a string or a {code, message} object. Left unhandled, the DOV
// bbox 422 fell through to the raw fallback and the engineer saw "HTTP 422".
//
// The rule, in the owner's words: "a refused DOV box tells me what is wrong
// with the box, never 'HTTP 422'".
// ---------------------------------------------------------------------------

describe('messageForDetail — FastAPI validation list shape', () => {
  it('a refused DOV box tells me what is wrong with the box, never "HTTP 422"', () => {
    // A model-level validator error: pydantic wraps the ValueError text with a
    // "Value error, " prefix and leaves loc at just ["body"].
    const detail = [
      {
        type: 'value_error',
        loc: ['body'],
        msg: 'Value error, bounding box east (3.0) must be greater than west (3.0); the eastern edge is at or west of the western edge',
      },
    ]
    const msg = messageForDetail(detail, 'HTTP 422')
    expect(msg).not.toBe('HTTP 422')
    expect(msg).toMatch(/must be greater than west/)
    // The internal "Value error, " prefix is not shown to the engineer.
    expect(msg).not.toMatch(/^Value error,/)
  })

  it('shows "field: message" for a field-constraint error', () => {
    const detail = [
      {
        type: 'less_than_equal',
        loc: ['body', 'north'],
        msg: 'Input should be less than or equal to 90',
      },
    ]
    expect(messageForDetail(detail, 'HTTP 422')).toBe(
      'north: Input should be less than or equal to 90',
    )
  })

  it('falls back for an empty or malformed list', () => {
    expect(messageForDetail([], 'HTTP 422')).toBe('HTTP 422')
    expect(messageForDetail([{ loc: ['body'] }], 'HTTP 422')).toBe('HTTP 422')
  })
})
