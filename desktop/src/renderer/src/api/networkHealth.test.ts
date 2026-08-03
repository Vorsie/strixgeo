// The app must not keep pretending it can save when nothing is listening.
//
// Owner dogfeed 2026-08-02: the backend process died mid-session. Every
// subsequent click hit ERR_CONNECTION_REFUSED, each handler caught its own
// rejection, and the app carried on looking healthy — an accept loop ran to
// completion having persisted nothing. The engineer worked for MINUTES before
// realising, because a per-action toast reads as "that one click missed", not
// as "this app is no longer connected to anything".
//
// The distinction this module draws, and the reason it counts:
//
// * An HTTP error (409, 422, 500) means the backend ANSWERED. The request
//   failed; the connection is fine. It must never arm the banner.
// * A network-level rejection (`TypeError: Failed to fetch`) means nothing
//   answered.
// * ONE network rejection is not a dead backend — a single dropped socket
//   during a restart is normal. Three in a row is a state, not an incident.
//
// Deliberately not a toast: a toast is an event that happened once. This is a
// condition that persists until it stops being true, so it clears itself on the
// first request that succeeds.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CONSECUTIVE_NETWORK_FAILURES_BEFORE_UNREACHABLE,
  isBackendUnreachable,
  noteNetworkFailure,
  noteNetworkSuccess,
  resetNetworkHealth,
  subscribeBackendReachability,
} from './networkHealth'

beforeEach(() => resetNetworkHealth())

describe('NH1 — it takes a run of failures, not one', () => {
  it('stays reachable below the threshold', () => {
    for (let i = 0; i < CONSECUTIVE_NETWORK_FAILURES_BEFORE_UNREACHABLE - 1; i++) {
      noteNetworkFailure()
    }
    expect(isBackendUnreachable()).toBe(false)
  })

  it('flips to unreachable on the threshold-th consecutive failure', () => {
    for (let i = 0; i < CONSECUTIVE_NETWORK_FAILURES_BEFORE_UNREACHABLE; i++) {
      noteNetworkFailure()
    }
    expect(isBackendUnreachable()).toBe(true)
  })

  it('counts CONSECUTIVE failures — a success in between resets the run', () => {
    noteNetworkFailure()
    noteNetworkFailure()
    noteNetworkSuccess()
    noteNetworkFailure()
    noteNetworkFailure()
    expect(isBackendUnreachable()).toBe(false)
  })
})

describe('NH2 — any success clears the condition', () => {
  it('goes back to reachable after one successful request', () => {
    for (let i = 0; i < CONSECUTIVE_NETWORK_FAILURES_BEFORE_UNREACHABLE; i++) {
      noteNetworkFailure()
    }
    expect(isBackendUnreachable()).toBe(true)

    noteNetworkSuccess()

    expect(isBackendUnreachable()).toBe(false)
  })
})

describe('NH3 — subscribers hear transitions, and only transitions', () => {
  it('notifies on the flip to unreachable and on the flip back', () => {
    const listener = vi.fn()
    subscribeBackendReachability(listener)

    for (let i = 0; i < CONSECUTIVE_NETWORK_FAILURES_BEFORE_UNREACHABLE; i++) {
      noteNetworkFailure()
    }
    expect(listener).toHaveBeenCalledTimes(1)

    noteNetworkSuccess()
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('does not re-notify while the condition merely persists', () => {
    const listener = vi.fn()
    subscribeBackendReachability(listener)

    for (let i = 0; i < CONSECUTIVE_NETWORK_FAILURES_BEFORE_UNREACHABLE + 5; i++) {
      noteNetworkFailure()
    }
    // One transition, however many failures followed it — a re-render per
    // failed request in a dead-backend storm is the opposite of helpful.
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('does not notify a listener that has unsubscribed', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeBackendReachability(listener)
    unsubscribe()

    for (let i = 0; i < CONSECUTIVE_NETWORK_FAILURES_BEFORE_UNREACHABLE; i++) {
      noteNetworkFailure()
    }
    expect(listener).not.toHaveBeenCalled()
  })

  it('does not notify on a success while already reachable', () => {
    const listener = vi.fn()
    subscribeBackendReachability(listener)

    noteNetworkSuccess()
    noteNetworkSuccess()

    expect(listener).not.toHaveBeenCalled()
  })
})
