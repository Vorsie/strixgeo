// Unit tests for api.geology.claimBodyExtent — 409 provenance-conflict path.
//
// CBE-409  A 409 response with code='provenance_violation' throws
//          ProvenanceViolationError (not a generic Error), carrying the
//          correct side + kind values so the caller can open the
//          ProvenanceConflictDialog.
//
// CBE-422  A 422 response throws a plain Error (not ProvenanceViolationError).
//
// CBE-200  A 200 response resolves to the BodyListItem JSON.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, ProvenanceViolationError, setBaseUrl } from './client'

// Use a stable fake base so path assertions don't depend on port.
setBaseUrl('http://localhost:1234')

const PROJECT_ID = 'proj-1'
const MODEL_ID = 'model-1'
const REQUEST = {
  formation_id: 'form-1',
  source_investigation_id: 'inv-src',
  side: 'left' as const,
  kind: 'pinch_out_halfway' as const,
  neighbour_inv_id: 'inv-nbr',
}

function mockFetch(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    }),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('api.geology.claimBodyExtent', () => {
  it('CBE-409 — 409 provenance_violation throws ProvenanceViolationError with side + kind', async () => {
    mockFetch(409, {
      detail: {
        code: 'provenance_violation',
        message: "Cannot overwrite detector-set 'to_target' extent on side='left'.",
      },
    })

    let caught: unknown
    try {
      await api.geology.claimBodyExtent(PROJECT_ID, MODEL_ID, REQUEST)
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(ProvenanceViolationError)
    const pve = caught as ProvenanceViolationError
    expect(pve.side).toBe('left')
    expect(pve.kind).toBe('pinch_out_halfway')
    // The typed error class name must be set (guards instanceof in JS across realms).
    expect(pve.name).toBe('ProvenanceViolationError')
  })

  it('CBE-422 — 422 response throws a plain Error, NOT ProvenanceViolationError', async () => {
    mockFetch(422, {
      detail: {
        code: 'claim_body_extent_error',
        message: "side must be 'left' or 'right', got 'centre'",
      },
    })

    let caught: unknown
    try {
      await api.geology.claimBodyExtent(PROJECT_ID, MODEL_ID, REQUEST)
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(Error)
    expect(caught).not.toBeInstanceOf(ProvenanceViolationError)
  })

  it('CBE-200 — 2xx response resolves to the body JSON', async () => {
    const fakeBody = {
      id: 'b-1',
      app_project_id: PROJECT_ID,
      model_id: MODEL_ID,
      formation_id: 'form-1',
      body_ordinal: 0,
      source_investigation_id: 'inv-src',
      name: null,
      primary_section_id: null,
      content_key: null,
      extent_left_kind: 'pinch_out_halfway',
      extent_left_target_contact_id: null,
      extent_left_neighbour_inv_id: 'inv-nbr',
      extent_right_kind: null,
      extent_right_target_contact_id: null,
      extent_right_neighbour_inv_id: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }
    mockFetch(201, fakeBody)

    const result = await api.geology.claimBodyExtent(PROJECT_ID, MODEL_ID, REQUEST)
    expect(result.id).toBe('b-1')
    expect(result.extent_left_kind).toBe('pinch_out_halfway')
  })
})
