import { describe, it, expect } from 'vitest'
import { weightTrend, estimateNoise, daysToGoal, SMOOTHING } from './weight-trend.js'

const iso = (start, i) => {
  const d = new Date(start + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + i)
  return d.toISOString().slice(0, 10)
}
// Deterministic pseudo-noise so tests never flake.
const wobble = i => Math.sin(i * 12.9898) * 0.4
const series = (n, f, start = '2026-01-01') =>
  Array.from({ length: n }, (_, i) => ({ d: iso(start, i), w: Math.round(f(i) * 10) / 10 }))

describe('weightTrend', () => {
  it('returns null with no weigh-ins', () => {
    expect(weightTrend([])).toBeNull()
    expect(weightTrend(undefined)).toBeNull()
  })

  it('returns the single weigh-in as the trend', () => {
    const r = weightTrend([{ d: '2026-01-01', w: 80 }])
    expect(r.latest.trend).toBe(80)
    expect(r.latest.weeklyRate).toBe(0)
    expect(r.points).toHaveLength(1)
  })

  it('tracks a flat weight with a near-zero rate', () => {
    const r = weightTrend(series(40, i => 80 + wobble(i)))
    expect(Math.abs(r.latest.trend - 80)).toBeLessThan(0.3)
    expect(Math.abs(r.latest.weeklyRate)).toBeLessThan(0.1)
  })

  it('recovers a steady loss rate through daily noise', () => {
    // −0.5 kg/week
    const r = weightTrend(series(56, i => 90 - (0.5 / 7) * i + wobble(i)))
    expect(r.latest.weeklyRate).toBeLessThan(-0.35)
    expect(r.latest.weeklyRate).toBeGreaterThan(-0.65)
  })

  it('is smoother than the raw readings', () => {
    const bw = series(40, i => 80 + wobble(i) * 2)
    const r = weightTrend(bw)
    const rough = a => a.slice(1).reduce((s, v, i) => s + Math.abs(v - a[i]), 0)
    expect(rough(r.points.map(p => p.trend))).toBeLessThan(rough(bw.map(b => b.w)) / 3)
  })

  it('flags an obvious mis-entry and keeps it from dragging the trend', () => {
    const bw = series(30, i => 80 + wobble(i))
    bw[20] = { d: bw[20].d, w: 95 }   // typo: 95 instead of ~80
    const r = weightTrend(bw)
    expect(r.outliers.has(bw[20].d)).toBe(true)
    const at = r.points.find(p => p.d === bw[20].d)
    expect(Math.abs(at.trend - 80)).toBeLessThan(1)
  })

  it('bridges gaps without inventing points on missing days', () => {
    const bw = [...series(10, () => 80), ...series(10, () => 79, '2026-01-25')]
    const r = weightTrend(bw)
    expect(r.points).toHaveLength(20)
    expect(r.points.map(p => p.d)).toEqual(bw.map(b => b.d))
  })

  it('sorts unsorted input', () => {
    const bw = series(10, i => 80 - i * 0.1).reverse()
    const r = weightTrend(bw)
    expect(r.points[0].d < r.points[9].d).toBe(true)
  })

  it('reacts faster with responsive smoothing than with smooth', () => {
    // flat for weeks, then a sudden sustained 4 kg drop for the final few days
    const bw = series(40, i => (i < 36 ? 84 : 80) + wobble(i) * 0.3)
    const fast = weightTrend(bw, { smoothing: 'responsive' }).latest.trend
    const slow = weightTrend(bw, { smoothing: 'smooth' }).latest.trend
    // responsive has tracked further down toward the new weight than smooth has
    expect(fast).toBeLessThan(slow)
  })

  it('exposes every smoothing preset', () => {
    expect(Object.keys(SMOOTHING)).toEqual(['responsive', 'balanced', 'smooth'])
  })
})

describe('estimateNoise', () => {
  it('measures day-to-day scatter, ignoring the trend itself', () => {
    const noisy = estimateNoise(series(40, i => 90 - 0.1 * i + wobble(i) * 4))
    const quiet = estimateNoise(series(40, i => 90 - 0.1 * i + wobble(i)))
    expect(noisy).toBeGreaterThan(quiet)
  })

  it('falls back to a share of body weight with too few readings', () => {
    // 100 kg × 0.75% = 0.75 kg, inside the [0.3, 1.2] clamp
    expect(estimateNoise([{ d: '2026-01-01', w: 100 }])).toBeCloseTo(0.75, 5)
  })
})

describe('daysToGoal', () => {
  it('projects when heading toward the goal', () => {
    expect(daysToGoal(80, -0.5, 78)).toBe(28)
  })
  it('refuses to project when moving away or flat', () => {
    expect(daysToGoal(80, 0.5, 78)).toBeNull()
    expect(daysToGoal(80, 0, 78)).toBeNull()
    expect(daysToGoal(80, -0.01, 70)).toBeNull()   // beyond a year is no projection
  })
  it('reports zero once reached', () => {
    expect(daysToGoal(78, -0.5, 78)).toBe(0)
  })
})
