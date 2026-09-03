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
