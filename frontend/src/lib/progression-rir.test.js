import { describe, it, expect } from 'vitest'
import { nextPrescription, readSession, DEFAULT_TARGET_RIR } from './progression.js'
import { EXDB } from './exercises.js'

const LIFT = EXDB.find(e => e.bp !== 'cardio' && !['upper legs', 'lower legs', 'back', 'hips', 'glutes'].includes(e.bp)).id

// One finished session: weight, reps hit, and an RIR rating on every set.
const session = (w, reps, rir, i = 0) => ({
  d: '2026-02-0' + (i + 1),
  entries: [{
    id: LIFT,
    target: { sets: 3, reps, weight: w },
    sets: Array.from({ length: 3 }, () => ({ w, r: reps, rir, done: true }))
  }]
})
const stateRir = (sessions, cfg = {}) => ({ unit: 'kg', workouts: sessions })
const CFG = { id: LIFT, prog: 'rir', reps: 5 }

describe('readSession carries average RIR', () => {
  it('averages the rated done sets', () => {
    const s = readSession({ id: LIFT, target: { sets: 2, reps: 5 }, sets: [{ w: 60, r: 5, rir: 2, done: true }, { w: 60, r: 5, rir: 4, done: true }] })
    expect(s.rir).toBe(3)
  })
  it('is null when nothing was rated', () => {
    expect(readSession({ id: LIFT, target: { sets: 1, reps: 5 }, sets: [{ w: 60, r: 5, done: true }] }).rir).toBeNull()
  })
})

describe('rir policy', () => {
  it('raises the weight when the last session was too easy', () => {
    const p = nextPrescription(stateRir([session(60, 5, 4)]), CFG)   // 4 RIR vs target 2 → lighter than wanted
    expect(p.kind).toBe('up')
    expect(p.weight).toBeGreaterThan(60)
  })

  it('drops the weight when the last session was too hard', () => {
    const p = nextPrescription(stateRir([session(100, 5, 0)]), CFG)  // 0 RIR vs target 2 → too hard
    expect(p.kind).toBe('deload')
    expect(p.weight).toBeLessThan(100)
  })

  it('holds when effort landed on target', () => {
    const p = nextPrescription(stateRir([session(80, 5, DEFAULT_TARGET_RIR)]), CFG)
    expect(p.kind).toBe('hold')
    expect(p.weight).toBe(80)
  })

  it('scales the jump to how far off target the effort was', () => {
    const small = nextPrescription(stateRir([session(100, 5, 3)]), CFG).weight    // 1 off
    const big = nextPrescription(stateRir([session(100, 5, 5)]), CFG).weight      // 3 off
    expect(big - 100).toBeGreaterThan(small - 100)
  })

  it('caps a single session\'s change so one wild rating cannot lurch', () => {
    const p = nextPrescription(stateRir([session(100, 5, 10)]), CFG)   // absurd 10 RIR
    expect(p.weight - 100).toBeLessThanOrEqual(4 * 2.5 + 1e-9)         // ≤ RIR_MAX_STEPS × inc
  })

  it('respects a custom target RIR', () => {
    // target 0 (train to failure): a session at 2 RIR is now "too easy" → go up
    const p = nextPrescription(stateRir([session(80, 5, 2)]), { ...CFG, targetRir: 0 })
    expect(p.kind).toBe('up')
  })

  it('asks for a rating when the last session had none', () => {
    const p = nextPrescription(stateRir([session(80, 5, undefined)]), CFG)
    expect(p.kind).toBe('hold')
    expect(p.why[0]).toMatch(/RIR/)
  })

  it('snaps the new weight to a loadable increment', () => {
    const p = nextPrescription(stateRir([session(62.5, 5, 4)]), CFG)
    expect(Math.round(p.weight / 2.5) * 2.5).toBeCloseTo(p.weight, 9)
  })
})
