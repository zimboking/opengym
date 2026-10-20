import { describe, it, expect } from 'vitest'
import { expenditure, calorieTarget, ENERGY_PER_KG } from './energy.js'

const iso = (start, i) => {
  const d = new Date(start + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + i)
  return d.toISOString().slice(0, 10)
}
// n days of intake at `kcal`, and a trend series moving at `ratePerWeek` kg from `startW`.
const build = (n, kcal, startW, ratePerWeek, start = '2026-03-01') => {
  const calories = Array.from({ length: n }, (_, i) => ({ d: iso(start, i), kcal }))
  const trend = Array.from({ length: n }, (_, i) => ({ d: iso(start, i), t: Date.parse(iso(start, i)), trend: startW + (ratePerWeek / 7) * i }))
  return { calories, trend }
}

describe('expenditure', () => {
  it('returns null without enough overlapping days', () => {
    const { calories, trend } = build(4, 2500, 80, 0)
    expect(expenditure(calories, trend)).toBeNull()
  })

  it('equals intake when weight holds (energy balance)', () => {
    const { calories, trend } = build(21, 2500, 80, 0)
    const e = expenditure(calories, trend)
    expect(e.kcal).toBeCloseTo(2500, 0)
  })

  it('reads a deficit when weight falls', () => {
    // eating 2000, losing 0.5 kg/week → TDEE = 2000 + 7700·0.5/7 ≈ 2550
    const { calories, trend } = build(28, 2000, 80, -0.5)
    const e = expenditure(calories, trend)
    expect(e.kcal).toBeGreaterThan(2450)
    expect(e.kcal).toBeLessThan(2650)
  })

  it('reads a surplus when weight rises', () => {
    const { calories, trend } = build(28, 3000, 80, 0.5)
    const e = expenditure(calories, trend)
    expect(e.kcal).toBeLessThan(3000)
    expect(e.kcal).toBeGreaterThan(2400)
  })

  it('only counts days that have an intake entry', () => {
    const { calories, trend } = build(21, 2500, 80, 0)
    const sparse = calories.filter((_, i) => i % 2 === 0)   // every other day logged
    const e = expenditure(sparse, trend)
    expect(e.daysPresent).toBe(sparse.length)
    expect(e.kcal).toBeCloseTo(2500, 0)
  })

  it('ignores zero/blank intake days rather than treating them as a fast', () => {
    const { calories, trend } = build(21, 2500, 80, 0)
    calories[5].kcal = 0
    const e = expenditure(calories, trend)
    expect(e.daysPresent).toBe(20)
    expect(e.kcal).toBeCloseTo(2500, 0)
  })

  it('honours a custom window', () => {
    const { calories, trend } = build(60, 2500, 80, 0)
    expect(expenditure(calories, trend, { windowDays: 14 }).window).toBe(14)
  })
})

describe('calorieTarget', () => {
  it('matches TDEE for weight maintenance', () => {
    expect(calorieTarget(2500, 0)).toBe(2500)
  })
  it('subtracts a deficit for weight loss', () => {
    // 0.5 kg/week loss ≈ 550 kcal/day below TDEE
    expect(calorieTarget(2500, -0.5)).toBeCloseTo(2500 - (ENERGY_PER_KG * 0.5) / 7, 0)
  })
  it('adds a surplus for a lean gain', () => {
    expect(calorieTarget(2500, 0.25)).toBeGreaterThan(2500)
  })
})
