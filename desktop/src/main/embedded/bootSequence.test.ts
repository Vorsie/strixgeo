import { describe, it, expect } from 'vitest'
import { BootSequence, describeStage, type BootStage } from './bootSequence'

/**
 * A clock that advances a fixed step on every read, so durations in the
 * assertions are exact rather than wall-clock flaky.
 */
function stepClock(stepMs: number): () => number {
  let t = 0
  return () => {
    const now = t
    t += stepMs
    return now
  }
}

describe('BootSequence — recording', () => {
  it('records each completed stage in the order it ran', () => {
    const boot = new BootSequence(stepClock(10))

    boot.begin('acquire-port')
    boot.succeed('port 54121')
    boot.begin('start-postgres')
    boot.succeed()

    expect(boot.steps.map(s => s.stage)).toEqual(['acquire-port', 'start-postgres'])
    expect(boot.steps.map(s => s.status)).toEqual(['ok', 'ok'])
  })

  it('measures how long each stage took', () => {
    const boot = new BootSequence(stepClock(250))

    boot.begin('init-cluster')
    boot.succeed()

    expect(boot.steps[0].ms).toBe(250)
  })

  it('keeps the note handed to succeed, so the log says WHICH port / revision', () => {
    const boot = new BootSequence(stepClock(1))

    boot.begin('acquire-port')
    boot.succeed('port 54121')

    expect(boot.steps[0].note).toBe('port 54121')
  })

  it('records a skipped stage as skipped, not as success', () => {
    const boot = new BootSequence(stepClock(1))

    boot.begin('init-cluster')
    boot.skip('data directory already initialised')

    expect(boot.steps[0].status).toBe('skipped')
    expect(boot.steps[0].note).toBe('data directory already initialised')
  })
})

describe('BootSequence — failure', () => {
  it('names the stage that failed and keeps the message', () => {
    const boot = new BootSequence(stepClock(1))

    boot.begin('run-migrations')
    const failure = boot.fail('alembic exited with code 1')

    expect(failure.stage).toBe('run-migrations')
    expect(failure.message).toBe('alembic exited with code 1')
  })

  it('carries a plain-language explanation for a non-technical tester', () => {
    const boot = new BootSequence(stepClock(1))

    boot.begin('run-migrations')
    const failure = boot.fail('alembic exited with code 1')

    // The tester sees this sentence in a dialog; it must name what broke in
    // words that are not the internal stage id.
    expect(failure.summary).toBe(describeStage('run-migrations'))
    expect(failure.summary).not.toContain('run-migrations')
  })

  it('records the failed stage as a step so the log shows how far boot got', () => {
    const boot = new BootSequence(stepClock(1))

    boot.begin('acquire-port')
    boot.succeed()
    boot.begin('start-postgres')
    boot.fail('postgres.exe exited immediately')

    expect(boot.steps.map(s => s.status)).toEqual(['ok', 'failed'])
    expect(boot.failed).toBe(true)
  })

  it('is not failed while every stage is still succeeding', () => {
    const boot = new BootSequence(stepClock(1))

    boot.begin('acquire-port')
    boot.succeed()

    expect(boot.failed).toBe(false)
  })
})

describe('BootSequence — misuse is loud', () => {
  it('refuses to begin a stage while another is still open', () => {
    const boot = new BootSequence(stepClock(1))

    boot.begin('acquire-port')

    // A stage left open means a code path returned without recording its
    // outcome — the boot log would silently lose a step.
    expect(() => boot.begin('start-postgres')).toThrow(/still open/i)
  })

  it('refuses to close a stage that was never opened', () => {
    const boot = new BootSequence(stepClock(1))

    expect(() => boot.succeed()).toThrow(/no stage/i)
  })
})

describe('BootSequence — the boot log', () => {
  it('renders one line per stage with status and duration', () => {
    const boot = new BootSequence(stepClock(100))

    boot.begin('acquire-port')
    boot.succeed('port 54121')
    boot.begin('init-cluster')
    boot.skip('data directory already initialised')

    const lines = boot.format().split('\n')

    expect(lines[0]).toContain('acquire-port')
    expect(lines[0]).toContain('ok')
    expect(lines[0]).toContain('100ms')
    expect(lines[0]).toContain('port 54121')
    expect(lines[1]).toContain('skipped')
  })

  it('renders a total so a slow first boot is visible at a glance', () => {
    const boot = new BootSequence(stepClock(500))

    boot.begin('acquire-port')
    boot.succeed()
    boot.begin('start-postgres')
    boot.succeed()

    // Two stages, each measured across one 500 ms clock step.
    expect(boot.format()).toContain('total 1000ms')
  })
})

describe('describeStage', () => {
  it('has a plain-language sentence for every stage', () => {
    const stages: BootStage[] = [
      'resolve-paths',
      'load-secrets',
      'acquire-port',
      'acquire-api-port',
      'init-cluster',
      'start-postgres',
      'await-postgres-ready',
      'run-migrations',
      'start-backend',
      'await-backend-ready',
    ]

    for (const stage of stages) {
      const sentence = describeStage(stage)
      expect(sentence.length).toBeGreaterThan(0)
      // The internal id must never leak into the user-facing sentence.
      expect(sentence).not.toContain(stage)
    }
  })
})
