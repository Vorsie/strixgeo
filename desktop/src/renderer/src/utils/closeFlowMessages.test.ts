import { describe, expect, it } from 'vitest'

import {
  failedRevertMessage,
  failedSaveMessage,
  refusedRevertMessage,
} from './closeFlowMessages'

// The close-flow copy is a safety rail: a message that under-states the loss
// buys consent under a false premise (docs/ux.md). These pin the load-bearing
// properties — the file is NAMED and the loss is EXPLICIT — without freezing the
// exact wording.

describe('refusedRevertMessage — the force-revert confirmation body', () => {
  it("names the file and states the loss explicitly (owner: I want the changes to be gone)", () => {
    const msg = refusedRevertMessage('C:/Users/robin/Bureaublad/test.strix')
    // The file is named by its basename, not its full path.
    expect(msg).toContain('test.strix')
    expect(msg).not.toContain('C:/Users')
    // The loss is spelled out — this is not a vague "changes" message.
    expect(msg.toLowerCase()).toContain('delete')
    expect(msg.toLowerCase()).toContain('latest save')
  })

  it('handles a POSIX path basename', () => {
    expect(refusedRevertMessage('/home/r/projects/site-a.strix')).toContain(
      'site-a.strix',
    )
  })
})

describe('failedSaveMessage / failedRevertMessage still name the file', () => {
  it('failedSaveMessage names the file and says the work is still unsaved', () => {
    const msg = failedSaveMessage('C:/x/site.strix')
    expect(msg).toContain('site.strix')
    expect(msg.toLowerCase()).toContain('unsaved')
  })

  it('failedRevertMessage says nothing was deleted', () => {
    const msg = failedRevertMessage('C:/x/site.strix')
    expect(msg).toContain('site.strix')
    expect(msg.toLowerCase()).toContain('nothing was deleted')
  })
})
